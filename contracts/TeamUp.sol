// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/**
 * @title TeamUp
 * @notice A group pot. Members contribute USDC, and money leaves only when a
 *         majority of the people who put money in agree to it.
 *
 * @dev This holds other people's money and settles disagreements between them,
 *      so the rules are deliberately rigid:
 *
 *      - Membership is fixed at creation. Adding a member later would dilute
 *        everyone's vote after they had already committed funds.
 *      - Any member may propose a payout. The vote is the gate, not the
 *        proposing.
 *      - A proposal needs **more than half** of the members who still have money
 *        in the pot. Half is not a majority: 2 of 4 cannot move a group's money.
 *      - A proposal expires after 7 days. A request nobody answered should not be
 *        executable months later, when the reason for it has gone.
 *      - A member may leave and take back what they put in, minus a breaking fee
 *        that stays with the group. Leaving is always possible: money you can
 *        never retrieve is not saving, it is a hostage.
 *      - No owner, no admin, no pause, no upgrade. Nobody outside the group —
 *        including whoever deployed this — can move a cent.
 *
 *      Token assumption: USDC on Arc. Return values are checked regardless.
 */
interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

contract TeamUp {
    struct Proposal {
        address to;
        uint256 amount;
        string reason;
        address proposer;
        uint64 expiresAt;
        bool executed;
        uint32 votes;
    }

    /// @notice How long a proposal stays open
    uint64 public constant VOTING_WINDOW = 7 days;

    IERC20 public immutable token;
    /// @notice What the group is saving for
    string public purpose;
    /// @notice The optional amount the group is aiming at, 0 for none
    uint256 public immutable target;

    address[] public members;
    mapping(address => bool) public isMember;
    /// @notice What each member has in the pot right now
    mapping(address => uint256) public contributions;
    /// @notice Everything the group holds, from contributions and breaking fees
    uint256 public pot;

    Proposal[] public proposals;
    /// @notice proposal id => member => voted
    mapping(uint256 => mapping(address => bool)) public hasVoted;

    /// @notice Kept by the group when someone leaves early, in basis points
    uint16 public immutable breakingFeeBps;

    event Contributed(address indexed member, uint256 amount, uint256 pot);
    event Proposed(uint256 indexed id, address indexed proposer, address indexed to, uint256 amount, string reason, uint64 expiresAt);
    event Voted(uint256 indexed id, address indexed member, uint32 votes, uint32 needed);
    event Executed(uint256 indexed id, address indexed to, uint256 amount);
    event Left(address indexed member, uint256 returned, uint256 fee);

    error NotMember();
    error ZeroAmount();
    error ZeroAddress();
    error TooFewMembers();
    error DuplicateMember();
    error FeeTooHigh();
    error NoProposal();
    error AlreadyExecuted();
    error Expired();
    error AlreadyVoted();
    error NotEnoughVotes();
    error NotEnoughInPot();
    error NothingToReturn();
    error TransferFailed();

    modifier onlyMember() {
        if (!isMember[msg.sender]) revert NotMember();
        _;
    }

    constructor(IERC20 token_, address[] memory members_, string memory purpose_, uint256 target_, uint16 breakingFeeBps_) {
        if (address(token_) == address(0)) revert ZeroAddress();
        // Two people can deadlock forever with no majority; three is the floor
        if (members_.length < 3) revert TooFewMembers();
        // A fee above 10% turns leaving into a penalty rather than a cost
        if (breakingFeeBps_ > 1_000) revert FeeTooHigh();

        token = token_;
        purpose = purpose_;
        target = target_;
        breakingFeeBps = breakingFeeBps_;

        for (uint256 i = 0; i < members_.length; i++) {
            address member = members_[i];
            if (member == address(0)) revert ZeroAddress();
            if (isMember[member]) revert DuplicateMember();
            isMember[member] = true;
            members.push(member);
        }
    }

    /// @notice Everyone in the group
    function memberList() external view returns (address[] memory) {
        return members;
    }

    function memberCount() external view returns (uint256) {
        return members.length;
    }

    function proposalCount() external view returns (uint256) {
        return proposals.length;
    }

    /**
     * @notice How many votes a proposal needs: more than half of the members who
     *         currently have money in the pot.
     * @dev Members who have left are not counted, or a group of five that lost two
     *      could never reach three votes again.
     */
    function votesNeeded() public view returns (uint32 needed) {
        uint32 active;
        for (uint256 i = 0; i < members.length; i++) {
            if (contributions[members[i]] > 0) active++;
        }
        if (active == 0) return type(uint32).max; // nothing to vote on: an empty pot
        needed = active / 2 + 1;
    }

    /// @notice Put money in. Requires an allowance for this contract.
    function contribute(uint256 amount) external onlyMember {
        if (amount == 0) revert ZeroAmount();
        contributions[msg.sender] += amount;
        pot += amount;
        emit Contributed(msg.sender, amount, pot);
        if (!token.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
    }

    /**
     * @notice Ask the group to pay someone. Proposing does not vote for it — the
     *         proposer still has to, which keeps the count honest.
     */
    function propose(address to, uint256 amount, string calldata reason) external onlyMember returns (uint256 id) {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (amount > pot) revert NotEnoughInPot();

        id = proposals.length;
        proposals.push(
            Proposal({
                to: to,
                amount: amount,
                reason: reason,
                proposer: msg.sender,
                expiresAt: uint64(block.timestamp) + VOTING_WINDOW,
                executed: false,
                votes: 0
            })
        );
        emit Proposed(id, msg.sender, to, amount, reason, uint64(block.timestamp) + VOTING_WINDOW);
    }

    /**
     * @notice Vote for a proposal, and carry it out if that was the deciding vote.
     * @dev Executing inside the final vote means nobody has to come back and
     *      "finish" a decision the group already made.
     */
    function approve(uint256 id) external onlyMember {
        if (id >= proposals.length) revert NoProposal();
        Proposal storage p = proposals[id];
        if (p.executed) revert AlreadyExecuted();
        if (block.timestamp >= p.expiresAt) revert Expired();
        if (hasVoted[id][msg.sender]) revert AlreadyVoted();

        hasVoted[id][msg.sender] = true;
        p.votes += 1;
        uint32 needed = votesNeeded();
        emit Voted(id, msg.sender, p.votes, needed);

        if (p.votes >= needed) _execute(id, p);
    }

    function _execute(uint256 id, Proposal storage p) private {
        if (p.amount > pot) revert NotEnoughInPot();
        p.executed = true;
        pot -= p.amount;

        // What leaves comes off everyone's share in proportion, so the pot and the
        // sum of contributions never drift apart
        _reduceProportionally(p.amount);

        emit Executed(id, p.to, p.amount);
        if (!token.transfer(p.to, p.amount)) revert TransferFailed();
    }

    /// @dev Reduces every member's recorded contribution so they still add up to the pot
    function _reduceProportionally(uint256 amount) private {
        uint256 total = amount;
        uint256 remaining = pot + amount; // the pot as it was before this payout
        for (uint256 i = 0; i < members.length && total > 0; i++) {
            address member = members[i];
            uint256 held = contributions[member];
            if (held == 0) continue;
            uint256 share = (held * amount) / remaining;
            if (share > total) share = total;
            contributions[member] = held - share;
            total -= share;
        }
        // Rounding dust: take it from the first member who can cover it
        for (uint256 i = 0; i < members.length && total > 0; i++) {
            address member = members[i];
            uint256 held = contributions[member];
            if (held == 0) continue;
            uint256 take = held < total ? held : total;
            contributions[member] = held - take;
            total -= take;
        }
    }

    /**
     * @notice Leave the group and take your share back, minus the breaking fee.
     * @dev The fee stays in the pot for the members who remain. Leaving is always
     *      allowed: the point of a breaking fee is to make it a considered choice,
     *      not an impossible one.
     */
    function leave() external onlyMember {
        uint256 held = contributions[msg.sender];
        if (held == 0) revert NothingToReturn();

        uint256 fee = (held * breakingFeeBps) / 10_000;
        uint256 returned = held - fee;

        contributions[msg.sender] = 0;
        pot -= returned;
        emit Left(msg.sender, returned, fee);

        if (!token.transfer(msg.sender, returned)) revert TransferFailed();
    }

    /// @notice A proposal, for the app to show
    function proposalAt(uint256 id)
        external
        view
        returns (address to, uint256 amount, string memory reason, address proposer, uint64 expiresAt, bool executed, uint32 votes, uint32 needed)
    {
        Proposal storage p = proposals[id];
        return (p.to, p.amount, p.reason, p.proposer, p.expiresAt, p.executed, p.votes, votesNeeded());
    }

    /**
     * @notice Proposals still waiting on a decision.
     * @dev The app reads this rather than scanning logs: Arc's public nodes answer
     *      5,000 blocks at a time, which is no way to find out you owe someone a vote.
     */
    function openProposals() external view returns (uint256[] memory ids) {
        uint256 open;
        for (uint256 i = 0; i < proposals.length; i++) {
            if (!proposals[i].executed && block.timestamp < proposals[i].expiresAt) open++;
        }
        ids = new uint256[](open);
        uint256 n;
        for (uint256 i = 0; i < proposals.length && n < open; i++) {
            if (!proposals[i].executed && block.timestamp < proposals[i].expiresAt) ids[n++] = i;
        }
    }

    /// @notice Whether this member still owes a vote on this proposal
    function awaitingVote(uint256 id, address member) external view returns (bool) {
        if (id >= proposals.length || !isMember[member]) return false;
        Proposal storage p = proposals[id];
        return !p.executed && block.timestamp < p.expiresAt && !hasVoted[id][member];
    }
}

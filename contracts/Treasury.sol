// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/**
 * @title Treasury
 * @notice A company balance with several signers, where a majority approves each
 *         payment. Anyone may pay money in; only a vote takes money out.
 *
 * @dev Close kin to TeamUp, with the differences a company needs:
 *
 *      - **Signers are named, not contributors.** Revenue arrives from customers
 *        who have no say in how it is spent; the people who decide are a fixed
 *        list set at creation.
 *      - **At least three signers**, so no single person and no pair can move
 *        money, and a majority is always more than half of a fixed number — it
 *        does not drift as balances change.
 *      - **Proposals expire after 7 days**, so an unanswered request cannot be
 *        executed months later.
 *      - **No owner, no admin, no pause, no upgrade, no signer changes.** A
 *        treasury whose signer list can be edited is a treasury with a back door;
 *        to change the signers, move the money to a new one by vote.
 *
 *      Token assumption: USDC on Arc. Return values are checked regardless.
 */
interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract Treasury {
    struct Payment {
        address to;
        uint256 amount;
        string reason;
        address proposer;
        uint64 expiresAt;
        bool executed;
        uint32 approvals;
    }

    uint64 public constant VOTING_WINDOW = 7 days;

    IERC20 public immutable token;
    /// @notice Whose treasury this is, for the app to show
    string public name;

    address[] public signers;
    mapping(address => bool) public isSigner;

    Payment[] public payments;
    /// @notice payment id => signer => approved
    mapping(uint256 => mapping(address => bool)) public hasApproved;

    /// @notice Paid in so far, counted from calls rather than balance
    uint256 public received;
    /// @notice Paid out so far
    uint256 public spent;

    event Funded(address indexed from, uint256 amount, uint256 balance);
    event Proposed(uint256 indexed id, address indexed proposer, address indexed to, uint256 amount, string reason, uint64 expiresAt);
    event Approved(uint256 indexed id, address indexed signer, uint32 approvals, uint32 needed);
    event Paid(uint256 indexed id, address indexed to, uint256 amount);

    error NotSigner();
    error ZeroAddress();
    error ZeroAmount();
    error TooFewSigners();
    error DuplicateSigner();
    error NoPayment();
    error AlreadyExecuted();
    error Expired();
    error AlreadyApproved();
    error NotEnoughFunds();
    error TransferFailed();

    modifier onlySigner() {
        if (!isSigner[msg.sender]) revert NotSigner();
        _;
    }

    constructor(IERC20 token_, string memory name_, address[] memory signers_) {
        if (address(token_) == address(0)) revert ZeroAddress();
        // Three is the floor: with two, one signer is half the room
        if (signers_.length < 3) revert TooFewSigners();

        token = token_;
        name = name_;

        for (uint256 i = 0; i < signers_.length; i++) {
            address signer = signers_[i];
            if (signer == address(0)) revert ZeroAddress();
            if (isSigner[signer]) revert DuplicateSigner();
            isSigner[signer] = true;
            signers.push(signer);
        }
    }

    function signerList() external view returns (address[] memory) {
        return signers;
    }

    function signerCount() external view returns (uint256) {
        return signers.length;
    }

    function paymentCount() external view returns (uint256) {
        return payments.length;
    }

    /// @notice What the treasury holds, by its own accounting
    function balance() public view returns (uint256) {
        return received - spent;
    }

    /// @notice More than half the signers. Fixed, because the signer list is.
    function approvalsNeeded() public view returns (uint32) {
        return uint32(signers.length / 2 + 1);
    }

    /**
     * @notice Pay money in. Anyone may: revenue does not need permission.
     * @dev Counted from this call, so a stray transfer to the address cannot be
     *      spent as though it had been recorded.
     */
    function fund(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        received += amount;
        emit Funded(msg.sender, amount, balance());
        if (!token.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
    }

    /// @notice Propose a payment. Proposing is not approving.
    function propose(address to, uint256 amount, string calldata reason) external onlySigner returns (uint256 id) {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (amount > balance()) revert NotEnoughFunds();

        uint64 expiresAt = uint64(block.timestamp) + VOTING_WINDOW;
        id = payments.length;
        payments.push(
            Payment({to: to, amount: amount, reason: reason, proposer: msg.sender, expiresAt: expiresAt, executed: false, approvals: 0})
        );
        emit Proposed(id, msg.sender, to, amount, reason, expiresAt);
    }

    /// @notice Approve a payment, and make it if that was the deciding approval.
    function approve(uint256 id) external onlySigner {
        if (id >= payments.length) revert NoPayment();
        Payment storage p = payments[id];
        if (p.executed) revert AlreadyExecuted();
        if (block.timestamp >= p.expiresAt) revert Expired();
        if (hasApproved[id][msg.sender]) revert AlreadyApproved();

        hasApproved[id][msg.sender] = true;
        p.approvals += 1;
        uint32 needed = approvalsNeeded();
        emit Approved(id, msg.sender, p.approvals, needed);

        if (p.approvals >= needed) {
            // The balance is rechecked here: another payment may have gone out
            // between this proposal and its final approval
            if (p.amount > balance()) revert NotEnoughFunds();
            p.executed = true;
            spent += p.amount;
            emit Paid(id, p.to, p.amount);
            if (!token.transfer(p.to, p.amount)) revert TransferFailed();
        }
    }

    function paymentAt(uint256 id)
        external
        view
        returns (address to, uint256 amount, string memory reason, address proposer, uint64 expiresAt, bool executed, uint32 approvals, uint32 needed)
    {
        Payment storage p = payments[id];
        return (p.to, p.amount, p.reason, p.proposer, p.expiresAt, p.executed, p.approvals, approvalsNeeded());
    }

    /// @notice Payments still waiting on approvals, for the notifications tab
    function openPayments() external view returns (uint256[] memory ids) {
        uint256 open;
        for (uint256 i = 0; i < payments.length; i++) {
            if (!payments[i].executed && block.timestamp < payments[i].expiresAt) open++;
        }
        ids = new uint256[](open);
        uint256 n;
        for (uint256 i = 0; i < payments.length && n < open; i++) {
            if (!payments[i].executed && block.timestamp < payments[i].expiresAt) ids[n++] = i;
        }
    }

    /// @notice Whether this signer still owes an approval on this payment
    function awaitingApproval(uint256 id, address signer) external view returns (bool) {
        if (id >= payments.length || !isSigner[signer]) return false;
        Payment storage p = payments[id];
        return !p.executed && block.timestamp < p.expiresAt && !hasApproved[id][signer];
    }
}

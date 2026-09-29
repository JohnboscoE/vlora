// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/**
 * @title Fundraiser
 * @notice One fundraise: anyone may contribute USDC, the beneficiary may withdraw
 *         what has been raised, and contributors get their money back if the
 *         deadline passes without the target being met.
 *
 * @dev The contract holds other people's money, so it does as little as possible:
 *
 *      - No owner, no admin, no upgrade path, no pause. Nobody — including the
 *        deployer — can move funds except by the rules below.
 *      - The beneficiary is fixed at creation and can never be changed. A
 *        fundraiser whose payout address can be edited is a fundraiser that can
 *        be stolen.
 *      - Withdrawals are allowed only once the target is reached. Refunds are
 *        allowed only after the deadline with the target unmet. The two are
 *        mutually exclusive by construction, so the same USDC can never be both
 *        withdrawn and refunded.
 *      - Funds are counted from an explicit `contribute` call rather than the
 *        token balance, so a stray transfer to this address can neither inflate
 *        progress nor be withdrawn.
 *
 *      Token assumption: USDC on Arc returns true and reverts on failure. Return
 *      values are checked anyway, for tokens that report failure instead.
 */
interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract Fundraiser {
    /// @notice The token every contribution is made in
    IERC20 public immutable token;
    /// @notice Who receives the money once the target is reached
    address public immutable beneficiary;
    /// @notice What the fundraise is for, shown by the app
    string public title;
    /// @notice The amount that unlocks a withdrawal
    uint256 public immutable target;
    /// @notice After this, an unmet fundraise refunds
    uint64 public immutable deadline;

    /// @notice Total contributed, counted from calls rather than balance
    uint256 public raised;
    /// @notice Total already paid out to the beneficiary
    uint256 public withdrawn;
    /// @notice What each contributor put in, minus anything refunded
    mapping(address => uint256) public contributions;

    event Contributed(address indexed from, uint256 amount, uint256 raised);
    event Withdrawn(address indexed to, uint256 amount);
    event Refunded(address indexed to, uint256 amount);

    error ZeroAddress();
    error ZeroAmount();
    error BadDeadline();
    error Closed();
    error NotBeneficiary();
    error TargetNotMet();
    error NothingToWithdraw();
    error StillOpen();
    error TargetMet();
    error NothingToRefund();
    error TransferFailed();

    constructor(IERC20 token_, address beneficiary_, string memory title_, uint256 target_, uint64 deadline_) {
        if (address(token_) == address(0) || beneficiary_ == address(0)) revert ZeroAddress();
        if (target_ == 0) revert ZeroAmount();
        if (deadline_ <= block.timestamp) revert BadDeadline();
        token = token_;
        beneficiary = beneficiary_;
        title = title_;
        target = target_;
        deadline = deadline_;
    }

    /// @notice True once enough has been raised for the beneficiary to withdraw
    function targetMet() public view returns (bool) {
        return raised >= target;
    }

    /// @notice True once the deadline has passed
    function ended() public view returns (bool) {
        return block.timestamp >= deadline;
    }

    /**
     * @notice Contribute `amount`. Requires an allowance for this contract.
     * @dev Contributions stop at the deadline. They are allowed after the target
     *      is met — people top up a fundraise that has already succeeded — and
     *      the extra is withdrawable like the rest.
     */
    function contribute(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        if (ended()) revert Closed();

        // Effects before interaction: the balance is recorded before the token moves
        raised += amount;
        contributions[msg.sender] += amount;
        emit Contributed(msg.sender, amount, raised);

        if (!token.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
    }

    /**
     * @notice Send everything raised so far to the beneficiary.
     * @dev Callable by the beneficiary only, and only once the target is met.
     *      Anyone may call it after that point on the beneficiary's behalf?  No:
     *      restricting it keeps the payout deliberate, and the beneficiary is the
     *      only party with an interest in the timing.
     */
    function withdraw() external {
        if (msg.sender != beneficiary) revert NotBeneficiary();
        if (!targetMet()) revert TargetNotMet();

        uint256 amount = raised - withdrawn;
        if (amount == 0) revert NothingToWithdraw();

        withdrawn = raised;
        emit Withdrawn(beneficiary, amount);

        if (!token.transfer(beneficiary, amount)) revert TransferFailed();
    }

    /**
     * @notice Take your contribution back, once the fundraise has failed.
     * @dev Only after the deadline, and only if the target was never met. A
     *      refund zeroes the contribution before transferring, so a re-entrant
     *      token cannot claim twice.
     */
    function refund() external {
        if (!ended()) revert StillOpen();
        if (targetMet()) revert TargetMet();

        uint256 amount = contributions[msg.sender];
        if (amount == 0) revert NothingToRefund();

        contributions[msg.sender] = 0;
        raised -= amount;
        emit Refunded(msg.sender, amount);

        if (!token.transfer(msg.sender, amount)) revert TransferFailed();
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Fundraiser, IERC20} from "./Fundraiser.sol";

/**
 * @title FundraiserFactory
 * @notice Creates fundraisers and keeps a list of them, so the app can show what
 *         exists without an indexer.
 *
 * @dev The factory has no owner and holds no money. It cannot touch a fundraiser
 *      once created: each one is its own contract with its own beneficiary, and
 *      nothing here can pause, edit or drain it.
 *
 *      The list is public on purpose — a fundraise nobody can find is not a
 *      fundraise. A group pot that should stay private does not belong here.
 */
contract FundraiserFactory {
    /// @notice The token every fundraiser created here accepts
    IERC20 public immutable token;

    /// @notice Every fundraiser, oldest first
    address[] public fundraisers;
    /// @notice The fundraisers a given address created
    mapping(address => address[]) public createdBy;

    event FundraiserCreated(
        address indexed fundraiser,
        address indexed creator,
        address indexed beneficiary,
        string title,
        uint256 target,
        uint64 deadline
    );

    error ZeroAddress();

    constructor(IERC20 token_) {
        if (address(token_) == address(0)) revert ZeroAddress();
        token = token_;
    }

    /**
     * @notice Start a fundraise.
     * @param beneficiary who receives the money if the target is met
     * @param title what it is for
     * @param target the amount that unlocks a withdrawal
     * @param deadline when contributions stop and refunds open
     */
    function create(address beneficiary, string calldata title, uint256 target, uint64 deadline) external returns (Fundraiser raise) {
        raise = new Fundraiser(token, beneficiary, title, target, deadline);
        fundraisers.push(address(raise));
        createdBy[msg.sender].push(address(raise));
        emit FundraiserCreated(address(raise), msg.sender, beneficiary, title, target, deadline);
    }

    function count() external view returns (uint256) {
        return fundraisers.length;
    }

    /// @notice A page of fundraisers, newest first
    function page(uint256 offset, uint256 limit) external view returns (address[] memory items) {
        uint256 total = fundraisers.length;
        if (offset >= total) return new address[](0);
        uint256 size = total - offset < limit ? total - offset : limit;
        items = new address[](size);
        for (uint256 i = 0; i < size; i++) {
            items[i] = fundraisers[total - 1 - offset - i];
        }
    }

    function countCreatedBy(address creator) external view returns (uint256) {
        return createdBy[creator].length;
    }
}

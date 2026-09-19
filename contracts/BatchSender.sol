// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title BatchSender
/// @notice Sends an ERC-20 token from the caller to many recipients in one transaction.
/// @dev Deliberately minimal: no owner, no upgradeability, no fees, and it never holds
///      funds — each amount moves directly from `msg.sender` to its recipient via
///      `transferFrom`, so the caller must first `approve` this contract for the total.
///      The whole batch is atomic: if any transfer fails, every transfer reverts.
contract BatchSender {
    using SafeERC20 for IERC20;

    /// @notice Upper bound on recipients per batch, to keep gas per tx predictable.
    uint256 public constant MAX_RECIPIENTS = 200;

    error EmptyBatch();
    error LengthMismatch(uint256 recipients, uint256 amounts);
    error TooManyRecipients(uint256 count, uint256 max);
    error ZeroRecipient(uint256 index);
    error ZeroAmount(uint256 index);

    /// @notice Emitted once per successful batch.
    event BatchSent(IERC20 indexed token, address indexed sender, uint256 recipientCount, uint256 total);

    /// @notice Transfers `amounts[i]` of `token` from the caller to `recipients[i]` for every i.
    /// @param token The ERC-20 token to send (USDC on Arc).
    /// @param recipients Recipient addresses; duplicates are allowed and each is paid separately.
    /// @param amounts Amounts in the token's smallest unit, index-aligned with `recipients`.
    function batchTransfer(IERC20 token, address[] calldata recipients, uint256[] calldata amounts) external {
        uint256 count = recipients.length;
        if (count == 0) revert EmptyBatch();
        if (count != amounts.length) revert LengthMismatch(count, amounts.length);
        if (count > MAX_RECIPIENTS) revert TooManyRecipients(count, MAX_RECIPIENTS);

        uint256 total;
        for (uint256 i; i < count; ++i) {
            address to = recipients[i];
            uint256 amount = amounts[i];
            if (to == address(0)) revert ZeroRecipient(i);
            if (amount == 0) revert ZeroAmount(i);

            total += amount;
            token.safeTransferFrom(msg.sender, to, amount);
        }

        emit BatchSent(token, msg.sender, count, total);
    }
}

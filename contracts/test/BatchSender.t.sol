// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {BatchSender} from "../BatchSender.sol";

/// 6-decimal stand-in for USDC
contract MockUSDC is ERC20 {
    constructor() ERC20("USD Coin", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract BatchSenderTest is Test {
    BatchSender internal sender;
    MockUSDC internal usdc;

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");
    address internal payer = makeAddr("payer");

    event BatchSent(IERC20 indexed token, address indexed sender, uint256 recipientCount, uint256 total);

    function setUp() public {
        sender = new BatchSender();
        usdc = new MockUSDC();
        usdc.mint(payer, 1_000e6);
    }

    function _pair(address a, address b) internal pure returns (address[] memory r) {
        r = new address[](2);
        r[0] = a;
        r[1] = b;
    }

    function _amounts(uint256 a, uint256 b) internal pure returns (uint256[] memory r) {
        r = new uint256[](2);
        r[0] = a;
        r[1] = b;
    }

    function test_sendsEachAmountToEachRecipient() public {
        address[] memory recipients = new address[](3);
        recipients[0] = alice;
        recipients[1] = bob;
        recipients[2] = carol;
        uint256[] memory amounts = new uint256[](3);
        amounts[0] = 10e6;
        amounts[1] = 25_500_000; // 25.5 USDC
        amounts[2] = 1; // smallest unit

        vm.startPrank(payer);
        usdc.approve(address(sender), 35_500_001);
        vm.expectEmit(true, true, false, true);
        emit BatchSent(usdc, payer, 3, 35_500_001);
        sender.batchTransfer(usdc, recipients, amounts);
        vm.stopPrank();

        assertEq(usdc.balanceOf(alice), 10e6);
        assertEq(usdc.balanceOf(bob), 25_500_000);
        assertEq(usdc.balanceOf(carol), 1);
        assertEq(usdc.balanceOf(payer), 1_000e6 - 35_500_001);
        assertEq(usdc.balanceOf(address(sender)), 0, "contract must never hold funds");
        assertEq(usdc.allowance(payer, address(sender)), 0, "exact approval fully consumed");
    }

    function test_duplicateRecipientsArePaidEachTime() public {
        vm.startPrank(payer);
        usdc.approve(address(sender), 3e6);
        sender.batchTransfer(usdc, _pair(alice, alice), _amounts(1e6, 2e6));
        vm.stopPrank();

        assertEq(usdc.balanceOf(alice), 3e6);
    }

    function test_revertsAtomicallyWhenAllowanceRunsOut() public {
        vm.startPrank(payer);
        usdc.approve(address(sender), 15e6); // enough for the first transfer only
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(sender), 5e6, 10e6)
        );
        sender.batchTransfer(usdc, _pair(alice, bob), _amounts(10e6, 10e6));
        vm.stopPrank();

        // First transfer was rolled back too
        assertEq(usdc.balanceOf(alice), 0);
        assertEq(usdc.balanceOf(payer), 1_000e6);
    }

    function test_revertsAtomicallyWhenBalanceRunsOut() public {
        vm.startPrank(payer);
        usdc.approve(address(sender), type(uint256).max);
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, payer, 400e6, 600e6)
        );
        sender.batchTransfer(usdc, _pair(alice, bob), _amounts(600e6, 600e6));
        vm.stopPrank();

        assertEq(usdc.balanceOf(alice), 0);
        assertEq(usdc.balanceOf(payer), 1_000e6);
    }

    function test_cannotSpendSomeoneElsesApproval() public {
        vm.prank(payer);
        usdc.approve(address(sender), 100e6);

        // An attacker calling batchTransfer only ever pulls from themselves
        address attacker = makeAddr("attacker");
        vm.prank(attacker);
        vm.expectRevert();
        sender.batchTransfer(usdc, _pair(attacker, attacker), _amounts(50e6, 50e6));

        assertEq(usdc.balanceOf(payer), 1_000e6);
    }

    function test_revertsOnEmptyBatch() public {
        vm.expectRevert(BatchSender.EmptyBatch.selector);
        sender.batchTransfer(usdc, new address[](0), new uint256[](0));
    }

    function test_revertsOnLengthMismatch() public {
        vm.expectRevert(abi.encodeWithSelector(BatchSender.LengthMismatch.selector, 2, 1));
        sender.batchTransfer(usdc, _pair(alice, bob), new uint256[](1));
    }

    function test_revertsOnZeroRecipient() public {
        vm.startPrank(payer);
        usdc.approve(address(sender), 2e6);
        vm.expectRevert(abi.encodeWithSelector(BatchSender.ZeroRecipient.selector, 1));
        sender.batchTransfer(usdc, _pair(alice, address(0)), _amounts(1e6, 1e6));
        vm.stopPrank();
    }

    function test_revertsOnZeroAmount() public {
        vm.startPrank(payer);
        usdc.approve(address(sender), 2e6);
        vm.expectRevert(abi.encodeWithSelector(BatchSender.ZeroAmount.selector, 0));
        sender.batchTransfer(usdc, _pair(alice, bob), _amounts(0, 1e6));
        vm.stopPrank();
    }

    function test_revertsAboveMaxRecipients() public {
        uint256 n = sender.MAX_RECIPIENTS() + 1;
        vm.expectRevert(abi.encodeWithSelector(BatchSender.TooManyRecipients.selector, n, n - 1));
        sender.batchTransfer(usdc, new address[](n), new uint256[](n));
    }

    function test_handlesMaxRecipients() public {
        uint256 n = sender.MAX_RECIPIENTS();
        address[] memory recipients = new address[](n);
        uint256[] memory amounts = new uint256[](n);
        for (uint256 i; i < n; ++i) {
            recipients[i] = address(uint160(0x1000 + i));
            amounts[i] = 1e6;
        }

        vm.startPrank(payer);
        usdc.approve(address(sender), n * 1e6);
        sender.batchTransfer(usdc, recipients, amounts);
        vm.stopPrank();

        assertEq(usdc.balanceOf(address(uint160(0x1000 + n - 1))), 1e6);
        assertEq(usdc.balanceOf(payer), 1_000e6 - n * 1e6);
    }

    function testFuzz_totalDebitedEqualsSumOfAmounts(uint64 a, uint64 b) public {
        vm.assume(a > 0 && b > 0);
        uint256 total = uint256(a) + uint256(b);
        usdc.mint(payer, total);

        vm.startPrank(payer);
        usdc.approve(address(sender), total);
        uint256 before = usdc.balanceOf(payer);
        sender.batchTransfer(usdc, _pair(alice, bob), _amounts(a, b));
        vm.stopPrank();

        assertEq(before - usdc.balanceOf(payer), total);
        assertEq(usdc.balanceOf(alice), a);
        assertEq(usdc.balanceOf(bob), b);
    }
}

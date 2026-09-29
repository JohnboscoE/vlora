// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Fundraiser, IERC20} from "../Fundraiser.sol";

contract Token6 is ERC20 {
    constructor() ERC20("USD Coin", "USDC") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 a) external { _mint(to, a); }
}

/// Tries to refund again from inside the token transfer
contract Reentrant {
    Fundraiser immutable raise;
    bool entered;
    constructor(Fundraiser r) { raise = r; }
    function give(Token6 token, uint256 amount) external {
        token.approve(address(raise), amount);
        raise.contribute(amount);
    }
    function take() external { raise.refund(); }
    receive() external payable {}
    // ERC20 hook stand-in: the test token calls back through transfer
    function onTokenTransfer() external {
        if (entered) return;
        entered = true;
        raise.refund();
    }
}

contract FundraiserTest is Test {
    Token6 usdc;
    Fundraiser raise;

    address beneficiary = address(0xBE);
    address alice = address(0xA1);
    address bob = address(0xB0);

    uint256 constant TARGET = 1_000e6;
    uint64 deadline;

    function setUp() public {
        usdc = new Token6();
        deadline = uint64(block.timestamp + 7 days);
        raise = new Fundraiser(IERC20(address(usdc)), beneficiary, "School fees", TARGET, deadline);

        usdc.mint(alice, 10_000e6);
        usdc.mint(bob, 10_000e6);
    }

    function _give(address who, uint256 amount) internal {
        vm.startPrank(who);
        usdc.approve(address(raise), amount);
        raise.contribute(amount);
        vm.stopPrank();
    }

    // --- what it is for ---

    function test_contribute_records_and_holds() public {
        _give(alice, 400e6);
        assertEq(raise.raised(), 400e6);
        assertEq(raise.contributions(alice), 400e6);
        assertEq(usdc.balanceOf(address(raise)), 400e6);
        assertFalse(raise.targetMet());
    }

    function test_beneficiary_withdraws_once_target_met() public {
        _give(alice, 600e6);
        _give(bob, 400e6);
        assertTrue(raise.targetMet());

        vm.prank(beneficiary);
        raise.withdraw();
        assertEq(usdc.balanceOf(beneficiary), 1_000e6);
        assertEq(usdc.balanceOf(address(raise)), 0);
    }

    function test_withdraw_takes_later_contributions_too() public {
        _give(alice, 1_000e6);
        vm.prank(beneficiary);
        raise.withdraw();

        _give(bob, 250e6);
        vm.prank(beneficiary);
        raise.withdraw();
        assertEq(usdc.balanceOf(beneficiary), 1_250e6);
    }

    // --- who may do what ---

    function test_only_beneficiary_withdraws() public {
        _give(alice, 1_000e6);
        vm.prank(alice);
        vm.expectRevert(Fundraiser.NotBeneficiary.selector);
        raise.withdraw();
    }

    function test_no_withdraw_before_target() public {
        _give(alice, 999e6);
        vm.prank(beneficiary);
        vm.expectRevert(Fundraiser.TargetNotMet.selector);
        raise.withdraw();
    }

    function test_no_second_withdraw_of_the_same_money() public {
        _give(alice, 1_000e6);
        vm.startPrank(beneficiary);
        raise.withdraw();
        vm.expectRevert(Fundraiser.NothingToWithdraw.selector);
        raise.withdraw();
        vm.stopPrank();
    }

    // --- refunds ---

    function test_refund_after_a_failed_deadline() public {
        _give(alice, 300e6);
        _give(bob, 200e6);
        vm.warp(deadline);

        vm.prank(alice);
        raise.refund();
        assertEq(usdc.balanceOf(alice), 10_000e6);
        assertEq(raise.contributions(alice), 0);
        // Bob's money is untouched by Alice's refund
        assertEq(raise.contributions(bob), 200e6);
        assertEq(usdc.balanceOf(address(raise)), 200e6);
    }

    function test_no_refund_while_open() public {
        _give(alice, 300e6);
        vm.prank(alice);
        vm.expectRevert(Fundraiser.StillOpen.selector);
        raise.refund();
    }

    function test_no_refund_when_the_target_was_met() public {
        _give(alice, 1_000e6);
        vm.warp(deadline);
        vm.prank(alice);
        vm.expectRevert(Fundraiser.TargetMet.selector);
        raise.refund();
    }

    function test_no_double_refund() public {
        _give(alice, 300e6);
        vm.warp(deadline);
        vm.startPrank(alice);
        raise.refund();
        vm.expectRevert(Fundraiser.NothingToRefund.selector);
        raise.refund();
        vm.stopPrank();
    }

    function test_non_contributor_cannot_refund() public {
        _give(alice, 300e6);
        vm.warp(deadline);
        vm.prank(bob);
        vm.expectRevert(Fundraiser.NothingToRefund.selector);
        raise.refund();
    }

    // --- the money can only leave one way ---

    function test_withdraw_and_refund_are_mutually_exclusive() public {
        _give(alice, 1_000e6);
        vm.warp(deadline);

        // Target met: refunds are closed for good
        vm.prank(alice);
        vm.expectRevert(Fundraiser.TargetMet.selector);
        raise.refund();

        // And the beneficiary can still take it after the deadline
        vm.prank(beneficiary);
        raise.withdraw();
        assertEq(usdc.balanceOf(beneficiary), 1_000e6);
    }

    function test_contributions_close_at_the_deadline() public {
        vm.warp(deadline);
        vm.startPrank(alice);
        usdc.approve(address(raise), 100e6);
        vm.expectRevert(Fundraiser.Closed.selector);
        raise.contribute(100e6);
        vm.stopPrank();
    }

    /// A stray transfer is not a contribution: it cannot inflate progress, and it
    /// cannot be withdrawn as though someone had given it
    function test_a_stray_transfer_changes_nothing() public {
        vm.prank(alice);
        usdc.transfer(address(raise), 5_000e6);

        assertEq(raise.raised(), 0);
        assertFalse(raise.targetMet());
        vm.prank(beneficiary);
        vm.expectRevert(Fundraiser.TargetNotMet.selector);
        raise.withdraw();
    }

    // --- refusals at the door ---

    function test_zero_contribution_is_refused() public {
        vm.prank(alice);
        vm.expectRevert(Fundraiser.ZeroAmount.selector);
        raise.contribute(0);
    }

    function test_constructor_refuses_nonsense() public {
        vm.expectRevert(Fundraiser.ZeroAddress.selector);
        new Fundraiser(IERC20(address(0)), beneficiary, "x", TARGET, deadline);

        vm.expectRevert(Fundraiser.ZeroAddress.selector);
        new Fundraiser(IERC20(address(usdc)), address(0), "x", TARGET, deadline);

        vm.expectRevert(Fundraiser.ZeroAmount.selector);
        new Fundraiser(IERC20(address(usdc)), beneficiary, "x", 0, deadline);

        vm.expectRevert(Fundraiser.BadDeadline.selector);
        new Fundraiser(IERC20(address(usdc)), beneficiary, "x", TARGET, uint64(block.timestamp));
    }

    // --- the accounting holds whatever the order ---

    function testFuzz_raised_equals_the_sum_of_what_is_owed(uint96 a, uint96 b) public {
        vm.assume(a > 0 && b > 0);
        vm.assume(uint256(a) + uint256(b) < 9_000e6);
        _give(alice, a);
        _give(bob, b);
        assertEq(raise.raised(), uint256(a) + uint256(b));
        assertEq(raise.contributions(alice) + raise.contributions(bob), raise.raised());
        assertEq(usdc.balanceOf(address(raise)), raise.raised());
    }

    function testFuzz_refunds_never_exceed_what_was_given(uint96 a) public {
        vm.assume(a > 0 && a < TARGET);
        _give(alice, a);
        vm.warp(deadline);
        vm.prank(alice);
        raise.refund();
        assertEq(usdc.balanceOf(alice), 10_000e6);
        assertEq(raise.raised(), 0);
        assertEq(usdc.balanceOf(address(raise)), 0);
    }
}

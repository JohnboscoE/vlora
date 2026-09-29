// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Treasury, IERC20} from "../Treasury.sol";

contract Token6 is ERC20 {
    constructor() ERC20("USD Coin", "USDC") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 a) external { _mint(to, a); }
}

contract TreasuryTest is Test {
    Token6 usdc;
    Treasury treasury;

    address alice = address(0xA1);
    address bob = address(0xB0);
    address carol = address(0xC0);
    address outsider = address(0x0F);
    address customer = address(0xCC);
    address supplier = address(0x5E);

    function setUp() public {
        usdc = new Token6();
        address[] memory signers = new address[](3);
        signers[0] = alice;
        signers[1] = bob;
        signers[2] = carol;
        treasury = new Treasury(IERC20(address(usdc)), "Acme Ltd", signers);

        usdc.mint(customer, 100_000e6);
        _fund(10_000e6);
    }

    function _fund(uint256 amount) internal {
        vm.startPrank(customer);
        usdc.approve(address(treasury), amount);
        treasury.fund(amount);
        vm.stopPrank();
    }

    // --- money in ---

    function test_anyone_may_pay_in() public {
        assertEq(treasury.balance(), 10_000e6);
        assertEq(usdc.balanceOf(address(treasury)), 10_000e6);
    }

    function test_a_stray_transfer_is_not_spendable() public {
        vm.prank(customer);
        usdc.transfer(address(treasury), 5_000e6);
        // The accounting ignores it, so it cannot be proposed away
        assertEq(treasury.balance(), 10_000e6);
        vm.prank(alice);
        vm.expectRevert(Treasury.NotEnoughFunds.selector);
        treasury.propose(supplier, 12_000e6, "too much");
    }

    // --- money out needs a majority ---

    function test_two_of_three_pays() public {
        vm.prank(alice);
        uint256 id = treasury.propose(supplier, 4_000e6, "Invoice 12");

        vm.prank(alice);
        treasury.approve(id);
        assertEq(usdc.balanceOf(supplier), 0, "one approval is not a majority");

        vm.prank(bob);
        treasury.approve(id);
        assertEq(usdc.balanceOf(supplier), 4_000e6);
        assertEq(treasury.balance(), 6_000e6);
    }

    function test_three_of_five_pays_but_two_does_not() public {
        address dave = address(0xD0);
        address erin = address(0xE0);
        address[] memory five = new address[](5);
        five[0] = alice; five[1] = bob; five[2] = carol; five[3] = dave; five[4] = erin;
        Treasury big = new Treasury(IERC20(address(usdc)), "Big Co", five);

        vm.startPrank(customer);
        usdc.approve(address(big), 1_000e6);
        big.fund(1_000e6);
        vm.stopPrank();

        assertEq(big.approvalsNeeded(), 3);
        vm.prank(alice);
        uint256 id = big.propose(supplier, 500e6, "Invoice");
        vm.prank(alice);
        big.approve(id);
        vm.prank(bob);
        big.approve(id);
        assertEq(usdc.balanceOf(supplier), 0);
        vm.prank(carol);
        big.approve(id);
        assertEq(usdc.balanceOf(supplier), 500e6);
    }

    function test_only_signers_propose_or_approve() public {
        vm.prank(outsider);
        vm.expectRevert(Treasury.NotSigner.selector);
        treasury.propose(supplier, 100e6, "nope");

        vm.prank(alice);
        uint256 id = treasury.propose(supplier, 100e6, "Invoice");
        vm.prank(outsider);
        vm.expectRevert(Treasury.NotSigner.selector);
        treasury.approve(id);
    }

    function test_proposing_is_not_approving() public {
        vm.prank(alice);
        uint256 id = treasury.propose(supplier, 100e6, "Invoice");
        (, , , , , , uint32 approvals, uint32 needed) = treasury.paymentAt(id);
        assertEq(approvals, 0);
        assertEq(needed, 2);
    }

    function test_no_double_approval() public {
        vm.startPrank(alice);
        uint256 id = treasury.propose(supplier, 100e6, "Invoice");
        treasury.approve(id);
        vm.expectRevert(Treasury.AlreadyApproved.selector);
        treasury.approve(id);
        vm.stopPrank();
    }

    function test_a_payment_expires_after_seven_days() public {
        vm.prank(alice);
        uint256 id = treasury.propose(supplier, 100e6, "Invoice");
        vm.prank(alice);
        treasury.approve(id);

        vm.warp(block.timestamp + 7 days);
        vm.prank(bob);
        vm.expectRevert(Treasury.Expired.selector);
        treasury.approve(id);
        assertEq(usdc.balanceOf(supplier), 0);
    }

    function test_a_paid_payment_cannot_be_paid_again() public {
        vm.prank(alice);
        uint256 id = treasury.propose(supplier, 100e6, "Invoice");
        vm.prank(alice);
        treasury.approve(id);
        vm.prank(bob);
        treasury.approve(id);

        vm.prank(carol);
        vm.expectRevert(Treasury.AlreadyExecuted.selector);
        treasury.approve(id);
        assertEq(usdc.balanceOf(supplier), 100e6);
    }

    /// Two proposals that each fit, but not together: the second must fail at the
    /// final approval rather than overdrawing the treasury
    function test_the_balance_is_rechecked_when_the_last_approval_lands() public {
        vm.startPrank(alice);
        uint256 first = treasury.propose(supplier, 7_000e6, "One");
        uint256 second = treasury.propose(supplier, 6_000e6, "Two");
        treasury.approve(first);
        treasury.approve(second);
        vm.stopPrank();

        vm.prank(bob);
        treasury.approve(first);
        assertEq(usdc.balanceOf(supplier), 7_000e6);
        assertEq(treasury.balance(), 3_000e6);

        vm.prank(bob);
        vm.expectRevert(Treasury.NotEnoughFunds.selector);
        treasury.approve(second);
        assertEq(usdc.balanceOf(supplier), 7_000e6, "the treasury is not overdrawn");
    }

    function test_cannot_propose_more_than_is_held() public {
        vm.prank(alice);
        vm.expectRevert(Treasury.NotEnoughFunds.selector);
        treasury.propose(supplier, 10_001e6, "too much");
    }

    // --- what the notifications tab reads ---

    function test_open_payments_and_who_still_owes_an_approval() public {
        vm.prank(alice);
        uint256 id = treasury.propose(supplier, 100e6, "Invoice");

        uint256[] memory open = treasury.openPayments();
        assertEq(open.length, 1);
        assertEq(open[0], id);
        assertTrue(treasury.awaitingApproval(id, bob));
        assertFalse(treasury.awaitingApproval(id, outsider), "not a signer");

        vm.prank(alice);
        treasury.approve(id);
        assertFalse(treasury.awaitingApproval(id, alice), "already approved");
        assertTrue(treasury.awaitingApproval(id, carol));
    }

    function test_an_expired_payment_is_no_longer_open() public {
        vm.prank(alice);
        treasury.propose(supplier, 100e6, "Invoice");
        vm.warp(block.timestamp + 7 days);
        assertEq(treasury.openPayments().length, 0);
    }

    // --- refusals at the door ---

    function test_three_signers_minimum() public {
        address[] memory two = new address[](2);
        two[0] = alice;
        two[1] = bob;
        vm.expectRevert(Treasury.TooFewSigners.selector);
        new Treasury(IERC20(address(usdc)), "Too small", two);
    }

    function test_no_duplicate_signers() public {
        address[] memory dupes = new address[](3);
        dupes[0] = alice;
        dupes[1] = bob;
        dupes[2] = alice;
        vm.expectRevert(Treasury.DuplicateSigner.selector);
        new Treasury(IERC20(address(usdc)), "Dupes", dupes);
    }

    function testFuzz_what_goes_out_never_exceeds_what_came_in(uint96 amount) public {
        uint256 spend = bound(uint256(amount), 1, 10_000e6);
        vm.prank(alice);
        uint256 id = treasury.propose(supplier, spend, "spend");
        vm.prank(alice);
        treasury.approve(id);
        vm.prank(bob);
        treasury.approve(id);

        assertEq(treasury.balance(), 10_000e6 - spend);
        assertEq(usdc.balanceOf(address(treasury)), treasury.balance());
        assertLe(treasury.spent(), treasury.received());
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {TeamUp, IERC20} from "../TeamUp.sol";

contract Token6 is ERC20 {
    constructor() ERC20("USD Coin", "USDC") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 a) external { _mint(to, a); }
}

contract TeamUpTest is Test {
    Token6 usdc;
    TeamUp team;

    address alice = address(0xA1);
    address bob = address(0xB0);
    address carol = address(0xC0);
    address dave = address(0xD0);
    address supplier = address(0x5E);

    function setUp() public {
        usdc = new Token6();
        address[] memory members = new address[](3);
        members[0] = alice;
        members[1] = bob;
        members[2] = carol;
        // 5% breaking fee
        team = new TeamUp(IERC20(address(usdc)), members, "Shop stock", 3_000e6, 500);

        for (uint256 i = 0; i < members.length; i++) usdc.mint(members[i], 10_000e6);
    }

    function _put(address who, uint256 amount) internal {
        vm.startPrank(who);
        usdc.approve(address(team), amount);
        team.contribute(amount);
        vm.stopPrank();
    }

    function _all(uint256 each) internal {
        _put(alice, each);
        _put(bob, each);
        _put(carol, each);
    }

    // --- contributing ---

    function test_members_contribute_and_the_pot_adds_up() public {
        _all(1_000e6);
        assertEq(team.pot(), 3_000e6);
        assertEq(team.contributions(alice), 1_000e6);
        assertEq(usdc.balanceOf(address(team)), 3_000e6);
    }

    function test_outsiders_cannot_contribute() public {
        vm.startPrank(dave);
        usdc.mint(dave, 100e6);
        usdc.approve(address(team), 100e6);
        vm.expectRevert(TeamUp.NotMember.selector);
        team.contribute(100e6);
        vm.stopPrank();
    }

    // --- the vote is the gate ---

    function test_any_member_may_propose() public {
        _all(1_000e6);
        vm.prank(carol);
        uint256 id = team.propose(supplier, 900e6, "Stock");
        assertEq(id, 0);
    }

    function test_outsiders_cannot_propose() public {
        _all(1_000e6);
        vm.prank(dave);
        vm.expectRevert(TeamUp.NotMember.selector);
        team.propose(supplier, 100e6, "nope");
    }

    function test_proposing_is_not_voting() public {
        _all(1_000e6);
        vm.prank(alice);
        uint256 id = team.propose(supplier, 900e6, "Stock");
        (, , , , , , uint32 votes, uint32 needed) = team.proposalAt(id);
        assertEq(votes, 0);
        assertEq(needed, 2); // three active members: more than half is two
    }

    function test_a_majority_pays_out() public {
        _all(1_000e6);
        vm.prank(alice);
        uint256 id = team.propose(supplier, 900e6, "Stock");

        vm.prank(alice);
        team.approve(id);
        assertEq(usdc.balanceOf(supplier), 0, "one vote is not a majority");

        vm.prank(bob);
        team.approve(id);
        assertEq(usdc.balanceOf(supplier), 900e6, "two of three carries it");
        assertEq(team.pot(), 2_100e6);
    }

    function test_half_is_not_a_majority() public {
        address[] memory four = new address[](4);
        four[0] = alice; four[1] = bob; four[2] = carol; four[3] = dave;
        TeamUp big = new TeamUp(IERC20(address(usdc)), four, "Four", 0, 0);
        usdc.mint(dave, 10_000e6);

        for (uint256 i = 0; i < four.length; i++) {
            vm.startPrank(four[i]);
            usdc.approve(address(big), 1_000e6);
            big.contribute(1_000e6);
            vm.stopPrank();
        }

        vm.prank(alice);
        uint256 id = big.propose(supplier, 500e6, "half");
        vm.prank(alice);
        big.approve(id);
        vm.prank(bob);
        big.approve(id);
        // Two of four is half, not more than half
        assertEq(usdc.balanceOf(supplier), 0);
        vm.prank(carol);
        big.approve(id);
        assertEq(usdc.balanceOf(supplier), 500e6);
    }

    function test_nobody_votes_twice() public {
        _all(1_000e6);
        vm.startPrank(alice);
        uint256 id = team.propose(supplier, 900e6, "Stock");
        team.approve(id);
        vm.expectRevert(TeamUp.AlreadyVoted.selector);
        team.approve(id);
        vm.stopPrank();
    }

    function test_a_proposal_expires_after_seven_days() public {
        _all(1_000e6);
        vm.prank(alice);
        uint256 id = team.propose(supplier, 900e6, "Stock");
        vm.prank(alice);
        team.approve(id);

        vm.warp(block.timestamp + 7 days);
        vm.prank(bob);
        vm.expectRevert(TeamUp.Expired.selector);
        team.approve(id);
        assertEq(usdc.balanceOf(supplier), 0);
    }

    function test_an_executed_proposal_cannot_run_again() public {
        _all(1_000e6);
        vm.prank(alice);
        uint256 id = team.propose(supplier, 900e6, "Stock");
        vm.prank(alice);
        team.approve(id);
        vm.prank(bob);
        team.approve(id);

        vm.prank(carol);
        vm.expectRevert(TeamUp.AlreadyExecuted.selector);
        team.approve(id);
        assertEq(usdc.balanceOf(supplier), 900e6);
    }

    function test_cannot_propose_more_than_the_pot() public {
        _all(1_000e6);
        vm.prank(alice);
        vm.expectRevert(TeamUp.NotEnoughInPot.selector);
        team.propose(supplier, 3_001e6, "too much");
    }

    // --- leaving ---

    function test_leaving_returns_the_share_minus_the_fee() public {
        _all(1_000e6);
        vm.prank(alice);
        team.leave();

        // 5% of 1000 stays with the group
        assertEq(usdc.balanceOf(alice), 9_950e6);
        assertEq(team.contributions(alice), 0);
        assertEq(team.pot(), 2_050e6);
    }

    function test_a_leaver_stops_counting_toward_a_majority() public {
        _all(1_000e6);
        vm.prank(carol);
        team.leave();

        // Two active members left: more than half is two
        assertEq(team.votesNeeded(), 2);
        vm.prank(alice);
        uint256 id = team.propose(supplier, 500e6, "Stock");
        vm.prank(alice);
        team.approve(id);
        vm.prank(bob);
        team.approve(id);
        assertEq(usdc.balanceOf(supplier), 500e6);
    }

    function test_leaving_twice_returns_nothing() public {
        _all(1_000e6);
        vm.startPrank(alice);
        team.leave();
        vm.expectRevert(TeamUp.NothingToReturn.selector);
        team.leave();
        vm.stopPrank();
    }

    // --- the books balance ---

    function test_shares_still_sum_to_the_pot_after_a_payout() public {
        _all(1_000e6);
        vm.prank(alice);
        uint256 id = team.propose(supplier, 900e6, "Stock");
        vm.prank(alice);
        team.approve(id);
        vm.prank(bob);
        team.approve(id);

        uint256 sum = team.contributions(alice) + team.contributions(bob) + team.contributions(carol);
        assertEq(sum, team.pot());
        assertEq(usdc.balanceOf(address(team)), team.pot());
    }

    function testFuzz_shares_sum_to_the_pot(uint96 a, uint96 b, uint96 c, uint96 spend) public {
        // bound, not assume: assume throws away almost every uint96 and the run dies
        uint256 aa = bound(uint256(a), 1e6, 3_000e6);
        uint256 bb = bound(uint256(b), 1e6, 3_000e6);
        uint256 cc = bound(uint256(c), 1e6, 3_000e6);
        _put(alice, aa);
        _put(bob, bb);
        _put(carol, cc);
        uint256 total = aa + bb + cc;
        uint256 spending = bound(uint256(spend), 1, total);

        vm.prank(alice);
        uint256 id = team.propose(supplier, spending, "spend");
        vm.prank(alice);
        team.approve(id);
        vm.prank(bob);
        team.approve(id);

        assertEq(team.pot(), total - spending);
        assertEq(team.contributions(alice) + team.contributions(bob) + team.contributions(carol), team.pot());
        assertEq(usdc.balanceOf(address(team)), team.pot());
    }

    // --- what the notifications tab reads ---

    function test_open_proposals_and_who_still_owes_a_vote() public {
        _all(1_000e6);
        vm.prank(alice);
        uint256 id = team.propose(supplier, 500e6, "Stock");

        uint256[] memory open = team.openProposals();
        assertEq(open.length, 1);
        assertEq(open[0], id);
        assertTrue(team.awaitingVote(id, bob));
        assertFalse(team.awaitingVote(id, dave), "not a member");

        vm.prank(alice);
        team.approve(id);
        assertFalse(team.awaitingVote(id, alice), "already voted");
        assertTrue(team.awaitingVote(id, carol));
    }

    function test_an_expired_proposal_is_no_longer_open() public {
        _all(1_000e6);
        vm.prank(alice);
        team.propose(supplier, 500e6, "Stock");
        vm.warp(block.timestamp + 7 days);
        assertEq(team.openProposals().length, 0);
    }

    // --- refusals at the door ---

    function test_a_group_needs_three_people() public {
        address[] memory two = new address[](2);
        two[0] = alice;
        two[1] = bob;
        vm.expectRevert(TeamUp.TooFewMembers.selector);
        new TeamUp(IERC20(address(usdc)), two, "Two", 0, 0);
    }

    function test_no_duplicate_members() public {
        address[] memory dupes = new address[](3);
        dupes[0] = alice;
        dupes[1] = bob;
        dupes[2] = alice;
        vm.expectRevert(TeamUp.DuplicateMember.selector);
        new TeamUp(IERC20(address(usdc)), dupes, "Dupes", 0, 0);
    }

    function test_the_breaking_fee_is_capped() public {
        address[] memory members = new address[](3);
        members[0] = alice; members[1] = bob; members[2] = carol;
        vm.expectRevert(TeamUp.FeeTooHigh.selector);
        new TeamUp(IERC20(address(usdc)), members, "Greedy", 0, 1_001);
    }
}

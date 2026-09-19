// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AgentVault, AgentVaultFactory, ISwapRouter02} from "../AgentVault.sol";

contract Token6 is ERC20 {
    constructor(string memory n) ERC20(n, n) {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 a) external { _mint(to, a); }
}

/// Pulls tokenIn with transferFrom (like SwapRouter02) and pays tokenOut at rate/1e6
contract MockRouter is ISwapRouter02 {
    uint256 public rate = 850_000; // 1 in -> 0.85 out
    function setRate(uint256 r) external { rate = r; }
    function exactInputSingle(ExactInputSingleParams calldata p) external payable returns (uint256 out) {
        IERC20(p.tokenIn).transferFrom(msg.sender, address(this), p.amountIn);
        out = (p.amountIn * rate) / 1e6;
        require(out >= p.amountOutMinimum, "Too little received");
        Token6(p.tokenOut).mint(p.recipient, out);
    }
}

contract AgentVaultTest is Test {
    Token6 usdc;
    Token6 eurc;
    Token6 other;
    MockRouter router;
    AgentVaultFactory factory;
    AgentVault vault;

    address owner = makeAddr("owner");
    address agent = makeAddr("agent");
    address alice = makeAddr("alice");
    address attacker = makeAddr("attacker");

    function setUp() public {
        vm.warp(1_800_000_000);
        usdc = new Token6("USDC");
        eurc = new Token6("EURC");
        other = new Token6("OTHER");
        router = new MockRouter();
        factory = new AgentVaultFactory(address(router));

        address[] memory tokens = new address[](2);
        tokens[0] = address(usdc);
        tokens[1] = address(eurc);
        uint128[] memory perTx = new uint128[](2);
        perTx[0] = 50e6;
        perTx[1] = 50e6;
        uint128[] memory perDay = new uint128[](2);
        perDay[0] = 100e6;
        perDay[1] = 100e6;

        vm.prank(owner);
        vault = AgentVault(factory.createVault(agent, uint64(block.timestamp + 7 days), tokens, perTx, perDay));

        usdc.mint(address(vault), 1_000e6);
        other.mint(address(vault), 1_000e6);
    }

    // ── happy paths ──

    function test_OwnerAndFactoryWiring() public view {
        assertEq(vault.owner(), owner);
        assertEq(vault.agent(), agent);
        assertEq(factory.vaultsOf(owner)[0], address(vault));
        assertTrue(vault.agentActive());
    }

    function test_AgentTransfersWithoutOwnerSignature() public {
        vm.prank(agent);
        vault.agentTransfer(usdc, alice, 30e6);
        assertEq(usdc.balanceOf(alice), 30e6);
        assertEq(vault.remainingToday(address(usdc)), 70e6);
    }

    function test_AgentSwapPaysOutIntoVaultAndClearsApproval() public {
        vm.prank(agent);
        uint256 out = vault.agentSwap(usdc, eurc, 3000, 40e6, 30e6);
        assertEq(out, 34e6);
        assertEq(eurc.balanceOf(address(vault)), 34e6, "output lands in the vault, not the agent");
        assertEq(eurc.balanceOf(agent), 0);
        assertEq(usdc.allowance(address(vault), address(router)), 0, "no standing approval left behind");
        assertEq(vault.remainingToday(address(usdc)), 60e6, "swaps count toward the tokenIn cap");
    }

    // ── limits ──

    function test_RevertsOverPerTxLimit() public {
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(AgentVault.OverPerTxLimit.selector, 51e6, 50e6));
        vault.agentTransfer(usdc, alice, 51e6);
    }

    function test_RevertsOverDailyLimit_ThenResetsNextDay() public {
        vm.startPrank(agent);
        vault.agentTransfer(usdc, alice, 50e6);
        vault.agentTransfer(usdc, alice, 50e6);
        vm.expectRevert(abi.encodeWithSelector(AgentVault.OverDailyLimit.selector, 101e6, 100e6));
        vault.agentTransfer(usdc, alice, 1e6);

        vm.warp(block.timestamp + 1 days);
        vault.agentTransfer(usdc, alice, 50e6);
        vm.stopPrank();
        assertEq(usdc.balanceOf(alice), 150e6);
    }

    function test_RevertsForTokenWithoutLimit() public {
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(AgentVault.TokenNotAllowed.selector, address(other)));
        vault.agentTransfer(other, alice, 1e6);
    }

    function test_CannotSwapIntoUnapprovedToken() public {
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(AgentVault.TokenNotAllowed.selector, address(other)));
        vault.agentSwap(usdc, other, 3000, 10e6, 1);
    }

    function test_SwapRequiresMinimumOutput() public {
        vm.prank(agent);
        vm.expectRevert(AgentVault.NoMinimumOutput.selector);
        vault.agentSwap(usdc, eurc, 3000, 10e6, 0);
    }

    function test_SwapRevertsWhenPriceWorseThanMinimum_AndNothingIsSpent() public {
        vm.prank(agent);
        vm.expectRevert("Too little received");
        vault.agentSwap(usdc, eurc, 3000, 10e6, 9e6); // mock pays 8.5
        assertEq(vault.remainingToday(address(usdc)), 100e6, "failed swap doesn't consume allowance");
        assertEq(usdc.balanceOf(address(vault)), 1_000e6);
    }

    function test_RecipientAllowlistOnly() public {
        vm.prank(owner);
        vault.setRecipientAllowlistOnly(true);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(AgentVault.RecipientNotAllowed.selector, alice));
        vault.agentTransfer(usdc, alice, 1e6);

        vm.prank(owner);
        vault.setRecipientAllowed(alice, true);
        vm.prank(agent);
        vault.agentTransfer(usdc, alice, 1e6);
        assertEq(usdc.balanceOf(alice), 1e6);
    }

    // ── agent lifecycle ──

    function test_ExpiredAgentIsBlocked() public {
        vm.warp(block.timestamp + 7 days);
        vm.prank(agent);
        vm.expectRevert(AgentVault.NotActiveAgent.selector);
        vault.agentTransfer(usdc, alice, 1e6);
    }

    function test_PausedAgentIsBlocked_OwnerStillWithdraws() public {
        vm.prank(owner);
        vault.setPaused(true);
        vm.prank(agent);
        vm.expectRevert(AgentVault.NotActiveAgent.selector);
        vault.agentTransfer(usdc, alice, 1e6);

        vm.prank(owner);
        vault.withdraw(usdc, owner, 1_000e6);
        assertEq(usdc.balanceOf(owner), 1_000e6);
    }

    function test_RevokeAgent() public {
        vm.prank(owner);
        vault.revokeAgent();
        vm.prank(agent);
        vm.expectRevert(AgentVault.NotActiveAgent.selector);
        vault.agentTransfer(usdc, alice, 1e6);
        assertFalse(vault.agentActive());
    }

    // ── access control ──

    function test_StrangersCannotActAsAgent() public {
        vm.prank(attacker);
        vm.expectRevert(AgentVault.NotActiveAgent.selector);
        vault.agentTransfer(usdc, attacker, 1e6);
    }

    function test_AgentCannotUseOwnerControls() public {
        vm.startPrank(agent);
        vm.expectRevert(AgentVault.NotOwner.selector);
        vault.withdraw(usdc, agent, 1e6);
        vm.expectRevert(AgentVault.NotOwner.selector);
        vault.setLimit(address(usdc), type(uint128).max, type(uint128).max);
        vm.expectRevert(AgentVault.NotOwner.selector);
        vault.setAgent(agent, type(uint64).max);
        vm.expectRevert(AgentVault.NotOwner.selector);
        vault.setPaused(false);
        vm.stopPrank();
    }

    function test_OwnerCanRaiseLimits() public {
        vm.prank(owner);
        vault.setLimit(address(usdc), 500e6, 500e6);
        vm.prank(agent);
        vault.agentTransfer(usdc, alice, 400e6);
        assertEq(usdc.balanceOf(alice), 400e6);
    }

    /// Whatever sequence the agent tries, total spent per day never exceeds the cap
    function testFuzz_DailyCapHolds(uint128[8] memory amounts) public {
        uint256 spent;
        vm.startPrank(agent);
        for (uint256 i; i < amounts.length; ++i) {
            uint256 a = bound(amounts[i], 1, 60e6);
            try vault.agentTransfer(usdc, alice, a) {
                spent += a;
            } catch {}
        }
        vm.stopPrank();
        assertLe(spent, 100e6);
        assertEq(usdc.balanceOf(alice), spent);
    }
}

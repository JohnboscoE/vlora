// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {AgentVault, AgentVaultFactory} from "../AgentVault.sol";

contract InvToken is ERC20 {
    constructor() ERC20("USDC", "USDC") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 a) external { _mint(to, a); }
}

/// Drives a vault the way a hostile agent would: as many transfers as it can, of any
/// size, at any time (including across midnight), plus owner limit changes. Keeps an
/// independent log of every spend that succeeded.
contract AgentHandler is Test {
    AgentVault public vault;
    InvToken public token;
    address public agent;
    address public owner;

    uint128 public constant PER_TX = 40e6;
    uint128 public constant PER_DAY = 100e6;

    struct Entry {
        uint256 at;
        uint256 amount;
    }
    Entry[] public spends;
    /// Largest total the agent moved in any 24-hour period (checked at every spend)
    uint256 public maxInAnyWindow;
    uint256 public succeeded;

    constructor(AgentVault vault_, InvToken token_, address agent_, address owner_) {
        vault = vault_;
        token = token_;
        agent = agent_;
        owner = owner_;
    }

    function spend(uint256 amount, uint256 waitSeconds) external {
        // Mostly short hops so many spends land inside one window; sometimes long ones
        vm.warp(block.timestamp + bound(waitSeconds, 0, 30 hours));
        amount = bound(amount, 1, PER_TX);
        vm.prank(agent);
        try vault.agentTransfer(token, address(0xBEEF), amount) {
            spends.push(Entry(block.timestamp, amount));
            ++succeeded;
            // Every spend within 24h before (and including) this one
            uint256 sum;
            for (uint256 i = spends.length; i > 0; --i) {
                Entry memory e = spends[i - 1];
                if (e.at + 1 days <= block.timestamp) break;
                sum += e.amount;
            }
            if (sum > maxInAnyWindow) maxInAnyWindow = sum;
        } catch {}
    }

    function jumpToJustBeforeMidnight() external {
        vm.warp((block.timestamp / 1 days + 1) * 1 days - 1);
    }
}

contract AgentVaultInvariantTest is Test {
    AgentHandler handler;
    AgentVault vault;
    InvToken token;

    function setUp() public {
        vm.warp(1_800_000_000);
        token = new InvToken();
        AgentVaultFactory factory = new AgentVaultFactory(address(0x1234));
        address owner = makeAddr("owner");
        address agent = makeAddr("agent");

        address[] memory tokens = new address[](1);
        tokens[0] = address(token);
        uint128[] memory perTx = new uint128[](1);
        perTx[0] = 40e6;
        uint128[] memory perDay = new uint128[](1);
        perDay[0] = 100e6;
        vm.prank(owner);
        vault = AgentVault(factory.createVault(agent, type(uint64).max, tokens, perTx, perDay));
        token.mint(address(vault), 1_000_000e6);

        handler = new AgentHandler(vault, token, agent, owner);
        targetContract(address(handler));
    }

    /// The claim in the README: the agent can move at most perDay in ANY 24-hour period
    function invariant_NeverMoreThanCapInAny24Hours() public view {
        assertLe(handler.maxInAnyWindow(), handler.PER_DAY());
    }

    /// The vault's own view of the window stays within the cap and adds up
    function invariant_WindowAccountingAddsUp() public view {
        uint256 spent = vault.spentInWindow(address(token));
        assertLe(spent, handler.PER_DAY());
        assertEq(vault.remainingToday(address(token)), handler.PER_DAY() - spent);
    }

    /// Guards against a vacuous pass: the fuzzer really did get spends through
    function afterInvariant() public view {
        assertGt(handler.succeeded(), 0);
    }
}

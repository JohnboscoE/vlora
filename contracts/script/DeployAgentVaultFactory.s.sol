// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {AgentVaultFactory} from "../AgentVault.sol";

/// forge script contracts/script/DeployAgentVaultFactory.s.sol \
///   --rpc-url arc_testnet|arc --account deployer --broadcast
/// Picks Synthra's SwapRouter02 for the chain. Put the printed address in src/agent-config.ts.
contract DeployAgentVaultFactory is Script {
    address constant SYNTHRA_ROUTER_TESTNET = 0xA545bCB1Bd7985c59ea162aB1748A0803434C31b; // chain 5042002
    address constant SYNTHRA_ROUTER_MAINNET = 0xa50eDe66a573eE5bB37E28AF5789B76aE5FEb828; // chain 5042

    function run() external returns (AgentVaultFactory factory) {
        address router;
        if (block.chainid == 5042002) router = SYNTHRA_ROUTER_TESTNET;
        else if (block.chainid == 5042) router = SYNTHRA_ROUTER_MAINNET;
        else revert("unsupported chain");

        vm.startBroadcast();
        factory = new AgentVaultFactory(router);
        vm.stopBroadcast();
        console2.log("AgentVaultFactory:", address(factory));
        console2.log("Swap router:", router);
    }
}

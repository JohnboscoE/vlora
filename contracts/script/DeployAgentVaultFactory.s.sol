// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {AgentVaultFactory} from "../AgentVault.sol";

/// forge script contracts/script/DeployAgentVaultFactory.s.sol \
///   --rpc-url arc_testnet --account deployer --broadcast
/// Uses Synthra's SwapRouter02 on Arc Testnet. Put the printed address in src/agent-config.ts.
contract DeployAgentVaultFactory is Script {
    address constant SYNTHRA_SWAP_ROUTER_TESTNET = 0xA545bCB1Bd7985c59ea162aB1748A0803434C31b;

    function run() external returns (AgentVaultFactory factory) {
        vm.startBroadcast();
        factory = new AgentVaultFactory(SYNTHRA_SWAP_ROUTER_TESTNET);
        vm.stopBroadcast();
        console2.log("AgentVaultFactory:", address(factory));
    }
}

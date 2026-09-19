// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {BatchSender} from "../BatchSender.sol";

/// Deploys BatchSender. It has no constructor args, owner, or admin functions.
///
///   forge script contracts/script/DeployBatchSender.s.sol \
///     --rpc-url arc_testnet --account <keystore-name> --broadcast
///
/// Then put the printed address in src/batch-config.ts for that chain id.
contract DeployBatchSender is Script {
    function run() external returns (BatchSender deployed) {
        vm.startBroadcast();
        deployed = new BatchSender();
        vm.stopBroadcast();

        console2.log("BatchSender deployed at:", address(deployed));
        console2.log("Chain id:", block.chainid);
    }
}

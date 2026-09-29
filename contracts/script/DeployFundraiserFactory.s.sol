// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {FundraiserFactory} from "../FundraiserFactory.sol";
import {IERC20} from "../Fundraiser.sol";

/// Deploys FundraiserFactory. It has no owner and never holds money; each
/// fundraise it creates is its own contract with a fixed beneficiary.
///
/// Test on Arc Testnet first:
///
///   forge script contracts/script/DeployFundraiserFactory.s.sol \
///     --rpc-url arc_testnet --account <keystore-name> --broadcast
///
/// Then put the printed address in src/fundraiser-config.ts for that chain id.
/// USDC is the same predeploy on both Arc networks.
contract DeployFundraiserFactory is Script {
    address constant USDC = 0x3600000000000000000000000000000000000000;

    function run() external returns (FundraiserFactory deployed) {
        vm.startBroadcast();
        deployed = new FundraiserFactory(IERC20(USDC));
        vm.stopBroadcast();

        console2.log("FundraiserFactory deployed at:", address(deployed));
        console2.log("Token:", USDC);
        console2.log("Chain id:", block.chainid);
    }
}

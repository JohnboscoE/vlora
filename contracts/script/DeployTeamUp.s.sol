// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {TeamUp, IERC20} from "../TeamUp.sol";

/// Deploys one TeamUp group. Members are fixed at creation, so this takes them
/// as an argument rather than letting anyone be added later.
///
/// Test on Arc Testnet first:
///
///   MEMBERS=0xaaa,0xbbb,0xccc PURPOSE="Shop stock" TARGET=3000000000 FEE_BPS=500 \
///   forge script contracts/script/DeployTeamUp.s.sol \
///     --rpc-url arc_testnet --account <keystore-name> --broadcast
///
/// TARGET is in USDC's smallest unit (6 decimals): 3000000000 is 3,000 USDC.
/// FEE_BPS is the breaking fee in basis points, capped at 1000 (10%).
contract DeployTeamUp is Script {
    address constant USDC = 0x3600000000000000000000000000000000000000;

    function run() external returns (TeamUp deployed) {
        address[] memory members = vm.envAddress("MEMBERS", ",");
        string memory purpose = vm.envString("PURPOSE");
        uint256 target = vm.envOr("TARGET", uint256(0));
        uint256 feeBps = vm.envOr("FEE_BPS", uint256(0));

        vm.startBroadcast();
        deployed = new TeamUp(IERC20(USDC), members, purpose, target, uint16(feeBps));
        vm.stopBroadcast();

        console2.log("TeamUp deployed at:", address(deployed));
        console2.log("Members:", members.length);
        console2.log("Chain id:", block.chainid);
    }
}

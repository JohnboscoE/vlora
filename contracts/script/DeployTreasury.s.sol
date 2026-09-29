// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {Treasury, IERC20} from "../Treasury.sol";

/// Deploys one Treasury. Signers are fixed at creation: a treasury whose signer
/// list can be edited is a treasury with a back door. To change them, vote the
/// money across to a new one.
///
/// Test on Arc Testnet first:
///
///   NAME="Acme Ltd" SIGNERS=0xaaa,0xbbb,0xccc \
///   forge script contracts/script/DeployTreasury.s.sol \
///     --rpc-url arc_testnet --account <keystore-name> --broadcast
contract DeployTreasury is Script {
    address constant USDC = 0x3600000000000000000000000000000000000000;

    function run() external returns (Treasury deployed) {
        address[] memory signers = vm.envAddress("SIGNERS", ",");
        string memory name = vm.envString("NAME");

        vm.startBroadcast();
        deployed = new Treasury(IERC20(USDC), name, signers);
        vm.stopBroadcast();

        console2.log("Treasury deployed at:", address(deployed));
        console2.log("Signers:", signers.length);
        console2.log("Approvals needed:", deployed.approvalsNeeded());
        console2.log("Chain id:", block.chainid);
    }
}

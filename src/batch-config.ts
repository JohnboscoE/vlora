/**
 * BatchSender deployments (contracts/BatchSender.sol), keyed by chain id.
 *
 * Deploy with contracts/script/DeployBatchSender.s.sol, then paste the address
 * here. A chain with no entry simply has batch payments turned off.
 */
import { ARC_MAINNET_ID, ARC_TESTNET_ID } from './chain-env';

const BATCH_SENDER_ADDRESSES: Partial<Record<number, `0x${string}`>> = {
  // Deployed 2026-09-19, tx 0x9488285214f987956b15ecff80fca955b2b00116fd6734d7b9807506f4d48246
  [ARC_TESTNET_ID]: '0xF2DCe7fe2864FDD899b12185c610C11d425200d9',
  [ARC_MAINNET_ID]: undefined, // TODO: fill in after the mainnet deploy
};

export function getBatchSenderAddress(chainId: number): `0x${string}` | undefined {
  return BATCH_SENDER_ADDRESSES[chainId];
}

// Must match contracts/BatchSender.sol
export const MAX_BATCH_RECIPIENTS = 50; // UI cap; the contract allows up to 200

export const batchSenderAbi = [
  {
    type: 'function',
    name: 'batchTransfer',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'recipients', type: 'address[]' },
      { name: 'amounts', type: 'uint256[]' },
    ],
    outputs: [],
  },
  {
    type: 'event',
    name: 'BatchSent',
    inputs: [
      { name: 'token', type: 'address', indexed: true },
      { name: 'sender', type: 'address', indexed: true },
      { name: 'recipientCount', type: 'uint256', indexed: false },
      { name: 'total', type: 'uint256', indexed: false },
    ],
  },
] as const;

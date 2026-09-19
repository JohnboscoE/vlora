/**
 * ArcNames (.arc names) deployments, keyed by chain id. Source:
 * https://github.com/JohnboscoE/ArcNames — a chain with no entry has .arc
 * names turned off.
 */
import { ARC_MAINNET_ID, ARC_TESTNET_ID } from './chain-env';

const ARC_NAMES_ADDRESSES: Partial<Record<number, `0x${string}`>> = {
  // Live testnet registry. Replace with the fixed contract once it's redeployed.
  [ARC_TESTNET_ID]: '0x578dbd5734f13bca66a1355cca296c07823892a2',
  // Fixed ArcNames (0.01 USDC/yr, fees to 0x6765…b27f). Deployed 2026-09-19,
  // tx 0x8658090cbbf63c2f107aa671b5caca925d04dce773f1f448730d69f72f841987
  [ARC_MAINNET_ID]: '0xF2DCe7fe2864FDD899b12185c610C11d425200d9',
};

export function getArcNamesAddress(chainId: number): `0x${string}` | undefined {
  return ARC_NAMES_ADDRESSES[chainId];
}

export const ARC_NAME_MAX_YEARS = 10;
/** Measured in ArcNames tests (~290k), padded; used only before the approval exists */
export const ARC_NAME_REGISTER_GAS = 320_000n;

// Contract rules: 3–32 chars of a-z, 0-9, hyphen
export const ARC_NAME_LABEL_RE = /^[a-z0-9-]{3,32}$/;

export const arcNamesAbi = [
  { type: 'function', name: 'YEARLY_FEE', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'resolve', stateMutability: 'view', inputs: [{ name: 'name', type: 'string' }], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'reverseLookup', stateMutability: 'view', inputs: [{ name: 'wallet', type: 'address' }], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'isAvailable', stateMutability: 'view', inputs: [{ name: 'name', type: 'string' }], outputs: [{ type: 'bool' }] },
  {
    type: 'function',
    name: 'nameInfo',
    stateMutability: 'view',
    inputs: [{ name: 'name', type: 'string' }],
    outputs: [
      { name: 'owner', type: 'address' },
      { name: 'expiry', type: 'uint256' },
      { name: 'tokenId', type: 'uint256' },
      { name: 'available', type: 'bool' },
    ],
  },
  { type: 'function', name: 'register', stateMutability: 'nonpayable', inputs: [{ name: 'name', type: 'string' }, { name: 'numYears', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'renew', stateMutability: 'nonpayable', inputs: [{ name: 'name', type: 'string' }, { name: 'numYears', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'setPrimaryName', stateMutability: 'nonpayable', inputs: [{ name: 'name', type: 'string' }], outputs: [] },
] as const;

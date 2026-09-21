/**
 * Agent wallets (contracts/AgentVault.sol). A chain with no factory address has
 * the agent turned off. Beta on both networks (mainnet: USDC sends only).
 */
import { ARC_MAINNET_ID, ARC_TESTNET_ID } from './chain-env';
import { getTokens, type TokenInfo } from './tokens';

const AGENT_VAULT_FACTORIES: Partial<Record<number, `0x${string}`>> = {
  // Deployed 2026-09-18, tx 0x1043edf12537df51982d55f36587b6fff2ac15b5a26af897db4210be22c148fb
  [ARC_TESTNET_ID]: '0x40D5AbC0EcDB140ba4DC5fF3B725c5740a0Ea2a9',
  // Deployed 2026-09-19, tx 0x208b3eda8526269395cd4dc61dc15d55ad34d281aad818068a52d640c096b906
  // (Synthra mainnet router; swaps stay off until mainnet pools exist)
  [ARC_MAINNET_ID]: '0x170FD54D7A9D0d35C0237A5B45741dF874ba6C69',
};

export function getAgentFactory(chainId: number): `0x${string}` | undefined {
  return AGENT_VAULT_FACTORIES[chainId];
}

/** Tokens an agent wallet holds and has limits for. Mainnet: USDC only (the server's tools match). */
export function getAgentTokens(chainId: number): TokenInfo[] {
  const tokens = getTokens(chainId);
  return chainId === ARC_MAINNET_ID ? tokens.filter((t) => t.symbol === 'USDC') : tokens;
}

/** Proxied to the agent server by vite.config.ts */
export const AGENT_API = '/api/agent';

// Conservative defaults for a new agent wallet, in whole tokens
export const DEFAULT_PER_TX = '10';
export const DEFAULT_PER_DAY = '25';
export const DEFAULT_EXPIRY_DAYS = 7;

export const agentFactoryAbi = [
  {
    type: 'function',
    name: 'createVault',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'agent', type: 'address' },
      { name: 'agentExpiresAt', type: 'uint64' },
      { name: 'tokens', type: 'address[]' },
      { name: 'perTx', type: 'uint128[]' },
      { name: 'perDay', type: 'uint128[]' },
    ],
    outputs: [{ name: 'vault', type: 'address' }],
  },
  { type: 'function', name: 'vaultsOf', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }], outputs: [{ type: 'address[]' }] },
] as const;

export const agentVaultAbi = [
  { type: 'function', name: 'agent', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'agentActive', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'agentExpiresAt', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint64' }] },
  { type: 'function', name: 'paused', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'remainingToday', stateMutability: 'view', inputs: [{ name: 'token', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'setPaused', stateMutability: 'nonpayable', inputs: [{ name: 'paused_', type: 'bool' }], outputs: [] },
  { type: 'function', name: 'revokeAgent', stateMutability: 'nonpayable', inputs: [], outputs: [] },
  {
    type: 'function',
    name: 'setAgent',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'agent_', type: 'address' },
      { name: 'expiresAt', type: 'uint64' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'withdraw',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
] as const;

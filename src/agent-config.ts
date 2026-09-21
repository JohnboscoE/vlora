/**
 * Agent wallets (contracts/AgentVault.sol). A chain with no factory address has
 * the agent turned off. Beta on both networks (mainnet: USDC sends only).
 */
import { ARC_MAINNET_ID, ARC_TESTNET_ID, IS_MAINNET } from './chain-env';
import { getTokens, type TokenInfo } from './tokens';

const AGENT_VAULT_FACTORIES: Partial<Record<number, `0x${string}`>> = {
  // Deployed 2026-09-18, tx 0x1043edf12537df51982d55f36587b6fff2ac15b5a26af897db4210be22c148fb
  [ARC_TESTNET_ID]: '0x40D5AbC0EcDB140ba4DC5fF3B725c5740a0Ea2a9',
  // Deployed 2026-09-19, tx 0x208b3eda8526269395cd4dc61dc15d55ad34d281aad818068a52d640c096b906
  // (Synthra mainnet router; swaps stay off until mainnet pools exist)
  [ARC_MAINNET_ID]: '0x170FD54D7A9D0d35C0237A5B45741dF874ba6C69',
};

/**
 * Factories that deployed v1 vaults (calendar-day limit, reset at midnight). When a
 * v2 factory replaces one, move its address here so owners can still find, withdraw
 * from and revoke their old vault. The agent server holds v1 vaults to the rolling
 * limit itself (server/guards.ts).
 */
const LEGACY_AGENT_VAULT_FACTORIES: Partial<Record<number, `0x${string}`[]>> = {};

export function getAgentFactory(chainId: number): `0x${string}` | undefined {
  return AGENT_VAULT_FACTORIES[chainId];
}

export function getLegacyAgentFactories(chainId: number): `0x${string}`[] {
  return LEGACY_AGENT_VAULT_FACTORIES[chainId] ?? [];
}

/** Tokens an agent wallet holds and has limits for. Mainnet: USDC only (the server's tools match). */
export function getAgentTokens(chainId: number): TokenInfo[] {
  const tokens = getTokens(chainId);
  return chainId === ARC_MAINNET_ID ? tokens.filter((t) => t.symbol === 'USDC') : tokens;
}

/** Proxied to the agent server by vite.config.ts */
export const AGENT_API = '/api/agent';

// Conservative defaults for a new agent wallet, in whole tokens. Lower on mainnet,
// where the vault holds real money and the contract is unaudited.
export const DEFAULT_PER_TX = IS_MAINNET ? '2' : '10';
export const DEFAULT_PER_DAY = IS_MAINNET ? '5' : '25';
export const DEFAULT_EXPIRY_DAYS = 7;

/**
 * Mainnet beta cap on the daily limit, in whole tokens. The panel won't create a
 * vault above it and the agent server refuses to act for one (server/agent.ts).
 */
export const BETA_MAX_PER_DAY: number | null = IS_MAINNET ? 50 : null;

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
  // v2 vaults only (rolling 24h window); a v1 vault reverts
  { type: 'function', name: 'version', stateMutability: 'pure', inputs: [], outputs: [{ type: 'uint256' }] },
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

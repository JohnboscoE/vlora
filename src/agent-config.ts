/**
 * Agent wallets (contracts/AgentVault.sol). A chain with no factory address has
 * the agent turned off. Beta on both networks (mainnet: USDC sends only).
 */
import { ARC_MAINNET_ID, ARC_TESTNET_ID, IS_MAINNET } from './chain-env';
import { getTokens, type TokenInfo } from './tokens';

// v2 factories: vaults with the rolling 24-hour limit (AgentVault.VERSION = 2)
const AGENT_VAULT_FACTORIES: Partial<Record<number, `0x${string}`>> = {
  // Deployed 2026-09-22, tx 0x246944566138daf6f6cbb039774354cbb29c78215c166565544d770f2a0ec1ca
  [ARC_TESTNET_ID]: '0xE21A7446a89b3A8C9A455dC5e1c2A61D21E25982',
  // Deployed 2026-09-22, tx 0xec5b137ea1b797012075dcc2a8846522609a9726af8508acfe0e871224268411
  // (Synthra mainnet router; agent swaps stay off on mainnet)
  [ARC_MAINNET_ID]: '0xF577915220e535896974A54748718B8eCE0d6EF4',
};

/**
 * Factories that deployed v1 vaults (calendar-day limit, reset at midnight). When a
 * v2 factory replaces one, move its address here so owners can still find, withdraw
 * from and revoke their old vault. The agent server holds v1 vaults to the rolling
 * limit itself (server/guards.ts).
 */
const LEGACY_AGENT_VAULT_FACTORIES: Partial<Record<number, `0x${string}`[]>> = {
  // v1, deployed 2026-09-18
  [ARC_TESTNET_ID]: ['0x40D5AbC0EcDB140ba4DC5fF3B725c5740a0Ea2a9'],
  // v1, deployed 2026-09-19
  [ARC_MAINNET_ID]: ['0x170FD54D7A9D0d35C0237A5B45741dF874ba6C69'],
};

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

// Chain constants for the agent server. Kept separate from the Vite app because
// the app's modules use browser-only aliases. The network follows the same
// VITE_ARC_NETWORK variable as the web app ("mainnet", otherwise Arc Testnet),
// so the agent always runs on the network the site is showing.
import { createPublicClient, createWalletClient, defineChain, fallback, http, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

export const IS_MAINNET = (process.env.VITE_ARC_NETWORK ?? '').trim() === 'mainnet';

export interface Token {
  symbol: string;
  address: Address;
  decimals: number;
}

export interface SwapVenue {
  venue: string;
  router: Address;
  quoter: Address;
  feeTiers: readonly number[];
  slippageBps: bigint;
}

const USDC: Token = { symbol: 'USDC', address: '0x3600000000000000000000000000000000000000', decimals: 6 };

const NETWORKS = {
  testnet: {
    chainId: 5042002,
    name: 'Arc Testnet',
    explorer: 'https://explorer.testnet.arc.io',
    rpcs: ['https://rpc.testnet.arc.io', 'https://rpc.testnet.arc.network'],
    // Same registry as src/tokens.ts
    tokens: [USDC, { symbol: 'EURC', address: '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a', decimals: 6 }] as Token[],
    // Synthra — verified: router factory() matches, USDC/EURC pools funded
    swap: {
      venue: 'Synthra',
      router: '0xA545bCB1Bd7985c59ea162aB1748A0803434C31b',
      quoter: '0x3Ce954107b1A675826B33bF23060Dd655e3758fE',
      feeTiers: [100, 500, 3000, 10000],
      slippageBps: 50n,
    } as SwapVenue | null,
    arcNames: '0x578dbd5734f13bca66a1355cca296c07823892a2' as Address,
    betaMaxPerDay: null as number | null,
  },
  mainnet: {
    chainId: 5042,
    name: 'Arc',
    explorer: 'https://explorer.arc.io',
    rpcs: [
      'https://rpc.mainnet.arc.io',
      'https://rpc.blockdaemon.mainnet.arc.io',
      'https://rpc.drpc.mainnet.arc.io',
      'https://rpc.quicknode.mainnet.arc.io',
    ],
    tokens: [USDC] as Token[],
    // No verified USDC/EURC pools on mainnet yet — the swap tool is off
    swap: null as SwapVenue | null,
    arcNames: '0xF2DCe7fe2864FDD899b12185c610C11d425200d9' as Address,
    // Unaudited vault holding real money: refuse vaults whose daily limit is above this
    // (whole tokens; same cap as BETA_MAX_PER_DAY in src/agent-config.ts)
    betaMaxPerDay: 50 as number | null,
  },
} as const;

const NET = IS_MAINNET ? NETWORKS.mainnet : NETWORKS.testnet;

export const CHAIN_ID = NET.chainId;
export const NETWORK_NAME = NET.name;
export const EXPLORER = NET.explorer;
export const TOKENS: Token[] = NET.tokens;
export const SWAP: SwapVenue | null = NET.swap;
export const ARC_NAMES: Address = NET.arcNames;
export const BETA_MAX_PER_DAY: number | null = NET.betaMaxPerDay;

export function tokenBySymbol(symbol: string): Token | undefined {
  return TOKENS.find((t) => t.symbol === symbol.toUpperCase());
}

export const arcChain = defineChain({
  id: CHAIN_ID,
  name: NETWORK_NAME,
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [...NET.rpcs] } },
});

export const publicClient = createPublicClient({
  chain: arcChain,
  transport: fallback(arcChain.rpcUrls.default.http.map((u) => http(u, { retryCount: 2, timeout: 15_000 }))),
});

export function agentClients(privateKey: `0x${string}`) {
  const account = privateKeyToAccount(privateKey);
  const wallet = createWalletClient({
    account,
    chain: arcChain,
    transport: fallback(arcChain.rpcUrls.default.http.map((u) => http(u, { retryCount: 1, timeout: 20_000 }))),
  });
  return { account, wallet };
}

export const vaultAbi = [
  { type: 'function', name: 'owner', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'agent', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'agentActive', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'agentExpiresAt', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint64' }] },
  { type: 'function', name: 'remainingToday', stateMutability: 'view', inputs: [{ name: 'token', type: 'address' }], outputs: [{ type: 'uint256' }] },
  // v2 only (rolling 24h window); v1 vaults revert
  { type: 'function', name: 'version', stateMutability: 'pure', inputs: [], outputs: [{ type: 'uint256' }] },
  // v1 only (calendar-day buckets)
  {
    type: 'function',
    name: 'spentOnDay',
    stateMutability: 'view',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'day', type: 'uint256' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'limits',
    stateMutability: 'view',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [
      { name: 'perTx', type: 'uint128' },
      { name: 'perDay', type: 'uint128' },
    ],
  },
  {
    type: 'function',
    name: 'agentTransfer',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'agentSwap',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'tokenIn', type: 'address' },
      { name: 'tokenOut', type: 'address' },
      { name: 'fee', type: 'uint24' },
      { name: 'amountIn', type: 'uint256' },
      { name: 'minOut', type: 'uint256' },
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
  },
] as const;

export const quoterAbi = [
  {
    type: 'function',
    name: 'quoteExactInputSingle',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'tokenIn', type: 'address' },
          { name: 'tokenOut', type: 'address' },
          { name: 'amountIn', type: 'uint256' },
          { name: 'fee', type: 'uint24' },
          { name: 'sqrtPriceLimitX96', type: 'uint160' },
        ],
      },
    ],
    outputs: [
      { name: 'amountOut', type: 'uint256' },
      { name: 'sqrtPriceX96After', type: 'uint160' },
      { name: 'initializedTicksCrossed', type: 'uint32' },
      { name: 'gasEstimate', type: 'uint256' },
    ],
  },
] as const;

export const arcNamesAbi = [
  { type: 'function', name: 'resolve', stateMutability: 'view', inputs: [{ name: 'name', type: 'string' }], outputs: [{ type: 'address' }] },
] as const;

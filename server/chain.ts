// Chain constants for the agent server (testnet prototype). Kept separate from the
// Vite app because the app's modules use browser-only aliases.
import { createPublicClient, createWalletClient, defineChain, fallback, http, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

export const CHAIN_ID = 5042002;
export const EXPLORER = 'https://explorer.testnet.arc.io';

export const arcTestnet = defineChain({
  id: CHAIN_ID,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.testnet.arc.io', 'https://rpc.testnet.arc.network'] } },
});

export interface Token {
  symbol: string;
  address: Address;
  decimals: number;
}

// Same registry as src/tokens.ts (testnet)
export const TOKENS: Token[] = [
  { symbol: 'USDC', address: '0x3600000000000000000000000000000000000000', decimals: 6 },
  { symbol: 'EURC', address: '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a', decimals: 6 },
];

export function tokenBySymbol(symbol: string): Token | undefined {
  return TOKENS.find((t) => t.symbol === symbol.toUpperCase());
}

// Synthra (verified on testnet: router factory() matches, USDC/EURC pools funded)
export const SWAP = {
  venue: 'Synthra',
  router: '0xA545bCB1Bd7985c59ea162aB1748A0803434C31b' as Address,
  quoter: '0x3Ce954107b1A675826B33bF23060Dd655e3758fE' as Address,
  feeTiers: [100, 500, 3000, 10000] as const,
  slippageBps: 50n,
};

export const ARC_NAMES = '0x578dbd5734f13bca66a1355cca296c07823892a2' as Address;

export const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: fallback(arcTestnet.rpcUrls.default.http.map((u) => http(u, { retryCount: 2, timeout: 15_000 }))),
});

export function agentClients(privateKey: `0x${string}`) {
  const account = privateKeyToAccount(privateKey);
  const wallet = createWalletClient({ account, chain: arcTestnet, transport: http(arcTestnet.rpcUrls.default.http[0]) });
  return { account, wallet };
}

export const vaultAbi = [
  { type: 'function', name: 'owner', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'agent', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'agentActive', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'agentExpiresAt', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint64' }] },
  { type: 'function', name: 'remainingToday', stateMutability: 'view', inputs: [{ name: 'token', type: 'address' }], outputs: [{ type: 'uint256' }] },
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

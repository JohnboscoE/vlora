/**
 * Stablecoin swaps route through Synthra (a Uniswap V3 fork on Arc) using its
 * SwapRouter02 + QuoterV2. Addresses verified on Arc Testnet: the router's
 * factory() matches, and USDC/EURC pools hold real liquidity.
 * A chain with no entry has swaps turned off.
 */
import { ARC_TESTNET_ID } from './chain-env';
import type { TokenSymbol } from './tokens';

export interface SwapVenue {
  name: string;
  router: `0x${string}`;
  quoter: `0x${string}`;
  feeTiers: readonly number[];
  /** Pairs with verified liquidity on this chain */
  pairs: readonly [TokenSymbol, TokenSymbol][];
}

const SWAP_VENUES: Partial<Record<number, SwapVenue>> = {
  [ARC_TESTNET_ID]: {
    name: 'Synthra',
    router: '0xA545bCB1Bd7985c59ea162aB1748A0803434C31b',
    quoter: '0x3Ce954107b1A675826B33bF23060Dd655e3758fE',
    feeTiers: [100, 500, 3000, 10000],
    pairs: [
      ['USDC', 'EURC'],
      ['USDC', 'cirBTC'],
      ['EURC', 'cirBTC'],
    ],
  },
  // Arc mainnet: Synthra hasn't published USDC/EURC pools yet
};

export function getSwapVenue(chainId: number): SwapVenue | undefined {
  return SWAP_VENUES[chainId];
}

export function isSupportedPair(venue: SwapVenue, a: string, b: string): boolean {
  return venue.pairs.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
}

/** Max price movement accepted between quote and execution: 0.5% */
export const SWAP_SLIPPAGE_BPS = 50n;
/** Padded estimate, used only before the approval exists */
export const SWAP_GAS_ESTIMATE = 220_000n;

export const quoterV2Abi = [
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

export const swapRouter02Abi = [
  {
    type: 'function',
    name: 'exactInputSingle',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'tokenIn', type: 'address' },
          { name: 'tokenOut', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'recipient', type: 'address' },
          { name: 'amountIn', type: 'uint256' },
          { name: 'amountOutMinimum', type: 'uint256' },
          { name: 'sqrtPriceLimitX96', type: 'uint160' },
        ],
      },
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
  },
] as const;

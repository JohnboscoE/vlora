/**
 * Swap venues per chain. A chain with no entry has swaps turned off.
 *
 * - Testnet: Synthra (a Uniswap V3 fork on Arc) through its SwapRouter02 +
 *   QuoterV2. Verified: the router's factory() matches, pools hold liquidity.
 * - Mainnet: LI.FI, the aggregator behind the Arc Portal's swap page. Quotes
 *   come from its API (proxied same-origin at /lifi), and every returned
 *   transaction is checked against the pinned router before it can be signed
 *   (see src/lib/lifi.ts).
 */
import { ARC_MAINNET_ID, ARC_TESTNET_ID } from './chain-env';
import type { TokenSymbol } from './tokens';

interface VenueBase {
  name: string;
  /** The contract that receives the approval and the swap call */
  router: `0x${string}`;
  /** Pairs with verified liquidity on this chain */
  pairs: readonly [TokenSymbol, TokenSymbol][];
}

export type SwapVenue =
  | (VenueBase & { kind: 'v3'; quoter: `0x${string}`; feeTiers: readonly number[] })
  | (VenueBase & { kind: 'lifi' });

const SWAP_VENUES: Partial<Record<number, SwapVenue>> = {
  [ARC_TESTNET_ID]: {
    kind: 'v3',
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
  [ARC_MAINNET_ID]: {
    kind: 'lifi',
    name: 'LI.FI',
    // LI.FI Diamond on Arc mainnet: the transactionRequest.to and approvalAddress of
    // every quote (checked 2026-09-21). A quote pointing anywhere else is rejected.
    router: '0xA4072583658Fae592A3506A42431cb6316a8d40b',
    // Quoted live on 2026-09-21 (Kyberswap / Fly liquidity)
    pairs: [
      ['USDC', 'EURC'],
      ['USDC', 'cirBTC'],
      ['EURC', 'cirBTC'],
    ],
  },
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
/** An aggregator route can touch several pools; used when the quote has no gas limit */
export const LIFI_GAS_ESTIMATE = 900_000n;

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

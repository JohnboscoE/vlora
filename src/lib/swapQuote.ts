import { useEffect, useState } from 'react';
import { getPublicClient } from 'wagmi/actions';
import { config } from '@/config';
import { ACTIVE_CHAIN_ID } from '@/chain-env';
import { getSwapVenue, quoterV2Abi, SWAP_SLIPPAGE_BPS } from '@/swap-config';
import { getLifiQuote, type LifiRoute } from '@/lib/lifi';

export interface SwapQuote {
  amountIn: bigint;
  amountOut: bigint;
  /** Pool fee tier in hundredths of a bip (3000 = 0.3%); 0 for an aggregator route */
  fee: number;
  /** Aggregator (LI.FI) quotes: the verified transaction to sign */
  lifi?: LifiRoute;
  /** amountOut minus the slippage allowance — the swap reverts below this */
  minOut: bigint;
  quotedAt: number;
}

export function applySlippage(amountOut: bigint): bigint {
  return (amountOut * (10_000n - SWAP_SLIPPAGE_BPS)) / 10_000n;
}

/**
 * Synthra: asks QuoterV2 for every fee tier and keeps the best output. Tiers
 * without a pool or liquidity revert and are skipped.
 * LI.FI: one verified aggregator quote for this wallet.
 * Returns null if nothing can fill it.
 */
export async function getBestQuote(
  tokenIn: `0x${string}`,
  tokenOut: `0x${string}`,
  amountIn: bigint,
  account?: `0x${string}`,
): Promise<SwapQuote | null> {
  const venue = getSwapVenue(ACTIVE_CHAIN_ID);
  if (!venue || amountIn <= 0n) return null;

  if (venue.kind === 'lifi') {
    // LI.FI builds the transaction for a specific wallet
    if (!account) return null;
    const q = await getLifiQuote(venue, tokenIn, tokenOut, amountIn, account);
    return q ? { amountIn, amountOut: q.amountOut, fee: 0, minOut: q.minOut, lifi: q.route, quotedAt: Date.now() } : null;
  }

  const client = getPublicClient(config, { chainId: ACTIVE_CHAIN_ID });
  if (!client) return null;

  const results = await Promise.all(
    venue.feeTiers.map(async (fee) => {
      try {
        // QuoterV2 is nonpayable (it reverts internally to return data), so simulate it
        const { result } = await client.simulateContract({
          address: venue.quoter,
          abi: quoterV2Abi,
          functionName: 'quoteExactInputSingle',
          args: [{ tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96: 0n }],
        });
        return { fee, amountOut: result[0] };
      } catch {
        return null;
      }
    }),
  );

  const best = results
    .filter((r): r is { fee: number; amountOut: bigint } => r != null && r.amountOut > 0n)
    .sort((a, b) => (b.amountOut > a.amountOut ? 1 : b.amountOut < a.amountOut ? -1 : 0))[0];
  if (!best) return null;
  return { amountIn, amountOut: best.amountOut, fee: best.fee, minOut: applySlippage(best.amountOut), quotedAt: Date.now() };
}

export type QuoteState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; quote: SwapQuote }
  | { status: 'none' } // no pool can fill this size
  | { status: 'error' };

const REFRESH_MS = 20_000;

/** Live quote that refreshes every 20s while the preview is open */
export function useSwapQuote(tokenIn?: `0x${string}`, tokenOut?: `0x${string}`, amountIn?: bigint, account?: `0x${string}`): QuoteState {
  const [state, setState] = useState<QuoteState>({ status: 'idle' });
  const key = tokenIn && tokenOut && amountIn != null ? `${tokenIn}-${tokenOut}-${amountIn}-${account ?? ''}` : null;

  useEffect(() => {
    if (!tokenIn || !tokenOut || amountIn == null || amountIn <= 0n) {
      setState({ status: 'idle' });
      return;
    }
    let cancelled = false;
    const run = async (first: boolean) => {
      if (first) setState({ status: 'loading' });
      try {
        const quote = await getBestQuote(tokenIn, tokenOut, amountIn, account);
        if (!cancelled) setState(quote ? { status: 'ok', quote } : { status: 'none' });
      } catch (err) {
        console.error('[vlora] swap quote failed', err);
        if (!cancelled && first) setState({ status: 'error' });
      }
    };
    void run(true);
    const t = setInterval(() => void run(false), REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key captures the inputs by value
  }, [key]);

  return state;
}

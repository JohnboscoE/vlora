/**
 * LI.FI quotes for mainnet swaps. The API is proxied same-origin at /lifi
 * (vercel.json + vite.config.ts) so ad blockers and CORS don't get in the way.
 *
 * The API returns a ready-made transaction, so nothing in it is trusted: before a
 * quote is used we check the router, chain, amount, value and the decoded
 * calldata (receiver = the user, first leg spends exactly the input token and
 * amount, last leg pays out the output token, on-chain minimum = toAmountMin).
 * Anything unexpected → the quote is rejected and nothing can be signed.
 */
import { decodeFunctionData, getAddress, isAddress, type Hex } from 'viem';
import { ACTIVE_CHAIN_ID } from '@/chain-env';
import { SWAP_SLIPPAGE_BPS, type SwapVenue } from '@/swap-config';

const LIFI_API = '/lifi';

export interface LifiRoute {
  to: `0x${string}`;
  data: Hex;
  gasLimit?: bigint;
  /** DEX LI.FI picked, e.g. "Kyberswap" */
  tool: string;
  /** LI.FI's own fee, in USD, for display */
  feeUsd: number;
}

export interface LifiQuote {
  amountOut: bigint;
  minOut: bigint;
  route: LifiRoute;
}

const swapData = {
  type: 'tuple[]',
  components: [
    { name: 'callTo', type: 'address' },
    { name: 'approveTo', type: 'address' },
    { name: 'sendingAssetId', type: 'address' },
    { name: 'receivingAssetId', type: 'address' },
    { name: 'fromAmount', type: 'uint256' },
    { name: 'callData', type: 'bytes' },
    { name: 'requiresDeposit', type: 'bool' },
  ],
} as const;
const single = { ...swapData, type: 'tuple' } as const;
const head = [
  { name: 'transactionId', type: 'bytes32' },
  { name: 'integrator', type: 'string' },
  { name: 'referrer', type: 'string' },
  { name: 'receiver', type: 'address' },
  { name: 'minAmountOut', type: 'uint256' },
] as const;

// LI.FI's same-chain swap entry points (GenericSwapFacet / GenericSwapFacetV3).
// Only ERC-20 → ERC-20: Vlora never swaps the native gas balance directly.
const lifiSwapAbi = [
  { type: 'function', name: 'swapTokensGeneric', stateMutability: 'payable', inputs: [...head, { ...swapData, name: 'swapData' }], outputs: [] },
  { type: 'function', name: 'swapTokensMultipleV3ERC20ToERC20', stateMutability: 'nonpayable', inputs: [...head, { ...swapData, name: 'swapData' }], outputs: [] },
  { type: 'function', name: 'swapTokensSingleV3ERC20ToERC20', stateMutability: 'nonpayable', inputs: [...head, { ...single, name: 'swapData' }], outputs: [] },
] as const;

interface SwapLeg {
  sendingAssetId: string;
  receivingAssetId: string;
  fromAmount: bigint;
}

interface RawQuote {
  action?: { fromChainId?: number; toChainId?: number; fromAmount?: string; fromAddress?: string; toAddress?: string; fromToken?: { address?: string }; toToken?: { address?: string } };
  estimate?: { toAmount?: string; toAmountMin?: string; approvalAddress?: string; feeCosts?: { amountUSD?: string }[] };
  transactionRequest?: { to?: string; data?: string; value?: string; chainId?: number; gasLimit?: string };
  toolDetails?: { name?: string };
  tool?: string;
}

const same = (a: string | undefined, b: string) => !!a && isAddress(a) && getAddress(a) === getAddress(b);

/** Throws on anything that doesn't match what the user asked for */
function verify(q: RawQuote, venue: SwapVenue, tokenIn: `0x${string}`, tokenOut: `0x${string}`, amountIn: bigint, account: `0x${string}`): LifiQuote {
  const tx = q.transactionRequest;
  const est = q.estimate;
  if (!tx?.to || !tx.data || !est?.toAmount || !est.toAmountMin) throw new Error('incomplete quote');
  if (!same(tx.to, venue.router)) throw new Error(`unexpected router ${tx.to}`);
  if (est.approvalAddress && !same(est.approvalAddress, venue.router)) throw new Error('unexpected approval address');
  if (tx.chainId != null && tx.chainId !== ACTIVE_CHAIN_ID) throw new Error('wrong chain');
  if (q.action?.fromChainId !== ACTIVE_CHAIN_ID || q.action?.toChainId !== ACTIVE_CHAIN_ID) throw new Error('wrong chain');
  if (BigInt(tx.value ?? '0') !== 0n) throw new Error('quote wants native value');
  if (!same(q.action?.fromAddress, account) || !same(q.action?.toAddress, account)) throw new Error('wrong wallet');
  if (!same(q.action?.fromToken?.address, tokenIn) || !same(q.action?.toToken?.address, tokenOut)) throw new Error('wrong tokens');
  if (BigInt(q.action?.fromAmount ?? '0') !== amountIn) throw new Error('wrong amount');

  const amountOut = BigInt(est.toAmount);
  const minOut = BigInt(est.toAmountMin);
  if (minOut <= 0n || minOut > amountOut) throw new Error('bad minimum');
  // The minimum can't be looser than our own slippage limit (plus rounding)
  if (minOut * 10_000n < amountOut * (10_000n - SWAP_SLIPPAGE_BPS - 1n)) throw new Error('slippage too loose');

  const { args } = decodeFunctionData({ abi: lifiSwapAbi, data: tx.data as Hex });
  const [, , , receiver, minAmountOut, legsRaw] = args;
  const legs: readonly SwapLeg[] = Array.isArray(legsRaw) ? (legsRaw as readonly SwapLeg[]) : [legsRaw as SwapLeg];
  const first = legs[0];
  const last = legs[legs.length - 1];
  if (!first || !last) throw new Error('empty route');
  if (getAddress(receiver) !== getAddress(account)) throw new Error('receiver is not you');
  if (minAmountOut !== minOut) throw new Error('on-chain minimum differs from the quote');
  if (!same(first.sendingAssetId, tokenIn) || first.fromAmount !== amountIn) throw new Error('route spends something else');
  if (!same(last.receivingAssetId, tokenOut)) throw new Error('route pays out something else');

  const feeUsd = (est.feeCosts ?? []).reduce((sum, f) => sum + (Number(f.amountUSD) || 0), 0);
  return {
    amountOut,
    minOut,
    route: {
      to: getAddress(tx.to),
      data: tx.data as Hex,
      gasLimit: tx.gasLimit ? BigInt(tx.gasLimit) : undefined,
      tool: q.toolDetails?.name ?? q.tool ?? 'LI.FI',
      feeUsd,
    },
  };
}

/** A verified quote, null if LI.FI has no route for this size */
export async function getLifiQuote(
  venue: SwapVenue,
  tokenIn: `0x${string}`,
  tokenOut: `0x${string}`,
  amountIn: bigint,
  account: `0x${string}`,
): Promise<LifiQuote | null> {
  const params = new URLSearchParams({
    fromChain: String(ACTIVE_CHAIN_ID),
    toChain: String(ACTIVE_CHAIN_ID),
    fromToken: tokenIn,
    toToken: tokenOut,
    fromAmount: amountIn.toString(),
    fromAddress: account,
    toAddress: account,
    slippage: String(Number(SWAP_SLIPPAGE_BPS) / 10_000),
    order: 'CHEAPEST',
  });
  const res = await fetch(`${LIFI_API}/quote?${params}`, { headers: { accept: 'application/json' } });
  // 404: no route found for this pair/size
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`LI.FI quote failed (${res.status})`);
  return verify((await res.json()) as RawQuote, venue, tokenIn, tokenOut, amountIn, account);
}

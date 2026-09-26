/**
 * Read a wallet's past token transfers back off Arc, so "/history" opens with
 * what actually happened rather than only what this browser watched.
 *
 * Arc's public RPCs put real limits on this, all measured rather than assumed:
 *
 * - `eth_getLogs` answers at most **5,000 blocks** per query on the endpoints
 *   that keep full history (the one node that allows 10,000 has pruned
 *   everything older than about two days).
 * - Roughly **three calls a second** get through before the rate limiter
 *   answers "rate limit exceeded", batching included — a batch is counted call
 *   by call.
 * - Blocks are about half a second, so a day is ~170,000 blocks: 34 chunks,
 *   two calls each (transfers out, transfers in), about half a minute.
 *
 * So scanning is deliberately incremental: one window at a time, from the
 * oldest block already scanned, with progress the caller can show and a signal
 * it can cancel. All three tokens are covered by one call per direction, since
 * a log filter accepts several contract addresses at once.
 */
import { formatUnits, parseAbiItem, type Address, type Log, type PublicClient } from 'viem';
import { getPublicClient } from 'wagmi/actions';
import { config } from '@/config';
import { ACTIVE_CHAIN_ID } from '@/chain-env';
import { getTokens } from '@/tokens';
import type { NewActivity } from '@/lib/activity';

const TRANSFER = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');
/** A decoded Transfer log, with `args` typed by the event above */
type TransferLog = Log<bigint, number, false, typeof TRANSFER, false>;

/** The widest range Arc's public RPCs answer */
const CHUNK = 5_000n;
/** ~0.5s blocks */
export const BLOCKS_PER_DAY = 170_000n;
/** Above this, the rate limiter starts refusing */
const CONCURRENCY = 3;
const RETRIES = 4;

export interface ScanProgress {
  /** Chunks finished so far */
  done: number;
  total: number;
  /** Entries found so far */
  found: number;
}

export interface ScanResult {
  entries: NewActivity[];
  /** The oldest block this scan covered, to continue from next time */
  floor: number;
  /** True when the scan stopped early because it was cancelled */
  cancelled: boolean;
}

const isRateLimit = (err: unknown) => /rate limit|429|too many/i.test(err instanceof Error ? err.message : String(err));

async function withRetry<T>(work: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    try {
      return await work();
    } catch (err) {
      lastError = err;
      if (!isRateLimit(err)) throw err;
      // Back off and let the limiter's window roll over
      await new Promise((resolve) => setTimeout(resolve, 400 * 2 ** attempt));
    }
  }
  throw lastError;
}

/** Run `work` over `items`, a few at a time, in order of completion */
async function pooled<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index] as T);
    }
  });
  await Promise.all(runners);
  return results;
}

const short = (value: string) => `${value.slice(0, 6)}…${value.slice(-4)}`;

/**
 * Read one window of history, newest block first.
 *
 * @param address the wallet whose transfers to look for
 * @param toBlock the newest block to cover; defaults to the chain head
 * @param days how far back to go from there
 */
export async function scanHistory(
  address: Address,
  { toBlock, days = 1, onProgress, signal }: { toBlock?: bigint; days?: number; onProgress?: (p: ScanProgress) => void; signal?: AbortSignal } = {},
): Promise<ScanResult> {
  // Without an address the log filter would match every transfer on the chain,
  // which is megabytes per chunk and useless to boot
  if (!address) throw new Error('No wallet to look up');
  const client = getPublicClient(config, { chainId: ACTIVE_CHAIN_ID }) as PublicClient | undefined;
  if (!client) throw new Error(`No connection to ${ACTIVE_CHAIN_ID}`);
  const tokens = getTokens(ACTIVE_CHAIN_ID);
  const addresses = tokens.map((t) => t.address as Address);
  const decimals = new Map(tokens.map((t) => [t.address.toLowerCase(), t]));

  const head = toBlock ?? (await withRetry(() => client.getBlockNumber()));
  const span = BLOCKS_PER_DAY * BigInt(Math.max(1, Math.round(days)));
  const floor = head > span ? head - span : 0n;

  const ranges: { from: bigint; to: bigint }[] = [];
  for (let to = head; to > floor; to -= CHUNK) {
    const from = to - CHUNK + 1n > floor ? to - CHUNK + 1n : floor;
    ranges.push({ from, to });
  }

  let done = 0;
  let found = 0;
  let cancelled = false;
  type Found = { log: TransferLog; outgoing: boolean };
  const hits: Found[] = [];

  await pooled(ranges, CONCURRENCY, async ({ from, to }) => {
    if (signal?.aborted) {
      cancelled = true;
      return;
    }
    try {
      // Two calls: what this wallet sent, and what it received. A filter can't
      // express "from OR to", but it can cover every token in one go.
      const [sent, received] = await Promise.all([
        withRetry(() => client.getLogs({ address: addresses, event: TRANSFER, args: { from: address }, fromBlock: from, toBlock: to })),
        withRetry(() => client.getLogs({ address: addresses, event: TRANSFER, args: { to: address }, fromBlock: from, toBlock: to })),
      ]);
      for (const log of sent) hits.push({ log, outgoing: true });
      for (const log of received) hits.push({ log, outgoing: false });
      found += sent.length + received.length;
    } catch (err) {
      // One unlucky window shouldn't lose the rest of the scan
      console.error('[vlora] history scan chunk failed', from, to, err);
    }
    done += 1;
    onProgress?.({ done, total: ranges.length, found });
  });

  // Timestamps come from the blocks the transfers are in — only the ones we found
  const blocks = [...new Set(hits.map((h) => h.log.blockNumber))].filter((b): b is bigint => b != null);
  const times = new Map<bigint, number>();
  await pooled(blocks, CONCURRENCY, async (blockNumber) => {
    try {
      const block = await withRetry(() => client.getBlock({ blockNumber }));
      times.set(blockNumber, Number(block.timestamp) * 1000);
    } catch {
      // Without a timestamp the entry still stands; it just sorts by block order
    }
  });

  const entries: NewActivity[] = [];
  for (const { log, outgoing } of hits) {
    const token = decimals.get(log.address.toLowerCase());
    const { from, to, value } = log.args;
    if (!token || value == null || from == null || to == null) continue;
    // A transfer to yourself shows up in both queries
    if (outgoing && from.toLowerCase() === to.toLowerCase() && entries.some((e) => e.id === `arc-${log.transactionHash}-${log.logIndex}`)) continue;
    const amount = formatUnits(value, token.decimals);
    const counterparty = outgoing ? to : from;
    entries.push({
      id: `arc-${log.transactionHash}-${log.logIndex}`,
      at: times.get(log.blockNumber ?? 0n) ?? Date.now(),
      kind: 'payment',
      status: 'success',
      title: `${outgoing ? 'Sent' : 'Received'} ${amount} ${token.symbol} ${outgoing ? 'to' : 'from'} ${short(counterparty)}`,
      amount,
      token: token.symbol,
      counterparty,
      detail: 'Read back from Arc',
      txHash: log.transactionHash ?? undefined,
    });
  }

  return { entries, floor: Number(floor), cancelled };
}

/**
 * Read a wallet's past token transfers back off Arc, so "/history" shows what
 * actually happened rather than only what this browser watched.
 *
 * Arc's public RPCs set the pace, all measured rather than assumed:
 *
 * - `eth_getLogs` answers at most **5,000 blocks** per query on the endpoints
 *   that keep full history (the one node allowing 10,000 has pruned everything
 *   older than about two days).
 * - Roughly **three calls a second** get through before the rate limiter
 *   answers "rate limit exceeded", batching included — a batch is counted call
 *   by call.
 * - Blocks are about half a second, so a day is ~170,000 blocks: 34 chunks, two
 *   calls each (transfers out, transfers in).
 *
 * A whole history therefore can't be one request, but it can be one press. The
 * scan first finds the block where this wallet's history begins — a binary
 * search over archive state, about 25 calls — so it only reads the range that
 * can hold anything, then works through it, handing entries over as it finds
 * them so the list fills in while it runs. It can be stopped at any point and
 * resumed from where it stopped.
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
/** Hand entries back this often, so rows appear while the scan runs */
const FLUSH_EVERY = 6;

export interface ScanProgress {
  /** Chunks finished */
  done: number;
  total: number;
  /** Transfers found so far */
  found: number;
  /** Seconds left at the rate this scan is actually managing, once it can tell */
  secondsLeft: number | null;
}

export interface ScanResult {
  /** The oldest block covered, to resume from */
  floor: number;
  found: number;
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

/** Run `work` over `items`, a few at a time */
async function pooled<T>(items: T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        await work(items[index]);
      }
    }),
  );
}

const short = (value: string) => `${value.slice(0, 6)}…${value.slice(-4)}`;

function client(): PublicClient {
  const found = getPublicClient(config, { chainId: ACTIVE_CHAIN_ID }) as PublicClient | undefined;
  if (!found) throw new Error(`No connection to ${ACTIVE_CHAIN_ID}`);
  return found;
}

/**
 * The first block where this wallet existed at all: it had either sent a
 * transaction or held a balance. Neither can go back to being false once true —
 * a nonce never decreases, and a balance can only be spent by a transaction,
 * which raises the nonce — so a binary search is sound, and it turns "read
 * everything" into "read the part that can possibly hold anything".
 */
export async function findFirstActivity(address: Address, head: bigint): Promise<bigint> {
  const rpc = client();
  const used = async (block: bigint) => {
    if (block <= 0n) return false;
    const [nonce, balance] = await Promise.all([
      withRetry(() => rpc.getTransactionCount({ address, blockNumber: block })),
      withRetry(() => rpc.getBalance({ address, blockNumber: block })),
    ]);
    return nonce > 0 || balance > 0n;
  };

  // A wallet with nothing to its name has no history to read
  if (!(await used(head))) return head;
  let low = 0n;
  let high = head;
  // ~25 probes over 23M blocks, stopping once the answer is inside one chunk
  while (high - low > CHUNK) {
    const mid = (low + high) / 2n;
    if (await used(mid)) high = mid;
    else low = mid;
  }
  return low;
}

export interface ScanOptions {
  /** Newest block to cover; defaults to the chain head */
  toBlock?: bigint;
  /** Oldest block to cover; defaults to where this wallet's history begins */
  fromBlock?: bigint;
  onProgress?: (progress: ScanProgress) => void;
  /** Called with entries as they are found, so they can be shown before the end */
  onEntries?: (entries: NewActivity[]) => void;
  signal?: AbortSignal;
}

/** Every token transfer this wallet was part of, newest first */
export async function scanHistory(
  address: Address,
  { toBlock, fromBlock, onProgress, onEntries, signal }: ScanOptions = {},
): Promise<ScanResult> {
  // Without an address the log filter would match every transfer on the chain,
  // which is megabytes per chunk and useless to boot
  if (!address) throw new Error('No wallet to look up');
  const rpc = client();
  const tokens = getTokens(ACTIVE_CHAIN_ID);
  const addresses = tokens.map((t) => t.address);
  const byAddress = new Map(tokens.map((t) => [t.address.toLowerCase(), t]));

  const head = toBlock ?? (await withRetry(() => rpc.getBlockNumber()));
  const floor = fromBlock ?? (await findFirstActivity(address, head));

  const ranges: { from: bigint; to: bigint }[] = [];
  for (let to = head; to > floor; to -= CHUNK) {
    const from = to - CHUNK + 1n > floor ? to - CHUNK + 1n : floor;
    ranges.push({ from, to });
  }

  type Hit = { log: TransferLog; outgoing: boolean };
  const started = Date.now();
  let done = 0;
  let found = 0;
  let cancelled = false;
  let pending: Hit[] = [];

  const flush = async () => {
    const batch = pending;
    pending = [];
    if (batch.length === 0) return;
    // Timestamps come from the blocks the transfers are in, and only those
    const blocks = [...new Set(batch.map((h) => h.log.blockNumber))].filter((b): b is bigint => b != null);
    const times = new Map<bigint, number>();
    await pooled(blocks, CONCURRENCY, async (blockNumber) => {
      try {
        const block = await withRetry(() => rpc.getBlock({ blockNumber }));
        times.set(blockNumber, Number(block.timestamp) * 1000);
      } catch {
        // Without a timestamp the entry still stands
      }
    });
    const entries: NewActivity[] = [];
    for (const { log, outgoing } of batch) {
      const token = byAddress.get(log.address.toLowerCase());
      const { from, to, value } = log.args;
      if (!token || value == null || from == null || to == null) continue;
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
    if (entries.length > 0) onEntries?.(entries);
  };

  await pooled(ranges, CONCURRENCY, async ({ from, to }) => {
    if (signal?.aborted) {
      cancelled = true;
      return;
    }
    try {
      // Two calls: what this wallet sent, and what it received. A filter can't
      // express "from OR to", but it does cover every token at once.
      const [sent, received] = await Promise.all([
        withRetry(() => rpc.getLogs({ address: addresses, event: TRANSFER, args: { from: address }, fromBlock: from, toBlock: to })),
        withRetry(() => rpc.getLogs({ address: addresses, event: TRANSFER, args: { to: address }, fromBlock: from, toBlock: to })),
      ]);
      for (const log of sent) pending.push({ log, outgoing: true });
      for (const log of received) pending.push({ log, outgoing: false });
      found += sent.length + received.length;
    } catch (err) {
      // One unlucky window shouldn't lose the rest of the scan
      console.error('[vlora] history scan chunk failed', from, to, err);
    }
    done += 1;
    if (done % FLUSH_EVERY === 0) await flush();
    const rate = done / Math.max(1, (Date.now() - started) / 1000);
    onProgress?.({ done, total: ranges.length, found, secondsLeft: done > 3 ? Math.round((ranges.length - done) / rate) : null });
  });
  await flush();

  return { floor: Number(floor), found, cancelled };
}

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useAccount } from 'wagmi';
import { toast } from 'sonner';
import { ChevronDown, Clock, Download, ExternalLink, History, Loader2, Receipt, Share2, X } from 'lucide-react';
import {
  ACTIVITY_LABELS,
  explorerTxUrl,
  loadActivity,
  mergeActivity,
  scanFloor,
  setScanFloor,
  subscribeActivity,
  type ActivityEntry,
  type ActivityKind,
} from '@/lib/activity';
import { scanHistory, type ScanProgress } from '@/lib/backfillHistory';
import { downloadReceipt, shareReceipt } from '@/lib/receipt';
import { ACTIVE_CHAIN } from '@/chain-env';
import { cn } from '@/lib/utils';
import { Card, EmptyState } from '@/components/ui';

interface HistoryPanelProps {
  collapsible?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const ORDER: ActivityKind[] = ['payment', 'swap', 'bridge', 'cashout', 'airtime', 'utilities', 'earn', 'deposit'];

type TimeRange = 'all' | '1d' | '7d' | '30d' | 'custom';

const RANGE_LABELS: Record<TimeRange, string> = {
  all: 'All',
  '1d': '24h',
  '7d': '7 days',
  '30d': '30 days',
  custom: 'Dates',
};

/** "4 min" / "40 sec", for the progress line */
const formatLeft = (seconds: number) => (seconds >= 90 ? `${Math.round(seconds / 60)} min` : `${seconds} sec`);

const when = (at: number) => {
  const date = new Date(at);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return sameDay
    ? date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};

/**
 * "/history": everything this wallet has done in Vlora, grouped by what it was,
 * with a receipt for each one (src/lib/receipt.ts). The log lives in this browser
 * (src/lib/activity.ts) — the chain is the record, this is the readable version.
 */
export function HistoryPanel({ collapsible = false, open: openProp, onOpenChange }: HistoryPanelProps) {
  const { address } = useAccount();
  const [openSelf, setOpenSelf] = useState(!collapsible);
  const open = openProp ?? openSelf;
  const setOpen = (next: boolean) => {
    setOpenSelf(next);
    onOpenChange?.(next);
  };

  const entries = useSyncExternalStore(
    subscribeActivity,
    () => loadActivity(address),
    // Same stable empty list the store returns for no wallet
    () => loadActivity(undefined),
  );
  const [filter, setFilter] = useState<ActivityKind | 'all'>('all');
  const [range, setRange] = useState<TimeRange>('all');
  // "Last 24 hours" is relative to a clock that moves, so it lives in state and
  // ticks on a timer rather than being read while rendering
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [scan, setScan] = useState<ScanProgress | null>(null);
  const cancelScan = useRef<AbortController | null>(null);

  /**
   * Read this wallet's whole history off Arc in one press. The scan finds where
   * the wallet's history begins and works through everything since, adding rows
   * as it finds them (src/lib/backfillHistory.ts). Stopping keeps what it found,
   * and the next press carries on from there.
   */
  const loadEarlier = async () => {
    if (!address || scan) return;
    const controller = new AbortController();
    cancelScan.current = controller;
    setScan({ done: 0, total: 0, found: 0, secondsLeft: null });
    let added = 0;
    try {
      const floor = scanFloor(address);
      const result = await scanHistory(address, {
        // A resumed scan carries on below the oldest block already covered
        ...(floor ? { toBlock: BigInt(floor) } : {}),
        onProgress: setScan,
        onEntries: (found) => {
          added += mergeActivity(address, found);
        },
        signal: controller.signal,
      });
      if (!result.cancelled) setScanFloor(address, result.floor);
      toast.success(
        added > 0
          ? `Added ${added} ${added === 1 ? 'transfer' : 'transfers'} from ${ACTIVE_CHAIN.name}.`
          : result.cancelled
            ? 'Stopped.'
            : 'Nothing earlier to find — your history is complete.',
      );
    } catch (err) {
      console.error('[vlora] history scan failed', err);
      toast.error(err instanceof Error ? err.message : "Couldn't read your history from Arc.");
    } finally {
      cancelScan.current = null;
      setScan(null);
    }
  };

  const kinds = useMemo(() => ORDER.filter((k) => entries.some((e) => e.kind === k)), [entries]);

  // The window the list covers. Custom dates are read as whole local days, so
  // picking today as the end includes everything done today.
  const window = useMemo(() => {
    if (range === 'all') return null;
    if (range === 'custom') {
      const start = customFrom ? new Date(`${customFrom}T00:00:00`).getTime() : 0;
      const end = customTo ? new Date(`${customTo}T23:59:59.999`).getTime() : now;
      return Number.isFinite(start) && Number.isFinite(end) && end >= start ? { start, end } : null;
    }
    const days = range === '1d' ? 1 : range === '7d' ? 7 : 30;
    return { start: now - days * 86_400_000, end: now };
  }, [range, customFrom, customTo, now]);

  const shown = useMemo(
    () =>
      entries.filter(
        (entry) =>
          (filter === 'all' || entry.kind === filter) && (window == null || (entry.at >= window.start && entry.at <= window.end)),
      ),
    [entries, filter, window],
  );

  /** What left the wallet in view, so a period has a figure and not just rows */
  const spent = useMemo(() => {
    const byToken = new Map<string, number>();
    for (const entry of shown) {
      if (!entry.amount || entry.status === 'failed') continue;
      // Money coming in is not money spent
      if (/^received/i.test(entry.title)) continue;
      const token = entry.token ?? 'USDC';
      byToken.set(token, (byToken.get(token) ?? 0) + Number(entry.amount));
    }
    return [...byToken.entries()]
      .filter(([, total]) => total > 0)
      .map(([token, total]) => `${total.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${token}`)
      .join(' · ');
  }, [shown]);

  // Asking for a month when only a week has been read back is worth saying
  const oldest = entries.length > 0 ? Math.min(...entries.map((e) => e.at)) : null;
  const beyondWhatWeHave = window != null && oldest != null && window.start < oldest - 86_400_000;

  const save = async (entry: ActivityEntry, mode: 'share' | 'download') => {
    setBusy(entry.id);
    try {
      if (mode === 'share') {
        const how = await shareReceipt(entry);
        if (how === 'downloaded') toast.success('Receipt saved.');
      } else {
        await downloadReceipt(entry);
        toast.success('Receipt saved.');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't make that receipt.");
    } finally {
      setBusy(null);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-between gap-2 rounded-card-sm border border-line/15 bg-surface/80 px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2.5 text-sm font-medium text-ink">
          <Clock className="size-4 text-brand" /> History
          {entries.length > 0 && <span className="text-xs text-muted">{entries.length}</span>}
        </span>
        <ChevronDown className="size-4 text-muted" />
      </button>
    );
  }

  return (
    <Card>
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <Clock className="size-4 text-brand" /> History
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-muted">Everything you've done here, with a receipt you can save or send on.</p>
        </div>
        {collapsible && (
          <button onClick={() => setOpen(false)} aria-label="Hide" className="text-subtle hover:text-ink">
            <X className="size-4" />
          </button>
        )}
      </div>

      {entries.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="No history yet"
          body={`This list starts the moment you use Vlora. Anything you did before that is still on ${ACTIVE_CHAIN.name}, and the button above reads it back.`}
        />
      ) : (
        <>
          <div className="mt-4 flex gap-1.5 overflow-x-auto pb-1">
            {(Object.keys(RANGE_LABELS) as TimeRange[]).map((option) => (
              <button
                key={option}
                onClick={() => setRange(option)}
                className={cn(
                  'shrink-0 rounded-pill border px-2.5 py-1 text-xs font-semibold',
                  range === option ? 'border-brand/40 bg-brand/10 text-brand' : 'border-line/15 text-muted',
                )}
              >
                {RANGE_LABELS[option]}
              </button>
            ))}
          </div>

          {range === 'custom' && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <label className="block text-xs text-muted">
                From
                <input
                  type="date"
                  value={customFrom}
                  max={customTo || undefined}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="mt-1 w-full rounded-control border border-line/15 bg-surface px-2.5 py-1.5 text-xs text-ink outline-none focus:border-brand/50"
                />
              </label>
              <label className="block text-xs text-muted">
                To
                <input
                  type="date"
                  value={customTo}
                  min={customFrom || undefined}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="mt-1 w-full rounded-control border border-line/15 bg-surface px-2.5 py-1.5 text-xs text-ink outline-none focus:border-brand/50"
                />
              </label>
            </div>
          )}

          <p className="mt-2 text-xs text-muted">
            {shown.length === 0
              ? 'Nothing in this period.'
              : `${shown.length} ${shown.length === 1 ? 'entry' : 'entries'}${spent ? ` · ${spent} out` : ''}`}
            {beyondWhatWeHave && ' · earlier days may not be read from Arc yet'}
          </p>

          {kinds.length > 1 && (
            <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1">
              {(['all', ...kinds] as const).map((kind) => (
                <button
                  key={kind}
                  onClick={() => setFilter(kind)}
                  className={cn(
                    'shrink-0 rounded-pill border px-2.5 py-1 text-xs font-semibold',
                    filter === kind ? 'border-brand/40 bg-brand/10 text-brand' : 'border-line/15 text-muted',
                  )}
                >
                  {kind === 'all' ? 'All' : ACTIVITY_LABELS[kind]}
                </button>
              ))}
            </div>
          )}

          <ul className="mt-3 divide-y divide-line/10">
            {shown.map((entry) => (
              <li key={entry.id} className="py-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-ink">{entry.title}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted">
                      <span>{when(entry.at)}</span>
                      <span>·</span>
                      <span>{ACTIVITY_LABELS[entry.kind]}</span>
                      {entry.fiat && (
                        <>
                          <span>·</span>
                          <span>
                            {entry.fiat.amount} {entry.fiat.currency}
                          </span>
                        </>
                      )}
                      {entry.status !== 'success' && (
                        <>
                          <span>·</span>
                          <span className={entry.status === 'failed' ? 'text-danger' : 'text-brand'}>
                            {entry.status === 'failed' ? 'failed' : 'in progress'}
                          </span>
                        </>
                      )}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {entry.txHash && (
                      <a
                        href={explorerTxUrl(entry.txHash)}
                        target="_blank"
                        rel="noreferrer"
                        aria-label="View on the explorer"
                        className="rounded-control p-1.5 text-subtle hover:text-ink"
                      >
                        <ExternalLink className="size-3.5" />
                      </a>
                    )}
                    <button
                      onClick={() => void save(entry, 'download')}
                      aria-label="Download receipt"
                      className="rounded-control p-1.5 text-subtle hover:text-ink"
                    >
                      {busy === entry.id ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
                    </button>
                    <button
                      onClick={() => void save(entry, 'share')}
                      aria-label="Share receipt"
                      className="rounded-control p-1.5 text-subtle hover:text-ink"
                    >
                      <Share2 className="size-3.5" />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs leading-relaxed text-subtle">
            This list is kept in this browser, so it won't follow you to another device. Receipts are generated on your phone or computer
            and never uploaded.
          </p>
        </>
      )}

      {address && (
        <div className="mt-3 border-t border-line/10 pt-3">
          {scan ? (
            <>
              <p className="flex items-center gap-2 text-xs text-muted">
                <Loader2 className="size-3.5 shrink-0 animate-spin" />
                {scan.total === 0
                  ? `Finding where your history starts on ${ACTIVE_CHAIN.name}…`
                  : `Reading ${ACTIVE_CHAIN.name} — ${Math.round((scan.done / scan.total) * 100)}%`}
                {scan.found > 0 ? ` · ${scan.found} found` : ''}
                {scan.secondsLeft != null && scan.secondsLeft > 5 ? ` · ${formatLeft(scan.secondsLeft)} left` : ''}
              </p>
              <button
                onClick={() => cancelScan.current?.abort()}
                className="mt-2 w-full rounded-control border border-line/15 py-2 text-xs font-semibold text-ink"
              >
                Stop
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => void loadEarlier()}
                className="flex w-full items-center justify-center gap-2 rounded-control border border-line/15 py-2 text-xs font-semibold text-ink"
              >
                <History className="size-3.5" />
                {scanFloor(address) ? 'Keep reading older history' : 'Load my history from Arc'}
              </button>
              <p className="mt-1.5 text-xs leading-relaxed text-subtle">
                Reads every transfer this wallet has made or received. Arc's public nodes answer 5,000 blocks at a time, so a long history
                takes a few minutes — rows appear as they are found, and you can stop whenever.
              </p>
            </>
          )}
        </div>
      )}
    </Card>
  );
}

import { useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useAccount } from 'wagmi';
import { toast } from 'sonner';
import { ChevronDown, Clock, Download, ExternalLink, History, Loader2, Share2, X } from 'lucide-react';
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

interface HistoryPanelProps {
  collapsible?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const ORDER: ActivityKind[] = ['payment', 'swap', 'bridge', 'cashout', 'airtime', 'utilities', 'earn', 'deposit'];

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
  const [busy, setBusy] = useState<string | null>(null);
  const [scan, setScan] = useState<ScanProgress | null>(null);
  const cancelScan = useRef<AbortController | null>(null);

  /**
   * Read another day of transfers off Arc and fold them in. Each press
   * continues from the oldest block already scanned, because the public RPC
   * only answers 5,000 blocks at a time (src/lib/backfillHistory.ts).
   */
  const loadEarlier = async () => {
    if (!address || scan) return;
    const controller = new AbortController();
    cancelScan.current = controller;
    setScan({ done: 0, total: 0, found: 0 });
    try {
      const floor = scanFloor(address);
      const result = await scanHistory(address, {
        ...(floor ? { toBlock: BigInt(floor) } : {}),
        days: 1,
        onProgress: setScan,
        signal: controller.signal,
      });
      const added = mergeActivity(address, result.entries);
      if (!result.cancelled) setScanFloor(address, result.floor);
      toast.success(
        added > 0
          ? `Added ${added} earlier ${added === 1 ? 'transfer' : 'transfers'} from Arc.`
          : 'No transfers in that day. Press again to look further back.',
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
  const shown = filter === 'all' ? entries : entries.filter((e) => e.kind === filter);

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
        className="flex w-full items-center justify-between gap-2 rounded-2xl border border-line/15 bg-surface/80 px-4 py-3 text-left"
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
    <section className="rounded-3xl border border-line/10 bg-surface/80 p-5 backdrop-blur">
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
        <p className="mt-4 rounded-xl bg-surface-2 px-3 py-2 text-xs leading-relaxed text-muted">
          Nothing here yet — this list starts from the moment you use Vlora. Anything you did before that is still on {' '}
          {ACTIVE_CHAIN.name}, and the button below reads it back.
        </p>
      ) : (
        <>
          {kinds.length > 1 && (
            <div className="mt-4 flex gap-1.5 overflow-x-auto pb-1">
              {(['all', ...kinds] as const).map((kind) => (
                <button
                  key={kind}
                  onClick={() => setFilter(kind)}
                  className={cn(
                    'shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold',
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
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px] text-muted">
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
                        className="rounded-lg p-1.5 text-subtle hover:text-ink"
                      >
                        <ExternalLink className="size-3.5" />
                      </a>
                    )}
                    <button
                      onClick={() => void save(entry, 'download')}
                      aria-label="Download receipt"
                      className="rounded-lg p-1.5 text-subtle hover:text-ink"
                    >
                      {busy === entry.id ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
                    </button>
                    <button
                      onClick={() => void save(entry, 'share')}
                      aria-label="Share receipt"
                      className="rounded-lg p-1.5 text-subtle hover:text-ink"
                    >
                      <Share2 className="size-3.5" />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] leading-relaxed text-subtle">
            This list is kept in this browser, so it won't follow you to another device. Receipts are generated on your phone or computer
            and never uploaded.
          </p>
        </>
      )}

      {address && (
        <div className="mt-3 border-t border-line/10 pt-3">
          {scan ? (
            <>
              <p className="flex items-center gap-2 text-[11px] text-muted">
                <Loader2 className="size-3.5 shrink-0 animate-spin" />
                Reading {ACTIVE_CHAIN.name}
                {scan.total > 0 ? ` — ${Math.round((scan.done / scan.total) * 100)}%` : '…'}
                {scan.found > 0 ? ` · ${scan.found} found` : ''}
              </p>
              <button
                onClick={() => cancelScan.current?.abort()}
                className="mt-2 w-full rounded-xl border border-line/15 py-2 text-[11px] font-semibold text-ink"
              >
                Stop
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => void loadEarlier()}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-line/15 py-2 text-[11px] font-semibold text-ink"
              >
                <History className="size-3.5" />
                {scanFloor(address) ? 'Load another day from Arc' : 'Load earlier from Arc'}
              </button>
              <p className="mt-1.5 text-[11px] leading-relaxed text-subtle">
                Arc's public nodes answer 5,000 blocks at a time, so this reads one day per press and takes about half a minute.
              </p>
            </>
          )}
        </div>
      )}
    </section>
  );
}

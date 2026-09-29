import { useMemo, useState, useSyncExternalStore } from 'react';
import { useAccount } from 'wagmi';
import { toast } from 'sonner';
import { Download, TrendingUp } from 'lucide-react';
import { ACTIVE_CHAIN } from '@/chain-env';
import { loadActivity, subscribeActivity, type ActivityEntry } from '@/lib/activity';
import { bucketActivity, totalsOf, usdc, type Grain } from '@/lib/insights';
import { downloadStatement } from '@/lib/statement';
import { SpendChart } from '@/components/SpendChart';
import { cn } from '@/lib/utils';

const GRAINS: { id: Grain; label: string; periods: number }[] = [
  { id: 'day', label: 'Daily', periods: 30 },
  { id: 'week', label: 'Weekly', periods: 12 },
  { id: 'month', label: 'Monthly', periods: 12 },
  { id: 'year', label: 'Yearly', periods: 5 },
];

/**
 * Where the money went.
 *
 * The chart answers "how much", the tap answers "on what" — a line of totals is
 * only half an answer, and the half people act on is the breakdown.
 *
 * Everything is computed from the activity log, so it covers what this browser
 * recorded plus whatever has been read back off Arc. The panel says so, because
 * a spending total that silently omits half your history is worse than none.
 */
export function InsightsPanel() {
  const { address } = useAccount();
  const entries = useSyncExternalStore(
    subscribeActivity,
    () => loadActivity(address),
    () => loadActivity(undefined),
  );
  const [grain, setGrain] = useState<Grain>('day');
  const [selected, setSelected] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const periods = GRAINS.find((g) => g.id === grain)?.periods ?? 30;
  const buckets = useMemo(() => bucketActivity(entries, grain, periods), [entries, grain, periods]);
  const totals = useMemo(() => totalsOf(buckets), [buckets]);
  const open = buckets.find((b) => b.at === selected) ?? null;

  const save = async (format: 'csv' | 'print') => {
    setSaving(true);
    try {
      await downloadStatement({
        entries: buckets.flatMap((b) => b.entries),
        from: buckets[0]?.at ?? Date.now(),
        to: Date.now(),
        address: address ?? '',
        format,
      });
      if (format === 'csv') toast.success('Statement saved.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't make that statement.");
    } finally {
      setSaving(false);
    }
  };

  if (entries.length === 0) {
    return (
      <section className="rounded-3xl border border-line/10 bg-surface/80 p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
          <TrendingUp className="size-4 text-brand" /> Activity
        </h2>
        <p className="mt-2 text-xs leading-relaxed text-muted">
          Nothing to chart yet. Once you send, swap, pay a bill or cash out, this shows where the money went — and History can read your
          earlier transfers back off {ACTIVE_CHAIN.name}.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-3xl border border-line/10 bg-surface/80 p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <TrendingUp className="size-4 text-brand" /> Activity
          </h2>
          <p className="mt-1 text-xs text-muted">Tap any point to see what that period went on.</p>
        </div>
        <div className="flex gap-1.5">
          {GRAINS.map((option) => (
            <button
              key={option.id}
              onClick={() => {
                setGrain(option.id);
                setSelected(null);
              }}
              className={cn(
                'rounded-full border px-2.5 py-1 text-[11px] font-semibold',
                grain === option.id ? 'border-brand/40 bg-brand/10 text-brand' : 'border-line/15 text-muted',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {/* The headline figures, which is what a stat row is for */}
      <div className="mt-4 grid grid-cols-2 gap-2">
        <div className="rounded-2xl bg-surface-2 px-3 py-2.5">
          <p className="text-[11px] text-muted">Out</p>
          <p className="text-lg font-semibold text-ink">{usdc(totals.out)} USDC</p>
        </div>
        <div className="rounded-2xl bg-surface-2 px-3 py-2.5">
          <p className="text-[11px] text-muted">In</p>
          <p className="text-lg font-semibold text-success">{usdc(totals.in)} USDC</p>
        </div>
      </div>

      <div className="mt-3">
        <SpendChart buckets={buckets} selected={selected} onSelect={setSelected} />
      </div>

      {open ? (
        <div className="mt-2 rounded-2xl bg-surface-2 px-3 py-2.5">
          <p className="text-[11px] font-semibold text-ink">
            {open.label} · {usdc(open.out)} USDC out
            {open.in > 0 && <span className="font-normal text-muted"> · {usdc(open.in)} in</span>}
          </p>
          {open.byKind.length === 0 ? (
            <p className="mt-1 text-[11px] text-muted">Nothing went out in this period.</p>
          ) : (
            <ul className="mt-1.5 space-y-1">
              {open.byKind.map((row) => (
                <li key={row.kind} className="flex justify-between gap-3 text-[11px]">
                  <span className="text-muted">{row.label}</span>
                  <span className="font-medium text-ink">{usdc(row.amount)} USDC</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        totals.byKind.length > 0 && (
          <ul className="mt-2 space-y-1">
            {totals.byKind.map((row) => (
              <li key={row.kind} className="flex justify-between gap-3 text-[11px]">
                <span className="text-muted">{row.label}</span>
                <span className="font-medium text-ink">{usdc(row.amount)} USDC</span>
              </li>
            ))}
          </ul>
        )
      )}

      <div className="mt-4 grid grid-cols-2 gap-2 border-t border-line/10 pt-3">
        <button
          onClick={() => void save('csv')}
          disabled={saving}
          className="flex items-center justify-center gap-2 rounded-xl border border-line/15 py-2 text-[11px] font-semibold text-ink"
        >
          <Download className="size-3.5" /> Statement (CSV)
        </button>
        <button
          onClick={() => void save('print')}
          disabled={saving}
          className="flex items-center justify-center gap-2 rounded-xl border border-line/15 py-2 text-[11px] font-semibold text-ink"
        >
          Statement (PDF)
        </button>
      </div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-subtle">
        Built from what this browser recorded and whatever History has read back off {ACTIVE_CHAIN.name}. Emailing a statement is coming;
        for now the PDF opens your print dialog, where &ldquo;Save as PDF&rdquo; gives you the file.
      </p>
    </section>
  );
}

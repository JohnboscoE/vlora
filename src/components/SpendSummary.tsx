import { useMemo, useState, useSyncExternalStore } from 'react';
import { useAccount } from 'wagmi';
import { loadActivity, subscribeActivity } from '@/lib/activity';
import { bucketActivity, totalsOf, usdc, type Grain } from '@/lib/insights';
import { SpendChart } from '@/components/SpendChart';
import { cn } from '@/lib/utils';

const GRAINS: { id: Grain; label: string; periods: number }[] = [
  { id: 'day', label: 'Daily', periods: 30 },
  { id: 'week', label: 'Weekly', periods: 12 },
  { id: 'month', label: 'Monthly', periods: 12 },
];

/**
 * The spending chart, small enough to sit inside a chat message.
 *
 * Asking "/activity" is a question, and the answer to a question about money
 * over time is a picture of it — not a sentence saying a picture exists on
 * another tab.
 */
export function SpendSummary() {
  const { address } = useAccount();
  const entries = useSyncExternalStore(
    subscribeActivity,
    () => loadActivity(address),
    () => loadActivity(undefined),
  );
  const [grain, setGrain] = useState<Grain>('day');
  const [selected, setSelected] = useState<number | null>(null);

  const periods = GRAINS.find((g) => g.id === grain)?.periods ?? 30;
  const buckets = useMemo(() => bucketActivity(entries, grain, periods), [entries, grain, periods]);
  const totals = useMemo(() => totalsOf(buckets), [buckets]);
  const open = buckets.find((b) => b.at === selected) ?? null;

  if (entries.length === 0) {
    return <p className="mt-2 text-xs text-muted">Nothing to chart yet — this fills in as you use Vlora.</p>;
  }

  return (
    <div className="mt-3 rounded-card-sm bg-surface/60 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted">
          <span className="font-semibold text-ink">{usdc(totals.out)} USDC</span> out
          {totals.in > 0 && <span> · {usdc(totals.in)} in</span>}
        </p>
        <div className="flex gap-1">
          {GRAINS.map((option) => (
            <button
              key={option.id}
              onClick={() => {
                setGrain(option.id);
                setSelected(null);
              }}
              className={cn(
                'rounded-pill px-2 py-0.5 text-micro font-semibold',
                grain === option.id ? 'bg-brand/10 text-brand' : 'text-muted',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <SpendChart buckets={buckets} selected={selected} onSelect={setSelected} />

      {open && (
        <div className="mt-1">
          <p className="text-xs font-semibold text-ink">
            {open.label} · {usdc(open.out)} USDC out
          </p>
          {open.byKind.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {open.byKind.map((row) => (
                <li key={row.kind} className="flex justify-between gap-3 text-xs">
                  <span className="text-muted">{row.label}</span>
                  <span className="font-medium text-ink">{usdc(row.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

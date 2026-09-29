/**
 * What the activity log adds up to.
 *
 * Every figure here comes from entries this app recorded or read back off Arc
 * (src/lib/activity.ts) — nothing is estimated, and an entry that failed is
 * never counted as money spent.
 */
import { ACTIVITY_LABELS, type ActivityEntry, type ActivityKind } from '@/lib/activity';

export type Grain = 'day' | 'week' | 'month' | 'year';

export interface Bucket {
  /** Start of the period, unix ms */
  at: number;
  label: string;
  /** USDC out in this period */
  out: number;
  /** USDC in */
  in: number;
  /** What the spending went on */
  byKind: { kind: ActivityKind; label: string; amount: number }[];
  entries: ActivityEntry[];
}

const DAY = 86_400_000;

/** Money coming in reads as "Received …" from the chain backfill */
const isIncoming = (entry: ActivityEntry) => /^received/i.test(entry.title);

function startOf(at: number, grain: Grain): number {
  const date = new Date(at);
  date.setHours(0, 0, 0, 0);
  if (grain === 'day') return date.getTime();
  if (grain === 'week') {
    // Weeks start on Monday, which is how people talk about "this week"
    const weekday = (date.getDay() + 6) % 7;
    return date.getTime() - weekday * DAY;
  }
  date.setDate(1);
  if (grain === 'month') return date.getTime();
  date.setMonth(0);
  return date.getTime();
}

function labelFor(at: number, grain: Grain): string {
  const date = new Date(at);
  if (grain === 'day') return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  if (grain === 'week') return `w/c ${date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;
  if (grain === 'month') return date.toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
  return String(date.getFullYear());
}

function step(at: number, grain: Grain): number {
  const date = new Date(at);
  if (grain === 'day') return at + DAY;
  if (grain === 'week') return at + 7 * DAY;
  if (grain === 'month') {
    date.setMonth(date.getMonth() + 1);
    return date.getTime();
  }
  date.setFullYear(date.getFullYear() + 1);
  return date.getTime();
}

/**
 * Entries grouped into periods, newest last, with empty periods kept.
 *
 * Empty periods matter: a line that skips the weeks you spent nothing implies
 * a steadier habit than the truth.
 */
export function bucketActivity(entries: ActivityEntry[], grain: Grain, periods: number): Bucket[] {
  const now = Date.now();
  const first = (() => {
    let at = startOf(now, grain);
    for (let i = 1; i < periods; i++) {
      const date = new Date(at);
      if (grain === 'day') at -= DAY;
      else if (grain === 'week') at -= 7 * DAY;
      else if (grain === 'month') {
        date.setMonth(date.getMonth() - 1);
        at = date.getTime();
      } else {
        date.setFullYear(date.getFullYear() - 1);
        at = date.getTime();
      }
    }
    return at;
  })();

  const buckets: Bucket[] = [];
  for (let at = first; at <= startOf(now, grain); at = step(at, grain)) {
    buckets.push({ at, label: labelFor(at, grain), out: 0, in: 0, byKind: [], entries: [] });
  }

  const byStart = new Map(buckets.map((b) => [b.at, b]));
  const spendByKind = new Map<number, Map<ActivityKind, number>>();

  for (const entry of entries) {
    if (entry.status === 'failed' || !entry.amount) continue;
    const bucket = byStart.get(startOf(entry.at, grain));
    if (!bucket) continue;
    const amount = Number(entry.amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    bucket.entries.push(entry);
    if (isIncoming(entry)) {
      bucket.in += amount;
      continue;
    }
    bucket.out += amount;
    const kinds = spendByKind.get(bucket.at) ?? new Map<ActivityKind, number>();
    kinds.set(entry.kind, (kinds.get(entry.kind) ?? 0) + amount);
    spendByKind.set(bucket.at, kinds);
  }

  for (const bucket of buckets) {
    const kinds = spendByKind.get(bucket.at);
    if (!kinds) continue;
    bucket.byKind = [...kinds.entries()]
      .map(([kind, amount]) => ({ kind, label: ACTIVITY_LABELS[kind], amount }))
      .sort((a, b) => b.amount - a.amount);
  }

  return buckets;
}

export interface Totals {
  out: number;
  in: number;
  byKind: { kind: ActivityKind; label: string; amount: number }[];
}

export function totalsOf(buckets: Bucket[]): Totals {
  const byKind = new Map<ActivityKind, number>();
  let out = 0;
  let incoming = 0;
  for (const bucket of buckets) {
    out += bucket.out;
    incoming += bucket.in;
    for (const row of bucket.byKind) byKind.set(row.kind, (byKind.get(row.kind) ?? 0) + row.amount);
  }
  return {
    out,
    in: incoming,
    byKind: [...byKind.entries()]
      .map(([kind, amount]) => ({ kind, label: ACTIVITY_LABELS[kind], amount }))
      .sort((a, b) => b.amount - a.amount),
  };
}

/** 4 decimals is plenty for USDC on a chart axis, and trailing zeros are noise */
export function usdc(value: number): string {
  if (value === 0) return '0';
  if (value < 0.01) return value.toFixed(4).replace(/\.?0+$/, '');
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

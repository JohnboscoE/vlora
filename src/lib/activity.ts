/**
 * Activity log: what this wallet has done in Vlora, so "/history" can show it and
 * every entry can be turned into a receipt.
 *
 * Stored per wallet and per network in this browser only — it is a convenience
 * record, not the source of truth. The chain is. Entries therefore carry the
 * transaction hash or provider reference that proves them, and a receipt always
 * points back at it.
 */
import { readJson, writeJson } from '@/lib/storage';
import { ACTIVE_CHAIN, ACTIVE_CHAIN_ID } from '@/chain-env';

export type ActivityKind = 'payment' | 'swap' | 'bridge' | 'cashout' | 'airtime' | 'utilities' | 'earn' | 'deposit';

export const ACTIVITY_LABELS: Record<ActivityKind, string> = {
  payment: 'Payments',
  swap: 'Swaps',
  bridge: 'Bridges',
  cashout: 'Cash-outs',
  airtime: 'Airtime & data',
  utilities: 'Bills & utilities',
  earn: 'Earn',
  deposit: 'Deposits',
};

export interface ActivityEntry {
  id: string;
  /** Unix ms */
  at: number;
  kind: ActivityKind;
  status: 'pending' | 'success' | 'failed';
  /** One line, e.g. "Sent 5 USDC to alice.arc" */
  title: string;
  /** What left the wallet, in whole tokens */
  amount?: string;
  token?: string;
  /** Address, .arc name, bank account or phone number on the other side */
  counterparty?: string;
  /** Extra line for the receipt, e.g. "GTBank · JOHN DOE" */
  detail?: string;
  /** Fiat leg, where there is one */
  fiat?: { currency: string; amount: string; rate?: string };
  /** Fees the user paid on top, in whole USDC */
  fee?: string;
  txHash?: string;
  /** Provider order id (Paycrest, Bitrefill…) */
  reference?: string;
  chainId: number;
  chainName: string;
}

const MAX_ENTRIES = 300;
const listeners = new Set<() => void>();
const EMPTY: ActivityEntry[] = [];

// useSyncExternalStore needs a stable reference between changes, so parsed lists
// are cached and the cache is invalidated by bumping `version` on every write.
let version = 0;
const cache = new Map<string, { version: number; entries: ActivityEntry[] }>();

function key(address: string): string {
  return `vlora.activity.${ACTIVE_CHAIN_ID}.${address.toLowerCase()}`;
}

export function loadActivity(address: string | undefined): ActivityEntry[] {
  if (!address) return EMPTY;
  const id = key(address);
  const cached = cache.get(id);
  if (cached && cached.version === version) return cached.entries;
  const entries = readJson<ActivityEntry[]>(id, EMPTY);
  cache.set(id, { version, entries });
  return entries;
}

function save(address: string, entries: ActivityEntry[]): void {
  const trimmed = entries.slice(0, MAX_ENTRIES);
  writeJson(key(address), trimmed);
  version += 1;
  cache.set(key(address), { version, entries: trimmed });
  for (const listener of listeners) listener();
}

/** Subscribe to changes; returns the unsubscribe function (for useSyncExternalStore) */
export function subscribeActivity(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export type NewActivity = Omit<ActivityEntry, 'id' | 'at' | 'chainId' | 'chainName'> & { id?: string; at?: number };

/** Record something the user did. Returns the entry's id so it can be updated later. */
export function recordActivity(address: string | undefined, entry: NewActivity): string {
  const id = entry.id ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  if (!address) return id;
  const full: ActivityEntry = {
    ...entry,
    id,
    at: entry.at ?? Date.now(),
    chainId: ACTIVE_CHAIN_ID,
    chainName: ACTIVE_CHAIN.name,
  };
  const existing = loadActivity(address).filter((e) => e.id !== id);
  save(address, [full, ...existing]);
  return id;
}

/** Patch an entry in place, e.g. when a pending payout settles */
export function updateActivity(address: string | undefined, id: string, patch: Partial<ActivityEntry>): void {
  if (!address) return;
  const entries = loadActivity(address);
  const index = entries.findIndex((e) => e.id === id);
  if (index < 0) return;
  entries[index] = { ...entries[index], ...patch } as ActivityEntry;
  save(address, entries);
}

export function clearActivity(address: string | undefined): void {
  if (!address) return;
  save(address, []);
}

export function explorerTxUrl(hash: string): string {
  return `${ACTIVE_CHAIN.explorerBase}/tx/${hash}`;
}

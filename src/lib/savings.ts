/**
 * Savings targets: a name, an amount to reach, and what you have put toward it.
 *
 * The money itself goes into the same Arc lending vault as Earn, so it earns
 * while it waits and you can take it out whenever you like. A target is a label
 * over that, not a lock — there is no contract holding it hostage, and the app
 * says so rather than implying a commitment it doesn't enforce.
 *
 * Targets live in this browser, per wallet and network, like the activity log.
 * The money is on-chain; the goal you set for it is a note to yourself.
 */
import { readJson, writeJson } from '@/lib/storage';
import { ACTIVE_CHAIN_ID } from '@/chain-env';

export interface SavingsGoal {
  id: string;
  name: string;
  /** What you're saving toward, in whole USDC */
  target: number;
  /** Put in so far, in whole USDC */
  saved: number;
  /** Unix ms, if there's a date in mind */
  due?: number;
  createdAt: number;
}

const listeners = new Set<() => void>();
const EMPTY: SavingsGoal[] = [];
let version = 0;
const cache = new Map<string, { version: number; goals: SavingsGoal[] }>();

const key = (address: string) => `vlora.savings.${ACTIVE_CHAIN_ID}.${address.toLowerCase()}`;

export function loadGoals(address: string | undefined): SavingsGoal[] {
  if (!address) return EMPTY;
  const id = key(address);
  const cached = cache.get(id);
  if (cached && cached.version === version) return cached.goals;
  const goals = readJson<SavingsGoal[]>(id, EMPTY);
  cache.set(id, { version, goals });
  return goals;
}

function save(address: string, goals: SavingsGoal[]): void {
  writeJson(key(address), goals);
  version += 1;
  cache.set(key(address), { version, goals });
  for (const listener of listeners) listener();
}

export function subscribeGoals(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** null when the goal is fine to create, otherwise why not */
export function goalProblem(name: string, target: string, existing: SavingsGoal[]): string | null {
  const trimmed = name.trim();
  if (trimmed.length < 2) return 'Give it a name.';
  if (trimmed.length > 40) return 'That name is too long.';
  if (existing.some((g) => g.name.toLowerCase() === trimmed.toLowerCase())) return `You already have a target called "${trimmed}".`;
  const amount = Number(target);
  if (!Number.isFinite(amount) || amount <= 0) return 'Set an amount to save toward.';
  if (amount > 1_000_000) return 'That target is larger than this app is meant for.';
  return null;
}

export function addGoal(address: string | undefined, name: string, target: number, due?: number): SavingsGoal | null {
  if (!address) return null;
  const goal: SavingsGoal = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name: name.trim(),
    target,
    saved: 0,
    ...(due ? { due } : {}),
    createdAt: Date.now(),
  };
  save(address, [goal, ...loadGoals(address)]);
  return goal;
}

export function removeGoal(address: string | undefined, id: string): void {
  if (!address) return;
  save(
    address,
    loadGoals(address).filter((g) => g.id !== id),
  );
}

/** Record money moved in or out of a goal. Never takes a goal below zero. */
export function adjustGoal(address: string | undefined, id: string, delta: number): void {
  if (!address) return;
  const goals = loadGoals(address).map((goal) =>
    goal.id === id ? { ...goal, saved: Math.max(0, Number((goal.saved + delta).toFixed(6))) } : goal,
  );
  save(address, goals);
}

export interface GoalProgress {
  /** 0–1, capped: 150% of a target is still a full bar */
  fraction: number;
  remaining: number;
  done: boolean;
  /** What a day needs to look like to make the date, when there is one */
  perDay: number | null;
  daysLeft: number | null;
}

export function progressOf(goal: SavingsGoal, now = Date.now()): GoalProgress {
  const fraction = goal.target > 0 ? Math.min(1, goal.saved / goal.target) : 0;
  const remaining = Math.max(0, Number((goal.target - goal.saved).toFixed(6)));
  const done = remaining === 0;
  if (!goal.due || done) return { fraction, remaining, done, perDay: null, daysLeft: null };
  const daysLeft = Math.max(0, Math.ceil((goal.due - now) / 86_400_000));
  return { fraction, remaining, done, perDay: daysLeft > 0 ? remaining / daysLeft : remaining, daysLeft };
}

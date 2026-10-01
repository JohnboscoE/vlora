import { describe, expect, it } from 'vitest';
import { addGoal, adjustGoal, goalProblem, loadGoals, progressOf, reconcileGoals, type SavingsGoal } from './savings';

const goal = (over: Partial<SavingsGoal> = {}): SavingsGoal => ({
  id: 'g1',
  name: 'Rent',
  target: 100,
  saved: 0,
  createdAt: 0,
  ...over,
});

describe('goalProblem', () => {
  it('accepts a name and an amount', () => {
    expect(goalProblem('Rent', '100', [])).toBeNull();
  });

  it('wants a name worth having', () => {
    expect(goalProblem('', '100', [])).toMatch(/name/i);
    expect(goalProblem('R', '100', [])).toMatch(/name/i);
    expect(goalProblem('x'.repeat(41), '100', [])).toMatch(/too long/i);
  });

  it('refuses a second target with the same name', () => {
    expect(goalProblem('rent', '50', [goal()])).toMatch(/already have/i);
  });

  it('wants a real amount', () => {
    for (const bad of ['', '0', '-5', 'lots']) expect(goalProblem('Rent', bad, [])).toMatch(/amount/i);
  });
});

describe('progressOf', () => {
  it('reports how far along a target is', () => {
    expect(progressOf(goal({ saved: 25 }))).toMatchObject({ fraction: 0.25, remaining: 75, done: false });
  });

  it('counts a reached target as done', () => {
    expect(progressOf(goal({ saved: 100 }))).toMatchObject({ fraction: 1, remaining: 0, done: true });
  });

  it('keeps a full bar at full when someone oversaves', () => {
    const over = progressOf(goal({ saved: 150 }));
    expect(over.fraction).toBe(1);
    expect(over.remaining).toBe(0);
  });

  it('works out what a day needs to look like to make the date', () => {
    const now = Date.UTC(2026, 0, 1);
    const due = now + 10 * 86_400_000;
    const p = progressOf(goal({ saved: 50, due }), now);
    expect(p.daysLeft).toBe(10);
    expect(p.perDay).toBe(5);
  });

  it('has no daily figure without a date, or once it is met', () => {
    expect(progressOf(goal({ saved: 10 })).perDay).toBeNull();
    expect(progressOf(goal({ saved: 100, due: Date.now() + 86_400_000 })).perDay).toBeNull();
  });

  it('does not divide by a day that has passed', () => {
    const now = Date.UTC(2026, 0, 10);
    const p = progressOf(goal({ saved: 40, due: Date.UTC(2026, 0, 9) }), now);
    expect(p.daysLeft).toBe(0);
    expect(p.perDay).toBe(60);
  });
});

describe('reconcileGoals', () => {
  /** A fresh wallet per test: the goal store is keyed by address */
  let n = 0;
  const wallet = () => `0x${(++n).toString(16).padStart(40, '0')}`;

  /** Two targets holding 30 and 70 USDC against the shared vault */
  const withSaved = (address: string) => {
    const a = addGoal(address, 'Rent', 100)!;
    const b = addGoal(address, 'Laptop', 500)!;
    adjustGoal(address, a.id, 30);
    adjustGoal(address, b.id, 70);
    return { a, b };
  };

  const savedOf = (address: string) =>
    Object.fromEntries(loadGoals(address).map((g) => [g.name, g.saved]));

  it('leaves the targets alone when the vault holds what they claim', () => {
    const address = wallet();
    withSaved(address);
    expect(reconcileGoals(address, 100)).toBe(0);
    expect(savedOf(address)).toEqual({ Rent: 30, Laptop: 70 });
  });

  it('leaves a surplus alone: earnings grow the vault past the notes', () => {
    const address = wallet();
    withSaved(address);
    expect(reconcileGoals(address, 140)).toBe(0);
    expect(savedOf(address)).toEqual({ Rent: 30, Laptop: 70 });
  });

  it('trims proportionally when money left the vault somewhere else', () => {
    const address = wallet();
    withSaved(address);
    expect(reconcileGoals(address, 50)).toBe(50);
    expect(savedOf(address)).toEqual({ Rent: 15, Laptop: 35 });
  });

  it('empties the targets when the vault is empty', () => {
    const address = wallet();
    withSaved(address);
    expect(reconcileGoals(address, 0)).toBe(100);
    expect(savedOf(address)).toEqual({ Rent: 0, Laptop: 0 });
  });

  it('does nothing without an address, or on a balance it cannot trust', () => {
    const address = wallet();
    withSaved(address);
    expect(reconcileGoals(undefined, 0)).toBe(0);
    expect(reconcileGoals(address, Number.NaN)).toBe(0);
    expect(reconcileGoals(address, -1)).toBe(0);
    expect(savedOf(address)).toEqual({ Rent: 30, Laptop: 70 });
  });

  it('ignores rounding dust rather than rewriting every target over it', () => {
    const address = wallet();
    withSaved(address);
    expect(reconcileGoals(address, 99.9999995)).toBe(0);
  });

  it('has nothing to do when no target holds anything', () => {
    const address = wallet();
    addGoal(address, 'Rent', 100);
    expect(reconcileGoals(address, 0)).toBe(0);
  });
});

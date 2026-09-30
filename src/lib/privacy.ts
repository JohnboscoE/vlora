import { useSyncExternalStore } from 'react';

const KEY = 'vlora.balances.hidden';
const listeners = new Set<() => void>();

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    // Private windows and blocked site data throw on access; showing the balance
    // is the honest default when we can't remember a preference
    return false;
  }
}

/**
 * Whether balances are hidden.
 *
 * A preference, not a secret: it hides figures from whoever is stood behind you
 * on a bus, which is the whole job. It is per-browser, survives a reload, and
 * every balance in the app reads the same switch so they never disagree.
 */
export function useBalancesHidden(): boolean {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    read,
    () => false,
  );
}

export function toggleBalancesHidden(): void {
  const next = !read();
  try {
    localStorage.setItem(KEY, next ? '1' : '0');
  } catch {
    // Nothing to persist to — the toggle still works for this session
  }
  for (const fn of listeners) fn();
}

/** The stand-in for a figure that is currently hidden */
export const HIDDEN = '••••';

import type { BatchItem } from '../utils/intentParser';

// Pure contact/template logic (no React, no storage) so it can be unit-tested directly.

export interface Contact {
  name: string;
  address: `0x${string}`;
}

export interface SavedBatch {
  name: string;
  items: BatchItem[];
}

// Words that already mean something in a command can't be contact names
const RESERVED = new Set([
  'usdc', 'eurc', 'eth', 'each', 'and', 'to', 'send', 'pay', 'transfer', 'move', 'me', 'my', 'all',
  'swap', 'balance', 'help', 'request', 'save', 'add', 'contact', 'contacts', 'batch', 'the',
]);

export const CONTACT_NAME_RE = /^[a-z][a-z0-9_-]{1,23}$/i;

export function contactNameProblem(name: string): string | null {
  if (!CONTACT_NAME_RE.test(name)) return 'Contact names are 2–24 letters, numbers, - or _, starting with a letter.';
  if (RESERVED.has(name.toLowerCase())) return `"${name}" is a command word, so it can't be a contact name.`;
  return null;
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Replaces contact names with their addresses where a recipient is expected:
 * after "to"/"pay"/"and", after a comma/semicolon/newline, at the start of the
 * message, or written as @name. "send 10 to alice, 20 to bob" → addresses.
 */
export function resolveContacts(text: string, contacts: Contact[]): string {
  let out = text;
  // Longest names first so "alice-work" wins over "alice"
  for (const c of [...contacts].sort((a, b) => b.name.length - a.name.length)) {
    const name = escapeRe(c.name);
    const re = new RegExp(`(?<=^|\\bto\\s+|\\bpay\\s+|\\band\\s+|[,;\\n]\\s*)@?${name}(?![\\w.-])|@${name}(?![\\w.-])`, 'gim');
    out = out.replace(re, c.address);
  }
  return out;
}

export function contactName(address: string, contacts: Contact[]): string | undefined {
  const lower = address.toLowerCase();
  return contacts.find((c) => c.address.toLowerCase() === lower)?.name;
}

/** A saved batch as composer text: one "address amount" line per recipient */
export function batchToCommand(batch: SavedBatch, contacts: Contact[]): string {
  return batch.items.map((i) => `${contactName(i.recipient, contacts) ?? i.recipient} ${i.amount}`).join('\n');
}

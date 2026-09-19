import { isAddress } from 'viem';

export interface PaymentRequest {
  to: `0x${string}`;
  amount: string;
}

const AMOUNT_RE = /^\d+(\.\d{1,6})?$/;

// Hash-routed so it works on any static host: <origin>/#/app?to=0x…&amount=25
export function buildPaymentLink(to: string, amount: string): string {
  const params = new URLSearchParams({ to, amount });
  return `${window.location.origin}${window.location.pathname}#/app?${params.toString()}`;
}

/** Reads a request from the current URL. Invalid or partial links are ignored. */
export function readPaymentRequest(): PaymentRequest | null {
  const hash = window.location.hash;
  const q = hash.indexOf('?');
  if (q === -1) return null;
  const params = new URLSearchParams(hash.slice(q + 1));
  const to = params.get('to') ?? '';
  const amount = params.get('amount') ?? '';
  if (!isAddress(to) || !AMOUNT_RE.test(amount) || Number(amount) <= 0) return null;
  return { to, amount };
}

/** Drop the query so a reload doesn't replay the request */
export function clearPaymentRequest(): void {
  const hash = window.location.hash;
  const q = hash.indexOf('?');
  if (q === -1) return;
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${hash.slice(0, q)}`);
}

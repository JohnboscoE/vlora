/**
 * Cash out: USDC → a bank account in local currency, via Paycrest (server/offramp.ts).
 *
 * The route Paycrest settles on is Base, not Arc, so a cash-out is two moves:
 * create the order, then bridge exactly what it asks for to its receive address
 * (src/lib/bridge.ts). The user signs once, on Arc. This is temporary — when
 * Paycrest lists Arc the bridge step disappears.
 */

export interface OfframpCurrency {
  code: string;
  name: string;
  shortName: string;
  symbol: string;
  decimals: number;
  marketSellRate?: string;
}

export interface OfframpInfo {
  enabled: boolean;
  reason?: string;
  network: string;
  token: string;
  minUsdc: number;
  maxUsdc: number;
  currencies: OfframpCurrency[];
}

export interface Institution {
  name: string;
  code: string;
  type: string;
}

export interface OfframpQuote {
  /** Local currency per 1 USDC */
  rate: string;
  providerIds: string[];
  currency: string;
  amount: string;
}

export interface OfframpOrder {
  id: string;
  status: string;
  amount: string;
  rate: string;
  senderFee?: string;
  transactionFee?: string;
  providerAccount: {
    network: string;
    receiveAddress: string;
    amountToTransfer?: string;
    validUntil?: string;
    currency?: string;
  };
  destination?: { currency?: string; recipient?: { accountIdentifier?: string; accountName?: string; institution?: string } };
  txHash?: string;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/offramp/${path}`, init);
  const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok || !body) throw new Error(body?.error ?? `Request failed (${res.status})`);
  return body;
}

export const fetchOfframpInfo = () => call<OfframpInfo>('info');

export const fetchInstitutions = (currency: string) =>
  call<{ institutions: Institution[] }>(`institutions?currency=${encodeURIComponent(currency)}`).then((r) => r.institutions);

export const fetchOfframpQuote = (amount: string, currency: string) =>
  call<OfframpQuote>(`rate?amount=${encodeURIComponent(amount)}&currency=${encodeURIComponent(currency)}`);

export const verifyAccount = (institution: string, accountIdentifier: string) =>
  call<{ accountName: string }>('verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ institution, accountIdentifier }),
  }).then((r) => r.accountName);

export interface CreateOrderInput {
  amount: string;
  currency: string;
  institution: string;
  accountIdentifier: string;
  accountName: string;
  memo?: string;
  /** Where Paycrest refunds if no provider fills the order — on Base, so the user's own address */
  refundAddress: string;
  providerIds?: string[];
}

export const createOfframpOrder = (input: CreateOrderInput) =>
  call<{ order: OfframpOrder }>('orders', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  }).then((r) => r.order);

export const fetchOfframpOrder = (id: string) =>
  call<{ order: OfframpOrder }>(`order?id=${encodeURIComponent(id)}`).then((r) => r.order);

/** Exactly what has to reach the receive address: the payout plus both fees */
export function orderTotal(order: OfframpOrder): string {
  const total = Number(order.amount) + Number(order.senderFee ?? 0) + Number(order.transactionFee ?? 0);
  return total.toFixed(6).replace(/\.?0+$/, '');
}

/** Order statuses, in the order they happen, as plain English */
export function describeOrderStatus(status: string): string {
  switch (status) {
    case 'initiated':
      return 'Waiting for your USDC to arrive';
    case 'pending':
      return 'Matching a payout provider';
    case 'processing':
    case 'validated':
      return 'Paying your bank';
    case 'settled':
      return 'Paid';
    case 'refunded':
      return 'Refunded — the payout could not be completed';
    case 'expired':
      return 'Expired before the deposit arrived';
    default:
      return status;
  }
}

export const isFinalStatus = (status: string) => ['settled', 'refunded', 'expired'].includes(status);

export interface DepositOrder {
  id: string;
  status: string;
  amount: string;
  rate?: string;
  /** The virtual bank account to pay into */
  providerAccount: {
    accountIdentifier?: string;
    accountName?: string;
    institution?: string;
    bankName?: string;
    amountToTransfer?: string;
    currency?: string;
    memo?: string;
    validUntil?: string;
  };
}

export interface CreateDepositInput {
  /** How much to pay in, in local currency */
  amount: string;
  currency: string;
  /** Where the USDC is released — the user's own address, on Paycrest's network */
  recipient: string;
  /** The bank account being paid from, which is also where a refund would go */
  institution: string;
  accountIdentifier: string;
  accountName: string;
}

/** Buy USDC with a bank transfer. Settles on Base: Paycrest has no Arc yet. */
export const createDeposit = (input: CreateDepositInput) =>
  call<{ order: DepositOrder }>('deposits', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  }).then((r) => r.order);

export function describeDepositStatus(status: string): string {
  switch (status) {
    case 'initiated':
      return 'Waiting for your transfer';
    case 'pending':
    case 'processing':
      return 'Transfer seen, releasing USDC';
    case 'validated':
      return 'Releasing your USDC';
    case 'settled':
      return 'Sent to your wallet';
    case 'refunded':
      return 'Refunded to your bank account';
    case 'expired':
      return 'Expired before the transfer arrived';
    default:
      return status;
  }
}

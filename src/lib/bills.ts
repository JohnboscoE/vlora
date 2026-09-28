/**
 * Bills: airtime, data, electricity and TV, bought with USDC through Bitrefill
 * (server/bills.ts).
 *
 * Bitrefill prices the invoice in USDC on Base and delivers to the phone number
 * or meter itself. Paying it is the same move as a cash-out: bridge exactly the
 * invoice price to its address, signing once on Arc (src/lib/bridge.ts).
 */

export type BillCategory = 'airtime' | 'data' | 'electricity' | 'tv' | 'exams';

export const BILL_CATEGORY_LABELS: Record<BillCategory, string> = {
  airtime: 'Airtime',
  data: 'Data',
  electricity: 'Electricity',
  tv: 'TV',
  exams: 'Exam PINs',
};

export interface BillsInfo {
  enabled: boolean;
  reason?: string;
  network: string;
  maxUsdc: number;
  categories: string[];
}

export interface BillProduct {
  id: string;
  name: string;
  country: string;
  currency: string;
  image?: string;
  inStock: boolean;
  /** What Bitrefill needs from the user for this product */
  recipientType: string;
  packages: { id: string; value: string; price?: number }[];
  range?: { min: number; max: number; step: number };
}

export interface BillPayment {
  address: string;
  price: string;
  currency: string;
}

export interface BillInvoice {
  id: string;
  status: string;
  payment?: { method?: string; address?: string; price?: number; currency?: string; status?: string };
  orders?: { id: string; status: string; product?: { name?: string; value?: string } }[];
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/bills/${path}`, init);
  const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok || !body) throw new Error(body?.error ?? `Request failed (${res.status})`);
  return body;
}

export const fetchBillsInfo = () => call<BillsInfo>('info');

export const fetchBillProducts = (category: BillCategory, country: string) =>
  call<{ products: BillProduct[] }>(`products?category=${category}&country=${encodeURIComponent(country)}`).then((r) => r.products);

export const fetchBillProduct = (id: string) => call<{ product: BillProduct }>(`product?id=${encodeURIComponent(id)}`).then((r) => r.product);

export interface CreateInvoiceInput {
  productId: string;
  packageId?: string;
  value?: string;
  /** Phone number as typed, or the meter/account number */
  recipient: string;
  /** Where Bitrefill refunds if delivery fails — on Base, so the user's own address */
  refundAddress: string;
  /** Two-letter country, so a local phone number can be given its dial code */
  country?: string;
  /** True for airtime and data: the server adds the dial code to a phone line */
  phone?: boolean;
}

export const createBillInvoice = (input: CreateInvoiceInput) =>
  call<{ invoice: BillInvoice; payment: BillPayment; id: string }>('invoices', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });

/** Which networks serve a phone number, so a top-up doesn't have to ask */
export const fetchPhoneOperators = (number: string, country = 'NG') =>
  call<{ number: string; operators: { id: string; name: string }[] }>(
    `phone?number=${encodeURIComponent(number)}&country=${encodeURIComponent(country)}`,
  ).then((r) => r.operators);

export const fetchBillInvoice = (id: string) =>
  call<{ invoice: BillInvoice }>(`invoice?id=${encodeURIComponent(id)}`).then((r) => r.invoice);

/**
 * What to bridge for an invoice: the price, rounded **up** to USDC's 6 decimals.
 * Underpaying leaves the invoice unpaid, so the rounding never goes down.
 */
export function amountToPay(price: string): string {
  const value = Number(price);
  if (!Number.isFinite(value) || value <= 0) throw new Error('That invoice has no price.');
  return (Math.ceil(value * 1e6) / 1e6).toFixed(6).replace(/\.?0+$/, '');
}

export function describeInvoiceStatus(status: string): string {
  switch (status) {
    case 'unpaid':
      return 'Waiting for your USDC';
    case 'payment_detected':
      return 'Payment seen, confirming';
    case 'payment_confirmed':
      return 'Payment confirmed';
    case 'pending':
      return 'Delivering';
    case 'complete':
      return 'Delivered';
    case 'blocked':
    case 'denied':
      return 'Rejected by Bitrefill';
    case 'payment_error':
      return 'Payment error — Bitrefill refunds to your address on Base';
    default:
      return status;
  }
}

export const isFinalInvoiceStatus = (status: string) => ['complete', 'blocked', 'denied', 'payment_error'].includes(status);

/** The label for the field a product needs, from Bitrefill's recipient_type */
export function recipientLabel(product: BillProduct | null, category: BillCategory): string {
  const type = product?.recipientType ?? '';
  if (type.includes('phone') || category === 'airtime' || category === 'data') return 'Phone number';
  if (type.includes('meter')) return 'Meter number';
  if (type.includes('email')) return 'Email address';
  if (category === 'electricity') return 'Meter number';
  if (category === 'tv') return 'Smartcard or IUC number';
  if (category === 'exams') return 'Phone number for the PIN';
  return 'Account number';
}

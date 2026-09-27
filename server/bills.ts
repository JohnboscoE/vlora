// Bills: airtime, data, electricity and TV paid with USDC, through Bitrefill
// (https://docs.bitrefill.com). Bitrefill quotes an invoice in USDC on Base and
// delivers to the phone number or meter itself; the app pays the invoice by
// bridging from Arc (src/lib/bridge.ts), so the user signs once, on Arc.
//
// This server holds the API key, caches the catalogue (Bitrefill asks for that,
// and their limits are tight), and checks what comes back before the app sends
// money anywhere. It never touches funds.
//
// Env: BITREFILL_API_KEY (from bitrefill.com/account/developers), optional
// BILLS_MAX_USDC (per-invoice ceiling, default 100). Unset key → the panel says
// bills aren't switched on.
import { isAddress } from 'viem';
import { CHAIN_ID } from './chain';

export type BillsRoute = 'info' | 'products' | 'product' | 'invoices' | 'invoice' | 'phone';

const API = 'https://api.bitrefill.com/v2';
/** The only payment method we use: USDC on Base, an ordinary transfer to an address */
const PAYMENT_METHOD = 'usdc_base';
const DEFAULT_MAX_USDC = 100;

/**
 * What each tab in the app asks for. Bitrefill's categories are inconsistently
 * cased and overlapping, so each of ours maps to several of theirs.
 */
const CATEGORIES: Record<string, string> = {
  airtime: 'refill,Minutes,phone,Mobile',
  data: 'data,Data,bundles',
  electricity: 'Electricity,utility-bills,utility-bill,Utility',
  tv: 'TV,dth,streaming',
  bills: 'bills,bill,utility-bills,utility-bill,Utility,Electricity,TV,dth',
};

function env(name: string): string {
  return (process.env[name] ?? '').trim().replace(/^["']|["']$/g, '').trim();
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

const json = (status: number, body: unknown) => Response.json(body, { status });

export function maxUsdc(): number {
  const configured = Number(env('BILLS_MAX_USDC'));
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MAX_USDC;
}

/** null = ready; otherwise why bills are off (never includes the key) */
function configProblem(): string | null {
  if (CHAIN_ID !== 5042) return 'Bitrefill takes USDC on Base, so bills only work on the mainnet build';
  if (!env('BITREFILL_API_KEY')) return 'BITREFILL_API_KEY is not set';
  return null;
}

// Best-effort per-instance limits, well inside Bitrefill's own (60/min on the
// catalogue, 60 per 10 minutes on a single invoice).
const recent = new Map<string, number[]>();
const RATE_WINDOW_MS = 60_000;
const RATE_MAX: Record<string, number> = { products: 40, product: 40, invoices: 10, invoice: 40, phone: 10 };

function rateLimited(route: string): boolean {
  const now = Date.now();
  const hits = (recent.get(route) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  hits.push(now);
  recent.set(route, hits);
  return hits.length > (RATE_MAX[route] ?? 40);
}

// Bitrefill asks integrators to cache the catalogue rather than fetch per user.
const CACHE_MS = 10 * 60_000;
const catalogue = new Map<string, { at: number; body: unknown }>();

interface Envelope {
  data?: unknown;
  meta?: unknown;
  message?: string;
  error?: string;
}

async function bitrefill(path: string, init?: RequestInit): Promise<{ status: number; body: Envelope }> {
  const headers = new Headers(init?.headers);
  headers.set('accept', 'application/json');
  headers.set('authorization', `Bearer ${env('BITREFILL_API_KEY')}`);
  if (init?.body) headers.set('content-type', 'application/json');
  const res = await fetch(`${API}${path}`, { ...init, headers });
  const body = (await res.json().catch(() => ({}))) as Envelope;
  return { status: res.status, body };
}

/** Bitrefill's error text, never the raw payload */
function problemText(body: Envelope, status: number): string {
  return str(body.message) || str(body.error) || `Bitrefill returned ${status}`;
}

const PRODUCT_ID = /^[A-Za-z0-9][\w.-]{1,80}$/;
const INVOICE_ID = /^[A-Za-z0-9-]{8,64}$/;
// Phone numbers in E.164, and the meter, smartcard or account numbers a biller
// expects: digits, optionally led by "+", and dashes only inside a local number
const RECIPIENT = /^(\+\d{6,20}|\d[\d-]{3,31})$/;
const VALUE = /^\d{1,9}(\.\d{1,2})?$/;

export interface BillProduct {
  id: string;
  name: string;
  country: string;
  currency: string;
  image?: string;
  inStock: boolean;
  /** What the product needs from the user: "phone_number", "meter_number", "none"… */
  recipientType: string;
  packages: { id: string; value: string; price?: number }[];
  range?: { min: number; max: number; step: number };
}

/** Bitrefill's product shape, reduced to what the panel needs */
function toProduct(raw: unknown): BillProduct | null {
  const p = raw as Record<string, unknown> | null;
  const id = str(p?.id);
  if (!id) return null;
  const packages = Array.isArray(p?.packages) ? p.packages : [];
  const range = p?.range as { min?: number; max?: number; step?: number } | undefined;
  return {
    id,
    name: str(p?.name) || id,
    country: str(p?.country_code) || str(p?.country),
    currency: str(p?.currency),
    image: str(p?.image) || undefined,
    inStock: p?.in_stock !== false,
    recipientType: str(p?.recipient_type),
    packages: packages
      .map((pkg) => {
        const o = pkg as Record<string, unknown>;
        return { id: str(o.id) || str(o.package_id), value: String(o.value ?? ''), price: typeof o.price === 'number' ? o.price : undefined };
      })
      .filter((pkg) => pkg.id !== ''),
    ...(range && typeof range.min === 'number' && typeof range.max === 'number'
      ? { range: { min: range.min, max: range.max, step: typeof range.step === 'number' ? range.step : 1 } }
      : {}),
  };
}

export interface InvoiceRequest {
  productId: string;
  packageId?: string;
  value?: string;
  recipient: string;
  refundAddress: string;
}

/**
 * What the server insists on before it will create an invoice. Kept separate from
 * the route so it can be tested on its own: this is the part that decides what
 * gets bought and for whom.
 */
export function invoiceProblem(payload: Record<string, unknown> | null): { problem: string } | { invoice: InvoiceRequest } {
  const productId = str(payload?.productId).trim();
  const packageId = str(payload?.packageId).trim();
  const value = str(payload?.value).trim();
  // People paste "+234 (801) 234-5678"; E.164 keeps none of that punctuation
  const typed = str(payload?.recipient).trim();
  const recipient = typed.startsWith('+') ? typed.replace(/[\s()-]/g, '') : typed.replace(/[\s()]/g, '');
  const refundAddress = str(payload?.refundAddress).trim();

  if (!PRODUCT_ID.test(productId)) return { problem: 'Pick something to pay for.' };
  if (!packageId && !value) return { problem: 'Pick an amount.' };
  if (value && !VALUE.test(value)) return { problem: 'That amount is not a number we can use.' };
  if (packageId && !packageId.startsWith(productId)) return { problem: 'That amount does not belong to this product.' };
  if (!RECIPIENT.test(recipient)) return { problem: 'Check the phone or meter number.' };
  // A crypto invoice needs somewhere to send a refund if delivery fails
  if (!isAddress(refundAddress)) return { problem: 'A refund address is required.' };
  return { invoice: { productId, ...(packageId ? { packageId } : {}), ...(value ? { value } : {}), recipient, refundAddress } };
}

export interface BillPayment {
  /** Where to send the USDC, on Base */
  address: string;
  /** How much, in whole USDC */
  price: string;
  currency: string;
}

/**
 * The payment instructions an invoice must carry before the app sends anything:
 * USDC, to a real address, for no more than the ceiling.
 */
export function paymentProblem(invoice: unknown, max = maxUsdc()): { problem: string } | { payment: BillPayment; id: string } {
  const data = invoice as { id?: unknown; payment?: Record<string, unknown> } | null;
  const id = str(data?.id);
  const payment = data?.payment;
  const address = str(payment?.address);
  const price = Number(payment?.price);
  const currency = str(payment?.currency).toUpperCase();

  // Say what Bitrefill actually sent, so a refusal is diagnosable instead of mysterious
  const quoted = `${str(payment?.price) || String(payment?.price ?? '?')} ${currency || '(no currency)'} by ${str(payment?.method) || 'unknown method'}`;

  if (!id) return { problem: 'the invoice has no id' };
  if (!isAddress(address)) return { problem: 'the payment address is not an address' };
  if (!Number.isFinite(price) || price <= 0) return { problem: `the invoice has no usable price (${quoted})` };
  // Currency first: a price in the wrong unit reads as an absurd amount, and
  // knowing which unit it is beats being told the number is too big
  if (currency && currency !== 'USDC') return { problem: `the invoice is priced in ${quoted}, not USDC` };
  if (price > max) return { problem: `the invoice asks for ${quoted}, above the ${max} USDC limit` };
  return { id, payment: { address, price: String(payment?.price), currency: currency || 'USDC' } };
}

/** Products for a category and country, straight from Bitrefill (cached) */
export async function billProducts(category: string, country: string): Promise<BillProduct[]> {
  const categories = CATEGORIES[category];
  if (!categories) throw new Error(`unknown category "${category}"`);
  const key = `${country}:${categories}`;
  const hit = catalogue.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return (hit.body as { products: BillProduct[] }).products;
  const { status, body } = await bitrefill(`/products?country=${country}&category=${encodeURIComponent(categories)}&limit=50`);
  if (status !== 200) throw new Error(problemText(body, status));
  const products = (Array.isArray(body.data) ? body.data : [])
    .map(toProduct)
    .filter((p): p is BillProduct => p != null && p.inStock)
    .sort((a, b) => a.name.localeCompare(b.name));
  catalogue.set(key, { at: Date.now(), body: { products } });
  return products;
}

/** The networks that serve a phone number, so a top-up needn't ask which it is */
export async function phoneOperators(number: string): Promise<{ id: string; name: string }[]> {
  const { status, body } = await bitrefill(`/check_phone_number?phone_number=${encodeURIComponent(number)}`);
  if (status !== 200) return [];
  const data = body.data;
  const list = Array.isArray(data) ? data : data ? [data] : [];
  return list
    .map((o) => {
      const row = o as Record<string, unknown>;
      return { id: str(row.id), name: str(row.name) || str(row.id) };
    })
    .filter((o) => o.id !== '');
}

/**
 * Create an invoice and check the payment instructions before handing them back.
 * Shared by the route the app calls and by the agent's pay_bill tool.
 */
export async function createInvoice(
  request: InvoiceRequest,
): Promise<{ problem: string; status: number } | { id: string; payment: BillPayment; invoice: unknown }> {
  const { status, body } = await bitrefill('/invoices', {
    method: 'POST',
    body: JSON.stringify({
      products: [
        {
          product_id: request.productId,
          quantity: 1,
          ...(request.packageId ? { package_id: request.packageId } : {}),
          ...(request.value ? { value: Number(request.value) } : {}),
          // Bitrefill uses this field for the phone number and for the account or
          // meter number of a biller that needs one
          phone_number: request.recipient,
        },
      ],
      payment_method: PAYMENT_METHOD,
      refund_address: request.refundAddress,
    }),
  });
  if (status !== 200 && status !== 201) {
    console.error('[bills] invoice failed', status, body.message ?? body.error);
    return { problem: problemText(body, status), status: status === 401 || status === 403 ? 503 : 400 };
  }
  // Log the payment block verbatim: it decides what gets paid, and its units have
  // to be read from what Bitrefill sends rather than assumed
  const raw = (body.data as { payment?: unknown } | undefined)?.payment;
  console.info('[bills] invoice payment', JSON.stringify(raw));
  // The invoice says where the money goes, so check it before anything is paid
  const verdict = paymentProblem(body.data);
  if ('problem' in verdict) {
    console.error(`[bills] unusable invoice: ${verdict.problem}`);
    return { problem: `Bitrefill returned an invoice we could not verify (${verdict.problem}). Nothing was sent.`, status: 502 };
  }
  return { id: verdict.id, payment: verdict.payment, invoice: body.data };
}

export async function handleBills(route: BillsRoute, request: Request): Promise<Response> {
  const url = new URL(request.url);
  const problem = configProblem();

  if (route === 'info') {
    return json(200, {
      enabled: problem == null,
      ...(problem ? { reason: problem } : {}),
      network: 'base',
      maxUsdc: maxUsdc(),
      categories: Object.keys(CATEGORIES),
    });
  }

  if (problem) {
    if (route === 'invoices') console.error(`[bills] not configured: ${problem}`);
    return json(503, { error: 'Bill payments are not configured on this server.' });
  }
  if (rateLimited(route)) return json(429, { error: 'Too many requests — try again in a minute.' });

  if (route === 'products') {
    const category = CATEGORIES[str(url.searchParams.get('category'))];
    const country = str(url.searchParams.get('country')).toUpperCase();
    if (!category) return json(400, { error: 'unknown category' });
    if (!/^[A-Z]{2}$/.test(country)) return json(400, { error: 'country must be a 2-letter code' });

    const key = `${country}:${category}`;
    const hit = catalogue.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return json(200, hit.body);

    const { status, body } = await bitrefill(`/products?country=${country}&category=${encodeURIComponent(category)}&limit=50`);
    if (status !== 200) return json(status === 401 ? 503 : 502, { error: problemText(body, status) });
    const products = (Array.isArray(body.data) ? body.data : [])
      .map(toProduct)
      .filter((p): p is BillProduct => p != null && p.inStock)
      .sort((a, b) => a.name.localeCompare(b.name));
    const payload = { products };
    catalogue.set(key, { at: Date.now(), body: payload });
    return json(200, payload);
  }

  if (route === 'product') {
    const id = str(url.searchParams.get('id'));
    if (!PRODUCT_ID.test(id)) return json(400, { error: 'bad product id' });
    const { status, body } = await bitrefill(`/products/${encodeURIComponent(id)}`);
    const product = toProduct(body.data);
    if (status !== 200 || !product) return json(502, { error: problemText(body, status) });
    return json(200, { product });
  }

  if (route === 'phone') {
    const number = str(url.searchParams.get('number')).replace(/[\s()-]/g, '');
    if (!/^\+?\d{7,15}$/.test(number)) return json(400, { error: 'that does not look like a phone number' });
    const { status, body } = await bitrefill(`/check_phone_number?phone_number=${encodeURIComponent(number)}`);
    if (status !== 200) return json(status === 429 ? 429 : 502, { error: problemText(body, status) });
    // `data` is the operator's product, or several when the number is ambiguous
    const data = body.data;
    const list = Array.isArray(data) ? data : data ? [data] : [];
    const operators = list
      .map((o) => {
        const row = o as Record<string, unknown>;
        return { id: str(row.id), name: str(row.name) || str(row.id) };
      })
      .filter((o) => o.id !== '');
    const meta = body.meta as { phone_number?: unknown } | undefined;
    return json(200, { number: str(meta?.phone_number) || number, operators });
  }

  if (route === 'invoice') {
    const id = str(url.searchParams.get('id'));
    if (!INVOICE_ID.test(id)) return json(400, { error: 'bad invoice id' });
    const { status, body } = await bitrefill(`/invoices/${encodeURIComponent(id)}`);
    if (status !== 200) return json(502, { error: problemText(body, status) });
    return json(200, { invoice: body.data });
  }

  if (request.method !== 'POST') return json(405, { error: 'method not allowed' });
  const payload = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const checked = invoiceProblem(payload);
  if ('problem' in checked) return json(400, { error: checked.problem });

  const created = await createInvoice(checked.invoice);
  if ('problem' in created) return json(created.status, { error: created.problem });
  return json(201, { invoice: created.invoice, payment: created.payment, id: created.id });
}

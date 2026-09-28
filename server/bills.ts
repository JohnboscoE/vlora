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

export type BillsRoute = 'info' | 'products' | 'product' | 'invoices' | 'invoice' | 'phone' | 'preflight';

const API = 'https://api.bitrefill.com/v2';
/** The only payment method we use: USDC on Base, an ordinary transfer to an address */
const PAYMENT_METHOD = 'usdc_base';
const DEFAULT_MAX_USDC = 100;

/**
 * What each tab in the app asks for. Bitrefill's categories are inconsistently
 * cased and overlapping, so each of ours maps to several of theirs.
 */
const CATEGORIES: Record<string, true> = {
  airtime: true,
  data: true,
  electricity: true,
  tv: true,
  exams: true,
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
const RATE_MAX: Record<string, number> = { products: 40, product: 40, invoices: 10, invoice: 40, phone: 10, preflight: 6 };

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
  /** What the product needs from the user: "phone_number", "account", "none"… */
  recipientType: string;
  /** Bitrefill's own type: phone_refill, bill_payment, gift_card, esim */
  type: string;
  packages: { id: string; value: string; price?: number }[];
  range?: { min: number; max: number; step: number; priceRate?: number };
}

/** Bitrefill's product shape, reduced to what the panel needs */
function toProduct(raw: unknown): BillProduct | null {
  const p = raw as Record<string, unknown> | null;
  const id = str(p?.id);
  if (!id) return null;
  const packages = Array.isArray(p?.packages) ? p.packages : [];
  const range = p?.range as { min?: number; max?: number; step?: number; price_rate?: number } | undefined;
  return {
    id,
    name: str(p?.name) || id,
    country: str(p?.country_code) || str(p?.country),
    currency: str(p?.currency),
    image: str(p?.image) || undefined,
    inStock: p?.in_stock !== false,
    recipientType: str(p?.recipient_type),
    type: str(p?.type),
    packages: packages
      .map((pkg) => {
        const o = pkg as Record<string, unknown>;
        return { id: str(o.id) || str(o.package_id), value: String(o.value ?? ''), price: typeof o.price === 'number' ? o.price : undefined };
      })
      .filter((pkg) => pkg.id !== ''),
    ...(range && typeof range.min === 'number' && typeof range.max === 'number'
      ? {
          range: {
            min: range.min,
            max: range.max,
            step: typeof range.step === 'number' ? range.step : 1,
            ...(typeof range.price_rate === 'number' ? { priceRate: range.price_rate } : {}),
          },
        }
      : {}),
  };
}

export interface InvoiceRequest {
  productId: string;
  packageId?: string;
  value?: string;
  recipient: string;
  refundAddress: string;
  /** Two-letter country, so a local phone number can be given its dial code */
  country?: string;
  /** True for airtime and data: the recipient is a phone line, not a meter */
  phone?: boolean;
}

/** Dial codes for the countries the bill catalogue covers */
const DIAL_CODES: Record<string, string> = {
  NG: '234',
  KE: '254',
  GH: '233',
  UG: '256',
  TZ: '255',
  ZA: '27',
  US: '1',
  GB: '44',
};

/**
 * A phone number in the form Bitrefill wants (E.164), from the form people type.
 *
 * Nobody writing their own number types the country code, so "09134829079" with
 * a Nigerian catalogue means +2349134829079. Meter and smartcard numbers are
 * left exactly as given — they are not phone numbers and their leading zero is
 * part of the number.
 */
export function toE164(raw: string, country: string | undefined): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('+')) return trimmed.replace(/[\s()-]/g, '');
  const digits = trimmed.replace(/\D/g, '');
  const code = DIAL_CODES[(country ?? '').toUpperCase()];
  if (!code || digits === '') return trimmed;
  if (digits.startsWith(code) && digits.length > code.length + 6) return `+${digits}`;
  // A local number drops its trunk zero when the dial code goes on
  return `+${code}${digits.replace(/^0+/, '')}`;
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
  // People paste "+234 (801) 234-5678", and type their own number without a
  // country code at all; a phone line gets one added, a meter number never does
  const typed = str(payload?.recipient).trim();
  const country = str(payload?.country).toUpperCase();
  const phone = payload?.phone === true;
  const recipient = phone
    ? toE164(typed, country)
    : typed.startsWith('+')
      ? typed.replace(/[\s()-]/g, '')
      : typed.replace(/[\s()]/g, '');
  const refundAddress = str(payload?.refundAddress).trim();

  if (!PRODUCT_ID.test(productId)) return { problem: 'Pick something to pay for.' };
  if (!packageId && !value) return { problem: 'Pick an amount.' };
  if (value && !VALUE.test(value)) return { problem: 'That amount is not a number we can use.' };
  if (packageId && !packageId.startsWith(productId)) return { problem: 'That amount does not belong to this product.' };
  if (!RECIPIENT.test(recipient)) return { problem: 'Check the phone or meter number.' };
  // A crypto invoice needs somewhere to send a refund if delivery fails
  if (!isAddress(refundAddress)) return { problem: 'A refund address is required.' };
  return {
    invoice: {
      productId,
      ...(packageId ? { packageId } : {}),
      ...(value ? { value } : {}),
      recipient,
      refundAddress,
      ...(country ? { country } : {}),
      ...(phone ? { phone } : {}),
    },
  };
}

export interface BillPayment {
  /** Where to send the USDC, on Base */
  address: string;
  /** How much, in whole USDC */
  price: string;
  currency: string;
}

/**
 * What an invoice's price means in whole USDC.
 *
 * Bitrefill quotes a `usdc_base` invoice in USDC's smallest unit — 80000 for a
 * ~$0.08 top-up, observed on live invoices — while their docs show a Bitcoin
 * invoice as a decimal (0.00123456). So the unit is read from the value rather
 * than assumed: a plain integer of 1000 or more is smallest-unit, anything with
 * a decimal point is already whole USDC. Getting this backwards would underpay
 * an invoice rather than overpay it, and the ceiling bounds it either way.
 */
export function interpretPrice(raw: unknown): { usdc: number; smallestUnit: boolean } | null {
  const text = String(raw ?? '').trim();
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  const value = Number(text);
  if (!Number.isFinite(value) || value <= 0) return null;
  if (text.includes('.')) return { usdc: value, smallestUnit: false };
  return value >= 1000 ? { usdc: value / 1e6, smallestUnit: true } : { usdc: value, smallestUnit: false };
}

/** Live local-currency-per-USDC rate, from Paycrest's public quote (no key needed) */
async function fiatPerUsdc(currency: string): Promise<number | null> {
  try {
    const res = await fetch(`https://api.paycrest.io/v1/rates/USDC/1/${encodeURIComponent(currency)}`, {
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: unknown };
    const rate = Number(body.data);
    return Number.isFinite(rate) && rate > 0 ? rate : null;
  } catch {
    return null;
  }
}

/**
 * Whether `usdc` is a believable price for `fiatAmount` of `currency`, checked
 * against a rate from somewhere other than Bitrefill. Wide on purpose: it is
 * here to catch a unit that moved by a factor of a million, not to haggle over
 * a spread. Unknown currency or no rate → no opinion.
 */
export function priceBand(usdc: number, fiatAmount: number, currency: string, rate: number | null): string | null {
  if (rate == null || !Number.isFinite(fiatAmount) || fiatAmount <= 0 || !Number.isFinite(rate) || rate <= 0) return null;
  const expected = fiatAmount / rate;
  if (usdc > expected * 4) return `${usdc} USDC is far more than ${fiatAmount} ${currency} is worth (about ${expected.toFixed(4)} USDC)`;
  if (usdc < expected / 4) return `${usdc} USDC is far less than ${fiatAmount} ${currency} is worth (about ${expected.toFixed(4)} USDC)`;
  return null;
}

export async function plausiblePrice(usdc: number, fiatAmount: number, currency: string): Promise<string | null> {
  if (!Number.isFinite(fiatAmount) || fiatAmount <= 0) return null;
  const rate = currency.toUpperCase() === 'USD' ? 1 : await fiatPerUsdc(currency);
  return priceBand(usdc, fiatAmount, currency, rate);
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
  const currency = str(payment?.currency).toUpperCase();

  // Say what Bitrefill actually sent, so a refusal is diagnosable instead of mysterious
  const quoted = `${str(payment?.price) || String(payment?.price ?? '?')} ${currency || '(no currency)'} by ${str(payment?.method) || 'unknown method'}`;

  if (!id) return { problem: 'the invoice has no id' };
  if (!isAddress(address)) return { problem: 'the payment address is not an address' };
  const read = interpretPrice(payment?.price);
  if (!read) return { problem: `the invoice has no usable price (${quoted})` };
  // Currency first: a price in the wrong unit reads as an absurd amount, and
  // knowing which unit it is beats being told the number is too big
  if (currency && currency !== 'USDC') return { problem: `the invoice is priced in ${quoted}, not USDC` };
  if (read.usdc > max) return { problem: `the invoice asks for ${read.usdc} USDC (${quoted}), above the ${max} USDC limit` };
  // Whole USDC, however it was quoted: 6 decimals, the most USDC can hold
  const price = read.usdc.toFixed(6).replace(/\.?0+$/, '');
  return { id, payment: { address, price, currency: currency || 'USDC' } };
}

/**
 * Which of our tabs a product belongs in.
 *
 * Bitrefill's own category strings don't match reality — asking for
 * "Electricity" or "TV" in Nigeria returned nothing while the products plainly
 * exist — and the `type` field comes back empty, so neither can be trusted. The
 * catalogue is fetched per country and sorted here on two things that are always
 * present: the product's name, and whether it wants a phone line or an account
 * number. Anything we can't place stays out rather than landing in the wrong tab.
 */
export function classify(product: BillProduct): string | null {
  const name = product.name.toLowerCase();
  // Name first: it is the only thing separating a data bundle from airtime, or a
  // TV package from an electricity meter
  if (/waec|jamb|neco|nabteb|exam|scratch card|result checker/.test(name)) return 'exams';
  if (/dstv|gotv|startimes|showmax|decoder|\btv\b/.test(name)) return 'tv';
  // "Kaduna Elec Prepaid Bill" is an electricity bill that never says
  // "electricity", and it asks for a phone number, so only the name gives it away
  if (/electric|\belec\b|prepaid bill|ikeja|eko |ekedc|aedc|phed|kedco|ibedc|bedc|eedc|kaedco|jos |yola|aba power|disco|meter/.test(name)) {
    return 'electricity';
  }
  if (/\bdata\b|bundle|internet|broadband|spectranet|smile/.test(name)) return 'data';
  // Then what the product asks for. Bitrefill sends no usable `type`, but it
  // always says whether it needs a phone number or an account number.
  if (product.recipientType === 'phone_number') return 'airtime';
  if (product.recipientType === 'account') return 'utilities';
  return null;
}


/** Every product Bitrefill lists for a country (cached; Bitrefill asks for that) */
async function countryCatalogue(country: string): Promise<BillProduct[]> {
  const key = `country:${country}`;
  const hit = catalogue.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return (hit.body as { products: BillProduct[] }).products;

  const products: BillProduct[] = [];
  // Paginated, but bounded: a country's catalogue is a few hundred at most
  for (let page = 0; page < 6; page++) {
    const { status, body } = await bitrefill(`/products?country=${country}&limit=50&start=${page * 50}`);
    if (status !== 200) {
      if (page === 0) throw new Error(problemText(body, status));
      break;
    }
    const batch = (Array.isArray(body.data) ? body.data : []).map(toProduct).filter((p): p is BillProduct => p != null && p.inStock);
    products.push(...batch);
    if (batch.length < 50) break;
  }
  products.sort((a, b) => a.name.localeCompare(b.name));
  catalogue.set(key, { at: Date.now(), body: { products } });
  return products;
}

/** Products for one of our categories in a country */
export async function billProducts(category: string, country: string): Promise<BillProduct[]> {
  if (!CATEGORIES[category]) throw new Error(`unknown category "${category}"`);
  const all = await countryCatalogue(country);
  // "utilities" is the catch-all for a biller we can place no more precisely
  const wanted = all.filter((p) => classify(p) === category || (category === 'electricity' && classify(p) === 'utilities'));
  return wanted;
}

/** The networks that serve a phone number, so a top-up needn't ask which it is */
export async function phoneOperators(number: string, country?: string): Promise<{ id: string; name: string }[]> {
  // The lookup only recognises E.164, and people type their own number without
  // a country code
  const dialled = toE164(number, country);
  const { status, body } = await bitrefill(`/check_phone_number?phone_number=${encodeURIComponent(dialled)}`);
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

  // Second opinion on the price, from a rate that isn't Bitrefill's. The ceiling
  // alone can't catch a unit that moved by a factor of a million in the small
  // direction — 0.0000001 USDC is under any ceiling and buys nothing.
  const ordered = orderedFiat(body.data);
  if (ordered) {
    const off = await plausiblePrice(Number(verdict.payment.price), ordered.amount, ordered.currency);
    if (off) {
      console.error(`[bills] implausible price: ${off}`);
      return { problem: `Bitrefill's price doesn't match what was ordered (${off}). Nothing was sent.`, status: 502 };
    }
  }
  return { id: verdict.id, payment: verdict.payment, invoice: body.data };
}

/** What the invoice says was actually ordered, in the product's own currency */
export function orderedFiat(invoice: unknown): { amount: number; currency: string } | null {
  const orders = (invoice as { orders?: unknown } | null)?.orders;
  const first = Array.isArray(orders) ? (orders[0] as { product?: Record<string, unknown> } | undefined) : undefined;
  const product = first?.product;
  const amount = Number(product?.value);
  const currency = str(product?.currency).toUpperCase();
  return Number.isFinite(amount) && amount > 0 && /^[A-Z]{3}$/.test(currency) ? { amount, currency } : null;
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
    const category = str(url.searchParams.get('category'));
    const country = str(url.searchParams.get('country')).toUpperCase();
    if (!CATEGORIES[category]) return json(400, { error: 'unknown category' });
    if (!/^[A-Z]{2}$/.test(country)) return json(400, { error: 'country must be a 2-letter code' });
    try {
      // One implementation, shared with the agent: fetch the country's catalogue
      // and sort it here, since Bitrefill's own categories don't match reality
      return json(200, { products: await billProducts(category, country) });
    } catch (err) {
      return json(502, { error: err instanceof Error ? err.message : 'could not read the catalogue' });
    }
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
    const country = str(url.searchParams.get('country')).toUpperCase();
    const number = toE164(str(url.searchParams.get('number')), country).replace(/[\s()-]/g, '');
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

  if (route === 'preflight') {
    // Everything a real purchase does except the transfer: catalogue, operator,
    // product, a genuine invoice (unpaid invoices simply expire, and cost
    // nothing), the price checks, and what would be sent. It exists because the
    // only untested step in this app is the one that spends money, and this
    // narrows that to exactly one step.
    const country = (str(url.searchParams.get('country')) || 'NG').toUpperCase();
    const category = str(url.searchParams.get('category')) || 'airtime';
    const number = str(url.searchParams.get('number'));
    const refundAddress = str(url.searchParams.get('refundAddress'));
    const steps: { step: string; ok: boolean; detail: string }[] = [];
    const note = (step: string, ok: boolean, detail: string) => steps.push({ step, ok, detail });

    let products: BillProduct[] = [];
    try {
      products = await billProducts(category, country);
      note('catalogue', products.length > 0, `${products.length} products for ${category} in ${country}`);
    } catch (err) {
      note('catalogue', false, err instanceof Error ? err.message : 'failed');
      return json(200, { steps, ready: false });
    }

    let product = products[0];
    if (number) {
      const operators = await phoneOperators(number, country);
      const matched = operators.map((o) => products.find((p) => p.id === o.id)).find(Boolean);
      note('operator', operators.length > 0, operators.length > 0 ? operators.map((o) => o.name).join(', ') : `no operator for ${number}`);
      if (matched) product = matched;
    }
    if (!product) return json(200, { steps, ready: false });
    note('product', true, `${product.name} (${product.currency}), ${product.packages.length} denominations`);

    const cheapest = [...product.packages].sort((a, b) => Number(a.value) - Number(b.value))[0];
    note('denomination', cheapest != null, cheapest ? `${cheapest.value} ${product.currency}` : 'ranged product');

    // An invoice is only created when there is somewhere to refund to
    if (!isAddress(refundAddress) || !number) {
      note('invoice', false, 'pass ?number=<phone>&refundAddress=<0x…> to quote a real invoice');
      return json(200, { steps, ready: false });
    }
    const created = await createInvoice({
      productId: product.id,
      ...(cheapest ? { packageId: cheapest.id } : { value: String(product.range?.min ?? 1) }),
      recipient: number,
      refundAddress,
      country,
      phone: category === 'airtime' || category === 'data',
    });
    if ('problem' in created) {
      note('invoice', false, created.problem);
      return json(200, { steps, ready: false });
    }
    note('invoice', true, `${created.payment.price} USDC to ${created.payment.address} (unpaid, expires on its own)`);
    note('bridge', true, `the app would bridge ${created.payment.price} USDC plus the relayer fee from Arc`);
    return json(200, { steps, ready: true, invoice: created.id, payment: created.payment });
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

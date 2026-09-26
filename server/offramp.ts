// Cash out: USDC → a local bank account, through Paycrest's sender API
// (https://docs.paycrest.io). Paycrest settles on Base, Polygon, Arbitrum and a
// few others — not on Arc — so the app bridges the USDC to the order's receive
// address on Base first (src/lib/bridge.ts). That is a temporary detour: the
// moment Paycrest lists Arc, only the `NETWORK` constant below changes.
//
// This server exists to hold the API key and to validate what gets sent. It
// never touches funds: Paycrest returns a deposit address, the user's own wallet
// pays it, and providers deliver the fiat.
//
// Env: PAYCREST_API_KEY (from a verified sender account at app.paycrest.io),
// optional PAYCREST_FEE_PERCENT + PAYCREST_FEE_ADDRESS (a fee Vlora collects
// on-chain, off by default), optional OFFRAMP_MAX_USDC (per-order ceiling).
// Unset key → the panel shows rates and bank lookups but can't create orders.
import { isAddress } from 'viem';
import { CHAIN_ID } from './chain';

export type OfframpRoute = 'info' | 'institutions' | 'rate' | 'verify' | 'orders' | 'order';

const API = 'https://api.paycrest.io/v2';
/** Paycrest's settlement network for our orders */
const NETWORK = 'base';
const TOKEN = 'USDC';
/** Paycrest's own floor is $0.50 */
const MIN_USDC = 1;
const DEFAULT_MAX_USDC = 100;

function env(name: string): string {
  return (process.env[name] ?? '').trim().replace(/^["']|["']$/g, '').trim();
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

const json = (status: number, body: unknown) => Response.json(body, { status });

function maxUsdc(): number {
  const configured = Number(env('OFFRAMP_MAX_USDC'));
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MAX_USDC;
}

/** null = ready; otherwise why cashing out is off (never includes the key) */
function configProblem(): string | null {
  if (CHAIN_ID !== 5042) return 'Paycrest settles on mainnet only, and this app is on Arc Testnet';
  if (!env('PAYCREST_API_KEY')) return 'PAYCREST_API_KEY is not set';
  return null;
}

// Best-effort per-instance limits. These routes spend our API key's reputation,
// and they can't check a wallet signature, so keep the blast radius small.
const recent = new Map<string, number[]>();
const RATE_WINDOW_MS = 60_000;
const RATE_MAX: Record<string, number> = { verify: 30, orders: 10, rate: 120, institutions: 60, order: 120 };

function rateLimited(route: string): boolean {
  const now = Date.now();
  const hits = (recent.get(route) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  hits.push(now);
  recent.set(route, hits);
  return hits.length > (RATE_MAX[route] ?? 60);
}

/** Paycrest wraps everything in {status, message, data} */
interface Envelope {
  status?: string;
  message?: string;
  data?: unknown;
}

async function paycrest(path: string, init?: RequestInit & { authenticated?: boolean }): Promise<{ status: number; body: Envelope }> {
  const headers = new Headers(init?.headers);
  headers.set('accept', 'application/json');
  if (init?.body) headers.set('content-type', 'application/json');
  if (init?.authenticated) headers.set('API-Key', env('PAYCREST_API_KEY'));
  const res = await fetch(`${API}${path}`, { ...init, headers });
  const body = (await res.json().catch(() => ({}))) as Envelope;
  return { status: res.status, body };
}

/** Paycrest's error text, flattened — `data` can be a list of field problems */
function problemText(body: Envelope): string {
  const fields = Array.isArray(body.data) ? body.data : body.data && typeof body.data === 'object' ? [body.data] : [];
  const details = fields
    .map((f) => {
      const o = f as Record<string, unknown>;
      return [str(o.field), str(o.message)].filter(Boolean).join(': ');
    })
    .filter(Boolean)
    .join('; ');
  return [str(body.message), details].filter(Boolean).join(' — ') || 'Paycrest rejected the request';
}

const CURRENCY = /^[A-Z]{3}$/;
const INSTITUTION = /^[A-Z0-9]{3,24}$/;
// Bank account numbers, and mobile-money or Paybill identifiers ("12345|ref")
const ACCOUNT = /^[A-Za-z0-9|+-]{5,40}$/;
const PROVIDER_ID = /^[A-Za-z0-9]{4,24}$/;
const AMOUNT = /^\d{1,7}(\.\d{1,6})?$/;

/** The amount as a plain decimal string, or null if it isn't one we'll accept */
export function cleanAmount(raw: unknown, max = maxUsdc()): string | null {
  const value = str(raw).trim();
  if (!AMOUNT.test(value)) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < MIN_USDC || n > max) return null;
  return value;
}

export interface OrderRequest {
  amount: string;
  currency: string;
  institution: string;
  accountIdentifier: string;
  accountName: string;
  memo: string;
  refundAddress: string;
  providerIds: string[];
}

/**
 * Everything the server insists on before it will create an order. Separate from
 * the route because this is the part that decides whose money goes where: an
 * amount inside the beta ceiling, a bank and account the user picked, and a
 * refund address that can actually receive a refund.
 */
export function orderProblem(payload: Record<string, unknown> | null, max = maxUsdc()): { problem: string } | { order: OrderRequest } {
  const amount = cleanAmount(payload?.amount, max);
  const currency = str(payload?.currency).toUpperCase();
  const institution = str(payload?.institution).toUpperCase();
  const accountIdentifier = str(payload?.accountIdentifier).trim();
  const accountName = str(payload?.accountName).trim();
  const memo = str(payload?.memo).trim().slice(0, 100);
  const refundAddress = str(payload?.refundAddress).trim();
  const providerIds = (Array.isArray(payload?.providerIds) ? payload.providerIds : [])
    .map((id) => str(id))
    .filter((id) => PROVIDER_ID.test(id))
    .slice(0, 3);

  if (!amount) return { problem: `Amount must be between ${MIN_USDC} and ${max} USDC.` };
  if (!CURRENCY.test(currency)) return { problem: 'Pick a currency.' };
  if (!INSTITUTION.test(institution)) return { problem: 'Pick a bank.' };
  if (!ACCOUNT.test(accountIdentifier)) return { problem: 'That account number looks wrong.' };
  if (accountName.length < 2 || accountName.length > 100) return { problem: 'Account name is missing.' };
  // Refunds land on the settlement network, so this must be an address the user controls there
  if (!isAddress(refundAddress)) return { problem: 'A refund address is required.' };
  return { order: { amount, currency, institution, accountIdentifier, accountName, memo, refundAddress, providerIds } };
}

/** The deposit instructions an order must carry before the app will send anything */
export function depositProblem(order: unknown): string | null {
  const data = order as { id?: unknown; providerAccount?: { network?: unknown; receiveAddress?: unknown } } | null;
  const account = data?.providerAccount;
  if (!str(data?.id)) return 'the order has no id';
  if (!account || str(account.network) !== NETWORK) return `the deposit is not on ${NETWORK}`;
  if (!isAddress(str(account.receiveAddress))) return 'the deposit address is not an address';
  return null;
}

export async function handleOfframp(route: OfframpRoute, request: Request): Promise<Response> {
  const url = new URL(request.url);
  const problem = configProblem();

  if (route === 'info') {
    const currencies = await paycrest('/currencies');
    return json(200, {
      enabled: problem == null,
      ...(problem ? { reason: problem } : {}),
      network: NETWORK,
      token: TOKEN,
      minUsdc: MIN_USDC,
      maxUsdc: maxUsdc(),
      currencies: Array.isArray(currencies.body.data) ? currencies.body.data : [],
    });
  }

  if (rateLimited(route)) return json(429, { error: 'Too many requests — try again in a minute.' });

  if (route === 'institutions') {
    const currency = url.searchParams.get('currency') ?? '';
    if (!CURRENCY.test(currency)) return json(400, { error: 'currency must be a 3-letter code' });
    const { status, body } = await paycrest(`/institutions/${currency}`);
    return status === 200 ? json(200, { institutions: body.data ?? [] }) : json(502, { error: problemText(body) });
  }

  if (route === 'rate') {
    const currency = url.searchParams.get('currency') ?? '';
    const amount = cleanAmount(url.searchParams.get('amount') ?? '');
    if (!CURRENCY.test(currency)) return json(400, { error: 'currency must be a 3-letter code' });
    if (!amount) return json(400, { error: `amount must be between ${MIN_USDC} and ${maxUsdc()} USDC` });
    const { status, body } = await paycrest(`/rates/${NETWORK}/${TOKEN}/${amount}/${currency}?side=sell`);
    const sell = (body.data as { sell?: { rate?: string; providerIds?: string[] } } | undefined)?.sell;
    if (status !== 200 || !sell?.rate) return json(502, { error: problemText(body) });
    return json(200, { rate: sell.rate, providerIds: sell.providerIds ?? [], currency, amount });
  }

  if (route === 'verify') {
    if (request.method !== 'POST') return json(405, { error: 'method not allowed' });
    const payload = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const institution = str(payload?.institution).toUpperCase();
    const accountIdentifier = str(payload?.accountIdentifier).trim();
    if (!INSTITUTION.test(institution)) return json(400, { error: 'institution is not a valid code' });
    if (!ACCOUNT.test(accountIdentifier)) return json(400, { error: 'account number looks wrong' });
    const { status, body } = await paycrest('/verify-account', {
      method: 'POST',
      body: JSON.stringify({ institution, accountIdentifier }),
    });
    if (status !== 200) return json(400, { error: problemText(body) });
    // `data` is the account name, or "OK" where the corridor can't look one up
    return json(200, { accountName: str(body.data) });
  }

  if (route === 'order') {
    if (problem) return json(503, { error: problem });
    const id = url.searchParams.get('id') ?? '';
    if (!/^[A-Za-z0-9-]{10,64}$/.test(id)) return json(400, { error: 'bad order id' });
    const { status, body } = await paycrest(`/sender/orders/${id}`, { authenticated: true });
    if (status !== 200) return json(502, { error: problemText(body) });
    return json(200, { order: body.data });
  }

  if (route !== 'orders' || request.method !== 'POST') return json(405, { error: 'method not allowed' });
  if (problem) {
    console.error(`[offramp] not configured: ${problem}`);
    return json(503, { error: 'Cashing out is not configured on this server.' });
  }

  const payload = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const checked = orderProblem(payload);
  if ('problem' in checked) return json(400, { error: checked.problem });
  const { amount, currency, institution, accountIdentifier, accountName, memo, refundAddress, providerIds } = checked.order;

  const feePercent = env('PAYCREST_FEE_PERCENT');
  const feeAddress = env('PAYCREST_FEE_ADDRESS');
  const { status, body } = await paycrest('/sender/orders', {
    method: 'POST',
    authenticated: true,
    body: JSON.stringify({
      amount,
      source: { type: 'crypto', currency: TOKEN, network: NETWORK, refundAddress },
      destination: {
        type: 'fiat',
        currency,
        ...(providerIds.length ? { providerIds } : {}),
        recipient: { institution, accountIdentifier, accountName, ...(memo ? { memo } : {}) },
      },
      ...(Number(feePercent) > 0 && isAddress(feeAddress) ? { senderFeePercent: feePercent, senderFeeAddress: feeAddress } : {}),
    }),
  });

  if (status !== 201 && status !== 200) {
    console.error('[offramp] create failed', status, body.message);
    return json(status === 401 || status === 403 ? 503 : 400, { error: problemText(body) });
  }

  // The response decides where the user's money goes, so check it before the app
  // bridges anything: the deposit must be a plain address on the network we asked for.
  const wrong = depositProblem(body.data);
  if (wrong) {
    console.error(`[offramp] unexpected order: ${wrong}`, JSON.stringify(body).slice(0, 400));
    return json(502, { error: 'Paycrest returned an order we could not verify. Nothing was sent.' });
  }
  return json(201, { order: body.data });
}

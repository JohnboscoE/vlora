// Gasless USDC sends through Circle's Facilitator Service (x402 `exact` scheme,
// EIP-3009 transferWithAuthorization). The user signs a TransferWithAuthorization
// in their wallet; this server checks it and hands it to Circle, which submits
// the transfer and pays the gas. The server never holds funds or keys: the
// signature only authorizes that exact amount to that exact recipient.
//
// Env: CIRCLE_API_KEY (TEST_API_KEY:… on testnet, LIVE_API_KEY:… on mainnet).
// Unset → gasless is off and the app sends normally.
import { getAddress, isAddress, isHex, verifyTypedData, type Address, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { CHAIN_ID, publicClient } from './chain';

export type GaslessRoute = 'info' | 'settle' | 'check';

const USDC: Address = '0x3600000000000000000000000000000000000000';
const NETWORK = `eip155:${CHAIN_ID}`;
const DEFAULT_API = 'https://api.circle.com';

// Same domain as the USDC contract; checked against DOMAIN_SEPARATOR() on both Arc networks
export const USDC_DOMAIN = { name: 'USDC', version: '2', chainId: CHAIN_ID, verifyingContract: USDC } as const;
export const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const;

const authorizationStateAbi = [
  {
    type: 'function',
    name: 'authorizationState',
    stateMutability: 'view',
    inputs: [
      { name: 'authorizer', type: 'address' },
      { name: 'nonce', type: 'bytes32' },
    ],
    outputs: [{ type: 'bool' }],
  },
] as const;

// Authorizations must expire soon: a signature that can't settle later can't surprise anyone
const MAX_VALIDITY_S = 30 * 60;
const MIN_VALIDITY_S = 60;
// Circle may wait this long for a terminal result before answering "pending"
const SETTLE_WAIT_S = 20;

function env(name: string): string {
  return (process.env[name] ?? '').trim().replace(/^["']|["']$/g, '').trim();
}

/** null = ready; otherwise why gasless is off (never includes the key itself) */
function configProblem(): string | null {
  const key = env('CIRCLE_API_KEY');
  if (!key) return 'CIRCLE_API_KEY is not set';
  const testnet = CHAIN_ID !== 5042;
  if (testnet && key.startsWith('LIVE_API_KEY:')) return 'CIRCLE_API_KEY is a mainnet (LIVE) key but the app is on Arc Testnet';
  if (!testnet && key.startsWith('TEST_API_KEY:')) return 'CIRCLE_API_KEY is a testnet (TEST) key but the app is on Arc mainnet';
  return null;
}

const json = (status: number, body: unknown) => Response.json(body, { status });

/** A string field from an untrusted JSON body; anything else counts as missing */
function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

// Best-effort, per instance (see handler.ts). Circle rate-limits and screens too.
const recent = new Map<string, number[]>();
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 5;

interface Authorization {
  from: Address;
  to: Address;
  value: bigint;
  validAfter: bigint;
  validBefore: bigint;
  nonce: Hex;
}

function parseAuthorization(raw: unknown): Authorization | string {
  if (!raw || typeof raw !== 'object') return 'authorization is required';
  const a = raw as Record<string, unknown>;
  const from = str(a.from);
  const to = str(a.to);
  const nonce = str(a.nonce);
  if (!isAddress(from) || !isAddress(to)) return 'invalid address';
  if (!isHex(nonce) || nonce.length !== 66) return 'invalid nonce';
  let value: bigint, validAfter: bigint, validBefore: bigint;
  try {
    value = BigInt(str(a.value));
    validAfter = BigInt(str(a.validAfter));
    validBefore = BigInt(str(a.validBefore));
  } catch {
    return 'invalid number';
  }
  if (value <= 0n) return 'amount must be above 0';
  if (getAddress(from) === getAddress(to)) return 'sender and recipient are the same';
  return { from: getAddress(from), to: getAddress(to), value, validAfter, validBefore, nonce };
}

export type SettleResult =
  | { status: 'success'; transaction: Hex }
  /** Circle recorded it and is still settling; the signature can still land */
  | { status: 'pending'; reason: string }
  /** Circle rejected it before recording: nothing moved and the signature won't be used.
   *  disable: retrying won't help (key or account policy), stop offering gasless */
  | { status: 'rejected'; reason: string; disable?: boolean };

export async function handleGasless(route: GaslessRoute, request: Request): Promise<Response> {
  const problem = configProblem();
  if (route === 'info' && request.method === 'GET') {
    // Only a yes/no plus a variable name for diagnosis — never the key
    return json(200, { enabled: problem == null, chainId: CHAIN_ID, ...(problem ? { reason: problem } : {}) });
  }
  if (route === 'check' && request.method === 'GET') {
    if (problem) return json(200, { ok: false, reason: problem });
    return json(200, await diagnose());
  }
  if (route !== 'settle' || request.method !== 'POST') return json(405, { error: 'method not allowed' });
  if (problem) {
    console.error(`[gasless] misconfigured: ${problem}`);
    return json(503, { status: 'rejected', reason: 'Gasless sends are not configured on this server.' });
  }

  try {
    const text = await request.text();
    if (text.length > 5_000) return json(413, { status: 'rejected', reason: 'body too large' });
    const body = (text ? JSON.parse(text) : {}) as Record<string, unknown>;
    const auth = parseAuthorization(body.authorization);
    const signature = str(body.signature);
    if (typeof auth === 'string') return json(400, { status: 'rejected', reason: auth });
    if (!isHex(signature)) return json(400, { status: 'rejected', reason: 'invalid signature' });

    const now = BigInt(Math.floor(Date.now() / 1000));
    if (auth.validAfter > now) return json(400, { status: 'rejected', reason: 'authorization is not valid yet' });
    if (auth.validBefore < now + BigInt(MIN_VALIDITY_S) || auth.validBefore > now + BigInt(MAX_VALIDITY_S)) {
      return json(400, { status: 'rejected', reason: `authorization must expire within ${MAX_VALIDITY_S / 60} minutes` });
    }

    // Reject forgeries here instead of spending Circle quota on them
    const valid = await verifyTypedData({
      address: auth.from,
      domain: USDC_DOMAIN,
      types: TRANSFER_WITH_AUTHORIZATION_TYPES,
      primaryType: 'TransferWithAuthorization',
      message: auth,
      signature,
    });
    if (!valid) return json(400, { status: 'rejected', reason: 'the signature does not match the sender' });

    const times = (recent.get(auth.from) ?? []).filter((t) => Date.now() - t < RATE_WINDOW_MS);
    if (times.length >= RATE_MAX) return json(429, { status: 'rejected', reason: 'Too many gasless sends — wait a minute.' });
    recent.set(auth.from, [...times, Date.now()]);

    const used = await publicClient
      .readContract({ address: USDC, abi: authorizationStateAbi, functionName: 'authorizationState', args: [auth.from, auth.nonce] })
      .catch(() => false);
    // Already used means it already moved: let the client confirm it on-chain, never re-send
    if (used) return json(200, { status: 'pending', reason: 'this authorization was already settled' });

    try {
      return json(200, await settle(auth, signature, new URL(request.url).origin));
    } catch (err) {
      console.error('[gasless] settle failed', err);
      // Unknown outcome (timeout, network): the client watches the chain before saying anything moved
      return json(502, { status: 'pending', reason: 'Circle did not answer cleanly' });
    }
  } catch (err) {
    // Nothing was sent to Circle yet, so nothing can move
    console.error('[gasless] bad request', err);
    return json(400, { status: 'rejected', reason: 'bad request' });
  }
}

/**
 * Is the API key itself allowed to settle here? Runs a real /settle with a freshly
 * generated, empty wallet: nothing can move (it has no USDC), but Circle answers with
 * either a policy refusal (the key/account isn't permitted) or `insufficient_funds`
 * (the key works, so a refusal of a real payment is about that payment).
 */
async function diagnose() {
  const api = env('CIRCLE_FACILITATOR_URL') || DEFAULT_API;
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${env('CIRCLE_API_KEY')}` };
  const short = (v: unknown) => JSON.stringify(v).slice(0, 300);

  // 1. Is the key accepted by Circle at all?
  const keyCheck = await fetch(`${api}/v1/w3s/wallets`, { headers, signal: AbortSignal.timeout(15_000) })
    .then(async (r) => ({ status: r.status, body: short(await r.json().catch(() => null)) }))
    .catch((e: Error) => ({ status: 0, body: e.message.slice(0, 200) }));

  // 2. Can it settle? An empty throwaway buyer and payout address: no funds can move.
  const buyer = privateKeyToAccount(generatePrivateKey());
  const payTo = privateKeyToAccount(generatePrivateKey()).address;
  const nonce = ('0x' + Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex')) as Hex;
  const auth: Authorization = {
    from: buyer.address,
    to: payTo,
    value: 10_000n,
    validAfter: 0n,
    validBefore: BigInt(Math.floor(Date.now() / 1000) + 600),
    nonce,
  };
  const signature = await buyer.signTypedData({
    domain: USDC_DOMAIN,
    types: TRANSFER_WITH_AUTHORIZATION_TYPES,
    primaryType: 'TransferWithAuthorization',
    message: auth,
  });
  const probe = await fetch(`${api}/v1/facilitator/x402/settle`, {
    method: 'POST',
    headers,
    body: JSON.stringify(settleBody(auth, signature, 'https://vlora-two.vercel.app')),
    signal: AbortSignal.timeout(40_000),
  })
    .then(async (r) => ({ status: r.status, body: short(await r.json().catch(() => null)) }))
    .catch((e: Error) => ({ status: 0, body: e.message.slice(0, 200) }));

  const verdict =
    probe.status === 200
      ? 'The API key can settle on this network. A refusal of a real payment is about that payment (recipient, amount or screening), not the key.'
      : probe.status === 401
        ? 'Circle rejected the API key itself (401). Check CIRCLE_API_KEY, and that it is a LIVE key on mainnet.'
        : probe.status === 403
          ? 'Circle refuses to settle for this key (403) even for a throwaway payment: the account/key is not enabled for Facilitator Service on this network.'
          : `Unexpected response from Circle (${probe.status}).`;
  return { network: NETWORK, keyCheck, settleProbe: probe, verdict };
}

/** The x402 settle body; shared by settle() and the diagnostic probe */
function settleBody(auth: Authorization, signature: Hex, origin: string) {
  const value = auth.value.toString();
  const requirements = {
    scheme: 'exact',
    network: NETWORK,
    amount: value,
    asset: USDC,
    payTo: auth.to,
    maxTimeoutSeconds: SETTLE_WAIT_S,
    extra: { name: 'USDC', version: '2' },
  };
  return {
    x402Version: 2,
    paymentPayload: {
      x402Version: 2,
      resource: { url: `${origin}/send`, description: 'Vlora USDC payment', mimeType: 'application/json' },
      accepted: { ...requirements, extra: { ...requirements.extra, assetTransferMethod: 'eip3009' } },
      payload: {
        signature,
        authorization: {
          from: auth.from,
          to: auth.to,
          value,
          validAfter: auth.validAfter.toString(),
          validBefore: auth.validBefore.toString(),
          nonce: auth.nonce,
        },
      },
      // Derived from the EIP-3009 nonce, so a retry of the same signature converges on one payment
      extensions: { 'payment-identifier': { info: { required: true, id: `vlora_${auth.nonce.slice(2, 42)}` } } },
    },
    paymentRequirements: requirements,
  };
}

async function settle(auth: Authorization, signature: Hex, origin: string): Promise<SettleResult> {
  const api = env('CIRCLE_FACILITATOR_URL') || DEFAULT_API;
  const payload = settleBody(auth, signature, origin);

  const res = await fetch(`${api}/v1/facilitator/x402/settle`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${env('CIRCLE_API_KEY')}` },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout((SETTLE_WAIT_S + 15) * 1000),
  });
  const data = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    transaction?: string;
    errorReason?: string;
    message?: string;
    errors?: unknown[];
    extensions?: { 'settlement-status'?: { status?: string; paymentId?: string } };
  };

  if (res.status !== 200) {
    // Circle's error body is secret-free: log all of it and pass the details on
    console.error(`[gasless] Circle ${res.status}: ${JSON.stringify(data).slice(0, 800)}`);
    // 4xx is a rejected request ("carries no settlement outcome"); 5xx is unknown.
    // 409 means this authorization is already bound to a payment, so it may still land.
    if (res.status >= 500 || res.status === 409) return { status: 'pending', reason: `Circle error ${res.status}` };
    const details = circleErrorDetails(data.errors);
    return {
      status: 'rejected',
      reason: `${circleReason(res.status, data.message)}${details ? ` — ${details}` : ''}`,
      // A policy refusal (403) or bad key (401) won't change by retrying: the client stops offering gasless
      ...(res.status === 401 || res.status === 403 ? { disable: true } : {}),
    };
  }
  if (data.success && data.transaction && isHex(data.transaction)) return { status: 'success', transaction: data.transaction };

  const recorded = data.extensions?.['settlement-status'];
  if (data.errorReason === 'settlement_pending' || recorded?.status === 'pending') {
    const paymentId = recorded?.paymentId;
    if (paymentId) {
      const tx = await pollStatus(api, paymentId);
      if (tx) return { status: 'success', transaction: tx };
    }
    return { status: 'pending', reason: 'Circle is still settling it' };
  }
  // A recorded payment that failed terminally, or a validation failure: nothing moved
  return { status: 'rejected', reason: settleReason(data.errorReason) };
}

async function pollStatus(api: string, paymentId: string): Promise<Hex | null> {
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 3_000));
    try {
      const res = await fetch(`${api}/v1/facilitator/x402/status/${encodeURIComponent(paymentId)}`, {
        headers: { authorization: `Bearer ${env('CIRCLE_API_KEY')}` },
        signal: AbortSignal.timeout(10_000),
      });
      const data = (await res.json()) as { status?: string; transaction?: string | null };
      if (data.status === 'completed' && data.transaction && isHex(data.transaction)) return data.transaction;
      if (data.status === 'failed') return null;
    } catch {
      // keep polling
    }
  }
  return null;
}

/** Circle's `errors` array, flattened to one line (entries may be strings or objects) */
function circleErrorDetails(errors: unknown[] | undefined): string {
  if (!Array.isArray(errors)) return '';
  return errors
    .map((e) => {
      if (typeof e === 'string') return e;
      if (e && typeof e === 'object') {
        const o = e as Record<string, unknown>;
        const text = [o.code, o.error, o.message, o.location ?? o.field].filter((v) => typeof v === 'string' || typeof v === 'number');
        return text.length ? text.join(' ') : JSON.stringify(o);
      }
      return '';
    })
    .filter(Boolean)
    .join('; ')
    .slice(0, 300);
}

function circleReason(status: number, message?: string): string {
  if (status === 401) return 'Circle rejected the API key';
  if (status === 403) {
    return `Circle refused to settle for this API key (${message ?? 'forbidden'}). Check in Circle Console that the key has Facilitator access on Arc mainnet`;
  }
  if (status === 429) return 'Circle rate limit — try again in a minute';
  return message ?? `Circle rejected the request (${status})`;
}

function settleReason(code?: string): string {
  switch (code) {
    case 'insufficient_funds':
      return 'not enough USDC';
    case 'invalid_exact_evm_payload_signature':
      return 'Circle could not verify the signature';
    case 'invalid_exact_evm_payload_authorization_valid_before':
      return 'the authorization expired';
    case 'invalid_network':
      return 'Circle does not support this network for your key';
    case undefined:
      return 'Circle could not settle it';
    default:
      return `Circle: ${code}`;
  }
}

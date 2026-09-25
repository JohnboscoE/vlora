// Arc App Kit Onramp: buy USDC/EURC on Arc with a card, Apple Pay, Google Pay or a
// bank transfer. Circle hosts the widget and handles KYC, payment and settlement; this
// server only exchanges our API key for a short-lived session bound to one wallet
// address. https://docs.arc.io/app-kit/onramp
//
// Env: CIRCLE_API_KEY (the same key as gasless sends), ONRAMP_REFERRER_DOMAIN
// (the domain embedding the widget — required for card / Apple Pay / Google Pay).
// Unset key → the Add funds panel shows the deposit address only.
import { createAppServerKit, createSessionRouteHandler } from '@circle-fin/app-kit/server';
import { CHAIN_ID } from './chain';

export type OnrampRoute = 'info' | 'sessions';

function env(name: string): string {
  return (process.env[name] ?? '').trim().replace(/^["']|["']$/g, '').trim();
}

/** null = ready; otherwise why card top-ups are off (never includes the key) */
function configProblem(): string | null {
  const key = env('CIRCLE_API_KEY');
  if (!key) return 'CIRCLE_API_KEY is not set';
  const testnet = CHAIN_ID !== 5042;
  if (testnet && key.startsWith('LIVE_API_KEY:')) return 'CIRCLE_API_KEY is a mainnet (LIVE) key but the app is on Arc Testnet';
  if (!testnet && key.startsWith('TEST_API_KEY:')) return 'CIRCLE_API_KEY is a testnet (TEST) key but the app is on Arc mainnet';
  return null;
}

const json = (status: number, body: unknown) => Response.json(body, { status });

// Best-effort per-instance limit: this route mints sessions against our API key, and
// it can't check a wallet signature, so keep the blast radius small.
const recent: number[] = [];
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 20;

type Handler = (request: Request) => Promise<Response>;
let handler: Handler | null = null;

function sessionHandler(origin: string): Handler {
  if (!handler) {
    const server = createAppServerKit({
      onramp: {
        apiKey: env('CIRCLE_API_KEY'),
        // Card / Apple Pay / Google Pay require the embedding domain
        referrerDomain: env('ONRAMP_REFERRER_DOMAIN') || new URL(origin).host,
      },
    });
    handler = createSessionRouteHandler(server.onramp);
  }
  return handler;
}

export async function handleOnramp(route: OnrampRoute, request: Request): Promise<Response> {
  const problem = configProblem();
  if (route === 'info' && request.method === 'GET') {
    return json(200, { enabled: problem == null, chainId: CHAIN_ID, ...(problem ? { reason: problem } : {}) });
  }
  if (route !== 'sessions' || request.method !== 'POST') return json(405, { error: 'method not allowed' });
  if (problem) {
    console.error(`[onramp] misconfigured: ${problem}`);
    return json(503, { error: 'Card top-ups are not configured on this server.' });
  }

  const now = Date.now();
  while (recent.length && now - (recent[0] ?? 0) > RATE_WINDOW_MS) recent.shift();
  if (recent.length >= RATE_MAX) return json(429, { error: 'Too many top-up sessions right now — try again in a minute.' });
  recent.push(now);

  try {
    return await sessionHandler(new URL(request.url).origin)(request);
  } catch (err) {
    console.error('[onramp] session failed', err);
    return json(502, { error: 'Circle could not start a top-up session.' });
  }
}

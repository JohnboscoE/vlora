// Agent API server (testnet prototype).
//   node --experimental-strip-types server/index.ts
// Reads server/.env (see server/.env.example). Never commit real keys.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { getAddress, isAddress, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { issueNonce, login, sessionAddress } from './auth.ts';
import { runAgent, type ChatTurn } from './agent.ts';
import { publicClient, vaultAbi } from './chain.ts';

// Minimal .env loader (no extra dependency)
const envPath = new URL('./.env', import.meta.url);
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, '');
  }
}

const PORT = Number(process.env.PORT ?? 8787);
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN ?? 'http://localhost:5173';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? '';
const AGENT_PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY as `0x${string}` | undefined;

if (!ANTHROPIC_API_KEY || !AGENT_PRIVATE_KEY || !/^0x[0-9a-fA-F]{64}$/.test(AGENT_PRIVATE_KEY)) {
  console.error('Missing ANTHROPIC_API_KEY or AGENT_PRIVATE_KEY (0x + 64 hex) in server/.env');
  process.exit(1);
}
const AGENT_ADDRESS = privateKeyToAccount(AGENT_PRIVATE_KEY).address;

// One request at a time per wallet, and a simple per-wallet rate limit
const busy = new Set<string>();
const recent = new Map<string, number[]>();
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 10;

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    'content-type': 'application/json',
    'access-control-allow-origin': ALLOWED_ORIGIN,
    'access-control-allow-headers': 'content-type, authorization',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
  });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 20_000) throw new Error('body too large');
  }
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

async function handleChat(req: IncomingMessage, res: ServerResponse) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  const owner = sessionAddress(token);
  if (!owner) return send(res, 401, { error: 'Sign in first.' });

  const body = await readJson(req);
  const vaultRaw = String(body.vault ?? '');
  const message = String(body.message ?? '').trim().slice(0, 2000);
  const history = (Array.isArray(body.history) ? body.history : [])
    .filter((t): t is ChatTurn => !!t && (t.role === 'user' || t.role === 'assistant') && typeof t.text === 'string');
  if (!isAddress(vaultRaw) || !message) return send(res, 400, { error: 'vault and message are required' });
  const vault = getAddress(vaultRaw) as Address;

  // The caller must own this vault, and this server must be its agent
  const [vaultOwner, vaultAgent] = await Promise.all([
    publicClient.readContract({ address: vault, abi: vaultAbi, functionName: 'owner' }),
    publicClient.readContract({ address: vault, abi: vaultAbi, functionName: 'agent' }),
  ]).catch(() => [null, null] as const);
  if (!vaultOwner || getAddress(vaultOwner) !== owner) return send(res, 403, { error: 'You don\'t own this agent wallet.' });
  if (!vaultAgent || getAddress(vaultAgent) !== AGENT_ADDRESS) {
    return send(res, 409, { error: 'This agent wallet is revoked or points at a different agent.' });
  }

  const now = Date.now();
  const times = (recent.get(owner) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (times.length >= RATE_MAX) return send(res, 429, { error: 'Too many requests — wait a minute.' });
  if (busy.has(owner)) return send(res, 429, { error: 'Still working on your previous request.' });
  recent.set(owner, [...times, now]);

  busy.add(owner);
  try {
    const result = await runAgent({ apiKey: ANTHROPIC_API_KEY, agentKey: AGENT_PRIVATE_KEY!, vault, message, history });
    send(res, 200, result);
  } catch (err) {
    console.error('[agent] run failed', err);
    send(res, 500, { error: 'The agent hit an error. Nothing further was executed.' });
  } finally {
    busy.delete(owner);
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
    if (req.method === 'OPTIONS') return send(res, 204, {});
    if (req.method === 'GET' && url.pathname === '/api/agent/info') {
      return send(res, 200, { agent: AGENT_ADDRESS, chainId: 5042002 });
    }
    if (req.method === 'GET' && url.pathname === '/api/agent/nonce') {
      const issued = issueNonce(url.searchParams.get('address') ?? '');
      return issued ? send(res, 200, issued) : send(res, 400, { error: 'invalid address' });
    }
    if (req.method === 'POST' && url.pathname === '/api/agent/login') {
      const body = await readJson(req);
      const token = await login(String(body.address ?? ''), String(body.nonce ?? ''), String(body.signature ?? '') as `0x${string}`);
      return token ? send(res, 200, { token }) : send(res, 401, { error: 'Signature check failed.' });
    }
    if (req.method === 'POST' && url.pathname === '/api/agent/chat') return handleChat(req, res);
    send(res, 404, { error: 'not found' });
  } catch (err) {
    console.error('[agent] request failed', err);
    send(res, 500, { error: 'server error' });
  }
});

server.listen(PORT, () => {
  console.log(`Vlora agent server on http://localhost:${PORT}`);
  console.log(`Agent address: ${AGENT_ADDRESS} (fund it with a little testnet USDC for gas)`);
});

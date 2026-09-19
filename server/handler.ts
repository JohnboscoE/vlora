// Agent API as a plain Web Request → Response handler, shared by the Vercel
// functions in /api/agent and the local dev server (server/local.ts).
import { getAddress, isAddress, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { issueNonce, login, sessionAddress } from './auth';
import { runAgent, type ChatTurn } from './agent';
import { publicClient, vaultAbi } from './chain';

export type AgentRoute = 'info' | 'nonce' | 'login' | 'chat';

interface Config {
  anthropicKey: string;
  agentKey: `0x${string}`;
  agentAddress: Address;
  sessionSecret: string;
}

// Read lazily so a missing variable returns a clear 503 instead of crashing the function
function getConfig(): Config | string {
  const anthropicKey = process.env.ANTHROPIC_API_KEY ?? '';
  const agentKey = process.env.AGENT_PRIVATE_KEY ?? '';
  const sessionSecret = process.env.SESSION_SECRET ?? '';
  if (!anthropicKey) return 'ANTHROPIC_API_KEY is not set';
  if (!/^0x[0-9a-fA-F]{64}$/.test(agentKey)) return 'AGENT_PRIVATE_KEY is missing or not 0x + 64 hex';
  if (sessionSecret.length < 32) return 'SESSION_SECRET is missing or shorter than 32 characters';
  return {
    anthropicKey,
    agentKey: agentKey as `0x${string}`,
    agentAddress: privateKeyToAccount(agentKey as `0x${string}`).address,
    sessionSecret,
  };
}

const json = (status: number, body: unknown) => Response.json(body, { status });

// Best-effort abuse limits. Per instance only: on Vercel each function instance
// keeps its own counters. The vault's on-chain limits are the real safety net.
const busy = new Set<string>();
const recent = new Map<string, number[]>();
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 10;

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.length > 20_000) throw new Error('body too large');
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

export async function handleAgent(route: AgentRoute, request: Request): Promise<Response> {
  const config = getConfig();
  if (typeof config === 'string') {
    console.error(`[agent] misconfigured: ${config}`);
    return json(503, { error: 'The agent server is not configured yet.' });
  }

  try {
    if (route === 'info' && request.method === 'GET') {
      return json(200, { agent: config.agentAddress, chainId: 5042002 });
    }

    if (route === 'nonce' && request.method === 'GET') {
      const address = new URL(request.url).searchParams.get('address') ?? '';
      const issued = issueNonce(config.sessionSecret, address);
      return issued ? json(200, issued) : json(400, { error: 'invalid address' });
    }

    if (route === 'login' && request.method === 'POST') {
      const body = await readBody(request);
      const token = await login(
        config.sessionSecret,
        String(body.address ?? ''),
        String(body.nonce ?? ''),
        String(body.signature ?? '') as `0x${string}`,
      );
      return token ? json(200, { token }) : json(401, { error: 'Signature check failed.' });
    }

    if (route === 'chat' && request.method === 'POST') {
      return await handleChat(config, request);
    }

    return json(405, { error: 'method not allowed' });
  } catch (err) {
    console.error(`[agent] ${route} failed`, err);
    return json(500, { error: 'server error' });
  }
}

async function handleChat(config: Config, request: Request): Promise<Response> {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  const owner = sessionAddress(config.sessionSecret, token);
  if (!owner) return json(401, { error: 'Sign in first.' });

  const body = await readBody(request);
  const vaultRaw = String(body.vault ?? '');
  const message = String(body.message ?? '').trim().slice(0, 2000);
  const history = (Array.isArray(body.history) ? body.history : []).filter(
    (t): t is ChatTurn => !!t && (t.role === 'user' || t.role === 'assistant') && typeof t.text === 'string',
  );
  if (!isAddress(vaultRaw) || !message) return json(400, { error: 'vault and message are required' });
  const vault = getAddress(vaultRaw);

  // The caller must own this vault, and this server must be its agent
  const [vaultOwner, vaultAgent] = await Promise.all([
    publicClient.readContract({ address: vault, abi: vaultAbi, functionName: 'owner' }),
    publicClient.readContract({ address: vault, abi: vaultAbi, functionName: 'agent' }),
  ]).catch(() => [null, null] as const);
  if (!vaultOwner || getAddress(vaultOwner) !== owner) return json(403, { error: 'You don\'t own this agent wallet.' });
  if (!vaultAgent || getAddress(vaultAgent) !== config.agentAddress) {
    return json(409, { error: 'This agent wallet is revoked or points at a different agent.' });
  }

  const now = Date.now();
  const times = (recent.get(owner) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (times.length >= RATE_MAX) return json(429, { error: 'Too many requests — wait a minute.' });
  if (busy.has(owner)) return json(429, { error: 'Still working on your previous request.' });
  recent.set(owner, [...times, now]);

  busy.add(owner);
  try {
    const result = await runAgent({ apiKey: config.anthropicKey, agentKey: config.agentKey, vault, message, history });
    return json(200, result);
  } catch (err) {
    console.error('[agent] run failed', err);
    return json(500, { error: 'The agent hit an error. Nothing further was executed.' });
  } finally {
    busy.delete(owner);
  }
}

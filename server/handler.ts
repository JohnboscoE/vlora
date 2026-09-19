// Agent API as a plain Web Request → Response handler, shared by the Vercel
// functions in /api/agent and the local dev server (server/local.ts).
import Anthropic from '@anthropic-ai/sdk';
import { BaseError, getAddress, isAddress, type Address } from 'viem';
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
// Tolerate common paste mistakes in dashboard env vars: whitespace, newlines, wrapping quotes
function env(name: string): string {
  return (process.env[name] ?? '').trim().replace(/^["']|["']$/g, '').trim();
}

function getConfig(): Config | string {
  const anthropicKey = env('ANTHROPIC_API_KEY');
  let agentKey = env('AGENT_PRIVATE_KEY');
  if (/^[0-9a-fA-F]{64}$/.test(agentKey)) agentKey = `0x${agentKey}`; // accept a key without 0x
  const sessionSecret = env('SESSION_SECRET');
  // Messages name the variable only — never its value
  if (!anthropicKey) return 'ANTHROPIC_API_KEY is not set';
  if (!agentKey) return 'AGENT_PRIVATE_KEY is not set';
  if (!/^0x[0-9a-fA-F]{64}$/.test(agentKey)) return 'AGENT_PRIVATE_KEY is not a valid private key (expected 0x + 64 hex characters)';
  if (!sessionSecret) return 'SESSION_SECRET is not set';
  if (sessionSecret.length < 32) return 'SESSION_SECRET is too short (use 32+ characters)';
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
    return json(503, { error: `The agent server is not configured yet: ${config}.` });
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
    return json(500, { error: `The agent hit an error (${describeError(err)}). Nothing further was executed.` });
  } finally {
    busy.delete(owner);
  }
}

/**
 * A short, secret-free description of why the agent failed, so problems are
 * diagnosable from the chat without server log access. SDK error messages
 * don't contain API keys.
 */
function describeError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return 'AI provider rejected ANTHROPIC_API_KEY (401) — check the key';
  if (err instanceof Anthropic.PermissionDeniedError) return 'AI provider: this API key lacks access (403)';
  if (err instanceof Anthropic.NotFoundError) return 'AI provider: model not found (404)';
  if (err instanceof Anthropic.RateLimitError) return 'AI provider rate limit or no credit (429) — check your Anthropic plan/credits';
  if (err instanceof Anthropic.BadRequestError) return `AI provider rejected the request (400): ${err.message.slice(0, 160)}`;
  if (err instanceof Anthropic.APIConnectionTimeoutError) return 'AI provider timed out';
  if (err instanceof Anthropic.APIConnectionError) return 'could not reach the AI provider';
  if (err instanceof Anthropic.APIError) return `AI provider error ${err.status ?? ''}`.trim();
  if (err instanceof BaseError) return `blockchain RPC: ${err.shortMessage.slice(0, 160)}`;
  if (err instanceof Error) return `${err.name}: ${err.message.slice(0, 160)}`;
  return 'unknown error';
}

import { AGENT_API } from '@/agent-config';
import { readJson, writeJson } from './storage';

export interface AgentAction {
  kind: 'send' | 'swap';
  summary: string;
  txHash?: string;
  explorerUrl?: string;
  status: 'success' | 'failed';
}

export interface AgentReply {
  reply: string;
  actions: AgentAction[];
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${AGENT_API}${path}`, init);
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(body.error ?? `Agent server error (${res.status})`);
  return body as T;
}

/** The agent server's signing address, needed to create a vault. Null if the server is unreachable. */
export async function getAgentInfo(): Promise<{ agent: `0x${string}` } | null> {
  try {
    return await call<{ agent: `0x${string}` }>('/info');
  } catch (err) {
    console.error('[vlora] agent server unreachable:', err instanceof Error ? err.message : err);
    return null;
  }
}

// Session tokens are per wallet and only live in this browser
const sessionKey = (address: string) => `vlora-agent-session-${address.toLowerCase()}`;

/**
 * Returns a session for this wallet, asking the wallet to sign a free login
 * message only when there isn't one yet.
 */
export async function ensureSession(address: `0x${string}`, sign: (message: string) => Promise<`0x${string}`>): Promise<string> {
  const cached = readJson<string | null>(sessionKey(address), null);
  if (cached) return cached;
  const { nonce, message } = await call<{ nonce: string; message: string }>(`/nonce?address=${address}`);
  const signature = await sign(message);
  const { token } = await call<{ token: string }>('/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ address, nonce, signature }),
  });
  writeJson(sessionKey(address), token);
  return token;
}

export function clearSession(address: string) {
  writeJson(sessionKey(address), null);
}

export async function agentChat(
  token: string,
  vault: `0x${string}`,
  message: string,
  history: { role: 'user' | 'assistant'; text: string }[],
): Promise<AgentReply> {
  return call<AgentReply>('/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ vault, message, history }),
  });
}

// Wallet sign-in for the agent API. Only a vault's owner may instruct its agent,
// so every chat request carries a session proving control of an address.
import { randomBytes } from 'node:crypto';
import { getAddress, isAddress, verifyMessage, type Address } from 'viem';

const NONCE_TTL_MS = 5 * 60_000;
const SESSION_TTL_MS = 12 * 60 * 60_000;

const nonces = new Map<string, { address: Address; expires: number }>();
const sessions = new Map<string, { address: Address; expires: number }>();

export function loginMessage(address: Address, nonce: string): string {
  // Human-readable so the wallet shows the user exactly what they're signing
  return [
    'Sign in to the Vlora agent.',
    '',
    'This lets the agent server accept instructions for agent wallets you own.',
    'It is not a transaction and costs nothing.',
    '',
    `Wallet: ${address}`,
    `Nonce: ${nonce}`,
  ].join('\n');
}

export function issueNonce(rawAddress: string): { nonce: string; message: string } | null {
  if (!isAddress(rawAddress)) return null;
  const address = getAddress(rawAddress);
  const nonce = randomBytes(16).toString('hex');
  nonces.set(nonce, { address, expires: Date.now() + NONCE_TTL_MS });
  return { nonce, message: loginMessage(address, nonce) };
}

export async function login(rawAddress: string, nonce: string, signature: `0x${string}`): Promise<string | null> {
  if (!isAddress(rawAddress)) return null;
  const address = getAddress(rawAddress);
  const entry = nonces.get(nonce);
  nonces.delete(nonce); // single use
  if (!entry || entry.expires < Date.now() || entry.address !== address) return null;

  const valid = await verifyMessage({ address, message: loginMessage(address, nonce), signature }).catch(() => false);
  if (!valid) return null;

  const token = randomBytes(32).toString('hex');
  sessions.set(token, { address, expires: Date.now() + SESSION_TTL_MS });
  return token;
}

export function sessionAddress(token: string | undefined): Address | null {
  if (!token) return null;
  const s = sessions.get(token);
  if (!s || s.expires < Date.now()) {
    sessions.delete(token);
    return null;
  }
  return s.address;
}

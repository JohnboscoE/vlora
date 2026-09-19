// Wallet sign-in for the agent API — stateless, so it works across serverless
// instances (Vercel) as well as the local server. Nonces and sessions are
// HMAC-signed with SESSION_SECRET instead of being kept in memory.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { getAddress, isAddress, verifyMessage, type Address } from 'viem';

const NONCE_TTL_MS = 5 * 60_000;
const SESSION_TTL_MS = 12 * 60 * 60_000;

function sign(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

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

/** nonce = "<issuedAtMs>.<random>.<hmac(address|issuedAt|random)>" — verifiable without storage */
export function issueNonce(secret: string, rawAddress: string): { nonce: string; message: string } | null {
  if (!isAddress(rawAddress)) return null;
  const address = getAddress(rawAddress);
  const issuedAt = Date.now().toString();
  const rand = randomBytes(12).toString('base64url');
  const nonce = `${issuedAt}.${rand}.${sign(secret, `nonce|${address}|${issuedAt}|${rand}`)}`;
  return { nonce, message: loginMessage(address, nonce) };
}

/** Returns a session token if the signature proves control of the address */
export async function login(secret: string, rawAddress: string, nonce: string, signature: `0x${string}`): Promise<string | null> {
  if (!isAddress(rawAddress)) return null;
  const address = getAddress(rawAddress);

  const [issuedAt, rand, mac] = nonce.split('.');
  if (!issuedAt || !rand || !mac) return null;
  if (!safeEqual(mac, sign(secret, `nonce|${address}|${issuedAt}|${rand}`))) return null;
  const age = Date.now() - Number(issuedAt);
  if (!(age >= 0 && age <= NONCE_TTL_MS)) return null;

  const valid = await verifyMessage({ address, message: loginMessage(address, nonce), signature }).catch(() => false);
  if (!valid) return null;

  const expires = (Date.now() + SESSION_TTL_MS).toString();
  return `${address}.${expires}.${sign(secret, `session|${address}|${expires}`)}`;
}

export function sessionAddress(secret: string, token: string | undefined | null): Address | null {
  if (!token) return null;
  const [rawAddress, expires, mac] = token.split('.');
  if (!rawAddress || !expires || !mac || !isAddress(rawAddress)) return null;
  const address = getAddress(rawAddress);
  if (!safeEqual(mac, sign(secret, `session|${address}|${expires}`))) return null;
  if (Number(expires) < Date.now()) return null;
  return address;
}

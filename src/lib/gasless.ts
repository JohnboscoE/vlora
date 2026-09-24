/**
 * Gasless USDC sends: the wallet signs an EIP-3009 TransferWithAuthorization
 * (no transaction, no gas), and server/gasless.ts hands it to Circle's
 * Facilitator Service, which submits the transfer and pays the network fee.
 *
 * The signature authorizes exactly one transfer (this amount, this recipient, a
 * random nonce) and expires after AUTH_VALIDITY_S, so it can't be reused.
 */
import { useEffect, useState } from 'react';
import { readContract } from 'wagmi/actions';
import { config } from '@/config';
import { ACTIVE_CHAIN_ID } from '@/chain-env';
import { getUsdc } from '@/onchain-facts';

const API = '/api/gasless';
/** How long a signed authorization can be settled for */
export const AUTH_VALIDITY_S = 10 * 60;

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

/** Arc USDC's EIP-712 domain (verified against DOMAIN_SEPARATOR() on both networks) */
export function usdcDomain() {
  const usdc = getUsdc(ACTIVE_CHAIN_ID);
  if (!usdc) return null;
  return { name: 'USDC', version: '2', chainId: ACTIVE_CHAIN_ID, verifyingContract: usdc.address as `0x${string}` } as const;
}

export interface TransferAuthorization {
  from: `0x${string}`;
  to: `0x${string}`;
  value: bigint;
  validAfter: bigint;
  validBefore: bigint;
  nonce: `0x${string}`;
}

export function buildAuthorization(from: `0x${string}`, to: `0x${string}`, value: bigint): TransferAuthorization {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const nonce: `0x${string}` = `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
  return { from, to, value, validAfter: 0n, validBefore: BigInt(Math.floor(Date.now() / 1000) + AUTH_VALIDITY_S), nonce };
}

export type SettleResult =
  | { status: 'success'; transaction: `0x${string}` }
  /** Unknown yet: the transfer may still land, so never fall back to a second send */
  | { status: 'pending'; reason: string }
  /** Rejected before Circle recorded it: nothing moved. disable: retrying won't help */
  | { status: 'rejected'; reason: string; disable?: boolean };

export async function settleGasless(auth: TransferAuthorization, signature: `0x${string}`): Promise<SettleResult> {
  let res: Response;
  try {
    res = await fetch(`${API}/settle`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ authorization: auth, signature }, (_, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)),
    });
  } catch {
    // The request may or may not have reached the server
    return { status: 'pending', reason: 'lost connection to the server' };
  }
  const data = (await res.json().catch(() => null)) as SettleResult | null;
  if (data && (data.status === 'success' || data.status === 'pending' || data.status === 'rejected')) return data;
  return res.status >= 500 ? { status: 'pending', reason: `server error ${res.status}` } : { status: 'rejected', reason: `server error ${res.status}` };
}

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

/** Whether USDC has consumed this authorization (i.e. the transfer happened) */
export async function authorizationUsed(auth: TransferAuthorization): Promise<boolean | null> {
  const usdc = getUsdc(ACTIVE_CHAIN_ID);
  if (!usdc) return null;
  try {
    return await readContract(config, {
      address: usdc.address as `0x${string}`,
      abi: authorizationStateAbi,
      functionName: 'authorizationState',
      args: [auth.from, auth.nonce],
      chainId: ACTIVE_CHAIN_ID,
    });
  } catch {
    return null;
  }
}

let cached: Promise<boolean> | null = null;

/** After Circle refuses on policy grounds, stop offering gasless for this session */
export function disableGaslessForSession() {
  cached = Promise.resolve(false);
}

/** Whether this deployment has Circle gasless sends turned on (CIRCLE_API_KEY set) */
export function fetchGaslessEnabled(): Promise<boolean> {
  cached ??= fetch(`${API}/info`)
    .then(async (res) => {
      if (!res.ok) return false;
      const info = (await res.json()) as { enabled?: boolean; chainId?: number; reason?: string };
      if (!info.enabled && info.reason) console.info(`[vlora] gasless sends off: ${info.reason}`);
      return info.enabled === true && info.chainId === ACTIVE_CHAIN_ID;
    })
    .catch(() => false);
  return cached;
}

export function useGaslessEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let alive = true;
    void fetchGaslessEnabled().then((v) => alive && setEnabled(v));
    return () => {
      alive = false;
    };
  }, []);
  return enabled;
}

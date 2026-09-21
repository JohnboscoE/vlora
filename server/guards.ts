// The agent's deterministic safety checks, kept pure so they can be unit-tested
// (server/guards.test.ts). The model's output is untrusted: these decide what runs.
import { formatUnits, parseUnits } from 'viem';

/**
 * Recipients the owner typed in THIS message. An address or .arc name that only
 * appears in chat history, a tool result, or the model's reply is never allowed.
 */
export class RecipientGuard {
  private readonly addresses: Set<string>;
  private readonly names: Set<string>;

  constructor(ownerMessage: string) {
    // Whole 40-hex addresses only: a pasted 64-hex tx hash doesn't make its prefix payable
    this.addresses = new Set((ownerMessage.match(/\b0x[a-fA-F0-9]{40}\b/g) ?? []).map((a) => a.toLowerCase()));
    this.names = new Set((ownerMessage.match(/\b[a-z0-9-]{3,32}(?=\.arc\b)/gi) ?? []).map((n) => n.toLowerCase()));
  }

  /** Whether the owner typed this .arc name (label without ".arc") */
  typedName(label: string): boolean {
    return this.names.has(label.toLowerCase());
  }

  /** Record what a typed name resolved to on-chain; names the owner didn't type are ignored */
  allowResolvedName(label: string, address: string): boolean {
    if (!this.typedName(label)) return false;
    this.addresses.add(address.toLowerCase());
    return true;
  }

  isAllowed(address: string): boolean {
    return this.addresses.has(address.toLowerCase());
  }
}

/** Whole-token amount → base units, or a reason it isn't valid */
export function parseTokenAmount(raw: string, decimals: number, symbol: string): bigint | string {
  const cleaned = raw.trim().replace(/,/g, '');
  if (!new RegExp(`^\\d+(\\.\\d{1,${decimals}})?$`).test(cleaned)) return `"${raw}" is not a valid ${symbol} amount`;
  const value = parseUnits(cleaned, decimals);
  return value > 0n ? value : 'amount must be greater than 0';
}

export interface VaultLimits {
  active: boolean;
  perTx: bigint;
  perDay: bigint;
  /** v2 vaults: perDay minus everything spent in the last 24h (rolling window) */
  remaining: bigint;
  /**
   * v1 vaults (calendar-day buckets) only: spent today + spent yesterday. v1 resets at
   * midnight on-chain, so the server enforces the rolling bound itself: any 24h period
   * lies within those two days, so keeping their sum ≤ perDay keeps every window ≤ perDay.
   */
  legacyTwoDaySpent?: bigint;
}

/** null if the agent may spend `amount`, otherwise why not */
export function limitProblem(
  limits: VaultLimits,
  amount: bigint,
  token: { symbol: string; decimals: number },
  betaMaxPerDay: number | null,
): string | null {
  const fmt = (v: bigint) => `${formatUnits(v, token.decimals)} ${token.symbol}`;
  if (!limits.active) return 'the agent is paused, revoked or expired for this vault';
  if (limits.perDay === 0n) return `${token.symbol} is not enabled for this agent wallet`;
  if (betaMaxPerDay != null && limits.perDay > parseUnits(String(betaMaxPerDay), token.decimals)) {
    return `this agent wallet's daily limit is above the mainnet beta cap of ${betaMaxPerDay} ${token.symbol}; lower it to use the agent`;
  }
  if (amount > limits.perTx) return `over the per-transaction limit of ${fmt(limits.perTx)}`;
  if (amount > limits.remaining) return `over the remaining 24-hour allowance of ${fmt(limits.remaining)}`;
  if (limits.legacyTwoDaySpent != null && limits.legacyTwoDaySpent + amount > limits.perDay) {
    const left = limits.perDay > limits.legacyTwoDaySpent ? limits.perDay - limits.legacyTwoDaySpent : 0n;
    return `over the remaining 24-hour allowance of ${fmt(left)} (older agent wallet: create a new one for the on-chain rolling limit)`;
  }
  return null;
}

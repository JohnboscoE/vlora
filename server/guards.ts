// The agent's deterministic safety checks, kept pure so they can be unit-tested
// (server/guards.test.ts). The model's output is untrusted: these decide what runs.
import { formatUnits, parseUnits } from 'viem';

/** The digits that identify a phone or meter number, however it was written */
function significantDigits(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  // "08031234567", "+2348031234567" and "8031234567" are one line: country codes
  // and a trunk zero differ, the subscriber number doesn't, so compare the tail
  return digits.slice(-9);
}

/**
 * Recipients the OWNER typed. An address, .arc name, phone number or meter number
 * that only appears in a tool result, a name record, a page the agent fetched, or
 * the model's own reply is never allowed — otherwise text the agent merely read
 * could choose who gets paid.
 *
 * The owner's earlier turns count, because the owner typed those too: "send 0.5 to
 * john.arc and 0.5 to jona.arc" followed by "yes, go ahead" is one instruction
 * split across two messages, and refusing the second half taught people that names
 * don't work. What stays excluded is everything the owner did not type, which is
 * the whole boundary. Only owner turns may be passed in `alsoTyped` — never an
 * assistant turn, and never a tool result.
 */
export class RecipientGuard {
  private readonly addresses: Set<string>;
  private readonly names: Set<string>;
  private readonly numbers: Set<string>;

  constructor(ownerMessage: string, alsoTyped: string[] = []) {
    const typed = [ownerMessage, ...alsoTyped].join('\n');
    // Whole 40-hex addresses only: a pasted 64-hex tx hash doesn't make its prefix payable
    this.addresses = new Set((typed.match(/\b0x[a-fA-F0-9]{40}\b/g) ?? []).map((a) => a.toLowerCase()));
    this.names = new Set((typed.match(/\b[a-z0-9-]{3,32}(?=\.arc\b)/gi) ?? []).map((n) => n.toLowerCase()));
    // Phone and meter numbers. Addresses go first so their digits can't be read
    // as a line to top up.
    const withoutAddresses = typed.replace(/0x[a-fA-F0-9]+/g, ' ');
    this.numbers = new Set(
      (withoutAddresses.match(/\+?\d[\d\s().-]{5,20}\d/g) ?? [])
        .map((candidate) => significantDigits(candidate))
        .filter((digits): digits is string => digits != null),
    );
  }

  /** Whether the owner typed this phone or meter number in the current message */
  typedNumber(value: string): boolean {
    const digits = significantDigits(value);
    return digits != null && this.numbers.has(digits);
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

import { describe, expect, it } from 'vitest';
import { limitProblem, parseTokenAmount, RecipientGuard, type VaultLimits } from './guards';

const ALICE = '0x1111111111111111111111111111111111111111';
const MALLORY = '0x2222222222222222222222222222222222222222';
const USDC = { symbol: 'USDC', decimals: 6 };
const usdc = (n: number) => BigInt(Math.round(n * 1e6));

describe('RecipientGuard — recipients must come from the owner, not the model', () => {
  it('allows an address the owner typed', () => {
    expect(new RecipientGuard(`send 5 USDC to ${ALICE}`).isAllowed(ALICE)).toBe(true);
  });

  it('is case-insensitive for addresses', () => {
    expect(new RecipientGuard(`send 5 USDC to ${ALICE.toUpperCase().replace('0X', '0x')}`).isAllowed(ALICE)).toBe(true);
  });

  it('rejects an address the model proposes that the owner never typed', () => {
    expect(new RecipientGuard(`send 5 USDC to ${ALICE}`).isAllowed(MALLORY)).toBe(false);
  });

  it('rejects an address that appears only in chat history (only the latest message counts)', () => {
    // The guard is built from the owner's latest message alone; history is never passed in
    const guard = new RecipientGuard('send the same again');
    expect(guard.isAllowed(ALICE)).toBe(false);
  });

  it('does not treat the prefix of a pasted 64-hex hash as an address', () => {
    const hash = `0x${'ab'.repeat(32)}`;
    const guard = new RecipientGuard(`what happened with ${hash}?`);
    expect(guard.isAllowed(hash.slice(0, 42))).toBe(false);
  });

  it('allows a .arc name the owner typed once it resolves', () => {
    const guard = new RecipientGuard('pay james.arc 3 USDC');
    expect(guard.allowResolvedName('james', ALICE)).toBe(true);
    expect(guard.isAllowed(ALICE)).toBe(true);
  });

  it('rejects a .arc name the model suggests but the owner did not type', () => {
    const guard = new RecipientGuard('pay james.arc 3 USDC');
    expect(guard.allowResolvedName('mallory', MALLORY)).toBe(false);
    expect(guard.isAllowed(MALLORY)).toBe(false);
  });

  it('does not match a typed name inside a longer one', () => {
    const guard = new RecipientGuard('pay notjames.arc 3 USDC');
    expect(guard.typedName('james')).toBe(false);
    expect(guard.typedName('notjames')).toBe(true);
  });
});

describe('parseTokenAmount', () => {
  it('parses whole and decimal amounts', () => {
    expect(parseTokenAmount('2.5', 6, 'USDC')).toBe(2_500_000n);
    expect(parseTokenAmount('1,000', 6, 'USDC')).toBe(1_000_000_000n);
  });

  it('rejects too many decimals, negatives, zero and junk', () => {
    expect(parseTokenAmount('1.0000001', 6, 'USDC')).toBeTypeOf('string');
    expect(parseTokenAmount('-1', 6, 'USDC')).toBeTypeOf('string');
    expect(parseTokenAmount('0', 6, 'USDC')).toBeTypeOf('string');
    expect(parseTokenAmount('1e6', 6, 'USDC')).toBeTypeOf('string');
  });
});

describe('limitProblem — server-side caps', () => {
  const v2: VaultLimits = { active: true, perTx: usdc(2), perDay: usdc(5), remaining: usdc(5) };

  it('allows a spend within all limits', () => {
    expect(limitProblem(v2, usdc(2), USDC, 50)).toBeNull();
  });

  it('blocks inactive agents, disabled tokens, per-tx and window overruns', () => {
    expect(limitProblem({ ...v2, active: false }, usdc(1), USDC, 50)).toMatch(/paused|revoked|expired/);
    expect(limitProblem({ ...v2, perDay: 0n }, usdc(1), USDC, 50)).toMatch(/not enabled/);
    expect(limitProblem(v2, usdc(2.000001), USDC, 50)).toMatch(/per-transaction/);
    expect(limitProblem({ ...v2, remaining: usdc(1) }, usdc(1.5), USDC, 50)).toMatch(/24-hour/);
  });

  it('refuses vaults whose daily limit is above the mainnet beta cap', () => {
    expect(limitProblem({ ...v2, perDay: usdc(51), perTx: usdc(51), remaining: usdc(51) }, usdc(1), USDC, 50)).toMatch(/beta cap/);
    expect(limitProblem({ ...v2, perDay: usdc(50), remaining: usdc(50) }, usdc(1), USDC, 50)).toBeNull();
    expect(limitProblem({ ...v2, perDay: usdc(500), remaining: usdc(500) }, usdc(1), USDC, null)).toBeNull();
  });

  describe('v1 vaults (calendar-day reset on-chain)', () => {
    // 23:59: the agent spent the full 5 "today". 00:01: on-chain, v1 shows 5 remaining again.
    const afterMidnight: VaultLimits = { ...v2, remaining: usdc(5), legacyTwoDaySpent: usdc(5) };

    it('holds the cap across the midnight boundary even though the contract reset', () => {
      expect(limitProblem(afterMidnight, usdc(0.01), USDC, 50)).toMatch(/24-hour/);
    });

    it('allows the unspent part of the cap', () => {
      expect(limitProblem({ ...afterMidnight, legacyTwoDaySpent: usdc(3) }, usdc(2), USDC, 50)).toBeNull();
      expect(limitProblem({ ...afterMidnight, legacyTwoDaySpent: usdc(3.5) }, usdc(1.51), USDC, 50)).toMatch(/24-hour/);
    });
  });
});

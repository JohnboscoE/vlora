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

  it('rejects an address that appears nowhere the owner typed', () => {
    const guard = new RecipientGuard('send the same again');
    expect(guard.isAllowed(ALICE)).toBe(false);
  });

  // An instruction and its confirmation are often two messages. The owner typed
  // both, so both count — which is what makes "yes, go ahead" work.
  it('accepts an address the owner typed in an earlier turn of their own', () => {
    const guard = new RecipientGuard('yes, go ahead', [`send 5 USDC to ${ALICE}`]);
    expect(guard.isAllowed(ALICE)).toBe(true);
  });

  it('still refuses an address that only the assistant or a tool produced', () => {
    // Only owner turns are ever passed as `alsoTyped`; this is what the caller filters for
    const guard = new RecipientGuard('yes, go ahead', ['send 5 USDC to alice']);
    expect(guard.isAllowed(MALLORY)).toBe(false);
  });

  it('carries a .arc name across the owner\'s own turns', () => {
    const guard = new RecipientGuard('/send', ['Send 0.5 USDC to john.arc. Send 0.5 USDC to jona.arc']);
    expect(guard.typedName('john')).toBe(true);
    expect(guard.typedName('jona')).toBe(true);
    expect(guard.typedName('mallory')).toBe(false);
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

describe('RecipientGuard — phone and meter numbers', () => {
  // A bill is delivered to a number, so the number is the recipient: text the agent
  // merely read must never be able to choose whose phone gets topped up.
  it('allows a number the owner typed', () => {
    const guard = new RecipientGuard('buy 500 airtime for 08031234567');
    expect(guard.typedNumber('08031234567')).toBe(true);
  });

  it('treats the same line written differently as the same number', () => {
    const guard = new RecipientGuard('buy 500 airtime for 0803 123 4567');
    for (const written of ['08031234567', '+2348031234567', '2348031234567', '803-123-4567']) {
      expect(guard.typedNumber(written)).toBe(true);
    }
  });

  it('rejects a number the owner never typed', () => {
    const guard = new RecipientGuard('buy 500 airtime for 08031234567');
    expect(guard.typedNumber('08099999999')).toBe(false);
    expect(guard.typedNumber('+2348099999999')).toBe(false);
  });

  it('rejects a number that only appeared earlier in the conversation', () => {
    expect(new RecipientGuard('do that again').typedNumber('08031234567')).toBe(false);
    // ...but a number the owner typed themselves a turn earlier still counts
    expect(new RecipientGuard('do that again', ['top up 08031234567']).typedNumber('08031234567')).toBe(true);
  });

  it('allows a meter number the owner typed', () => {
    const guard = new RecipientGuard('pay 5000 electricity for meter 04123456789 on ikeja');
    expect(guard.typedNumber('04123456789')).toBe(true);
  });

  it('does not read an amount as a number to pay', () => {
    const guard = new RecipientGuard('buy 5000 airtime');
    expect(guard.typedNumber('5000')).toBe(false);
  });

  it('does not read the digits of an address as a phone number', () => {
    const digits = '0x1234567890123456789012345678901234567890';
    const guard = new RecipientGuard(`send 5 USDC to ${digits}`);
    expect(guard.typedNumber('1234567890')).toBe(false);
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

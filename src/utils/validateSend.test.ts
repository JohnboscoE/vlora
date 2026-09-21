import { describe, expect, it } from 'vitest';
import { validateBatch, validateSend } from './validateSend';
import type { BatchIntent, SendIntent } from './intentParser';

// Tests run with the default network (Arc Testnet): USDC, EURC, cirBTC
const ALICE = '0x1111111111111111111111111111111111111111';
const BOB = '0x2222222222222222222222222222222222222222';
const send = (amount: string, token = 'USDC', recipient = ALICE): SendIntent =>
  ({ type: 'send', amount, token, recipient });

describe('validateSend — every send is gated before the wallet sees it', () => {
  const balances = { USDC: 10_000_000n, EURC: 1_000_000n };

  it('accepts a valid send within balance', () => {
    const check = validateSend(send('2.5'), balances);
    expect(check.ok).toBe(true);
    if (check.ok) expect(check.amount.raw).toBe(2_500_000n);
  });

  it('fails closed when the balance could not be read', () => {
    const check = validateSend(send('1'), {});
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toMatch(/Couldn't read/);
  });

  it('rejects amounts above the balance, zero, and too many decimals', () => {
    expect(validateSend(send('10.000001'), balances).ok).toBe(false);
    expect(validateSend(send('0'), balances).ok).toBe(false);
    expect(validateSend(send('1.0000001'), balances).ok).toBe(false);
  });

  it('rejects unknown tokens instead of falling back to USDC', () => {
    const check = validateSend(send('1', 'DOGE'), balances);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toMatch(/isn't supported/);
  });

  it('rejects a missing or malformed recipient', () => {
    expect(validateSend(send('1', 'USDC', ''), balances).ok).toBe(false);
    expect(validateSend(send('1', 'USDC', '0x1234'), balances).ok).toBe(false);
  });

  it('checks each token against its own balance', () => {
    expect(validateSend(send('1', 'EURC'), balances).ok).toBe(true);
    expect(validateSend(send('1.01', 'EURC'), balances).ok).toBe(false);
  });
});

describe('validateBatch', () => {
  const batch = (items: { recipient: string; amount: string }[]): BatchIntent =>
    ({ type: 'batch', token: 'USDC', items, problems: [] }) as unknown as BatchIntent;

  it('accepts a batch whose total fits the balance', () => {
    const check = validateBatch(batch([{ recipient: ALICE, amount: '3' }, { recipient: BOB, amount: '4' }]), 10_000_000n);
    expect(check.ok).toBe(true);
  });

  it('rejects a batch whose total exceeds the balance', () => {
    const check = validateBatch(batch([{ recipient: ALICE, amount: '6' }, { recipient: BOB, amount: '5' }]), 10_000_000n);
    expect(check.ok).toBe(false);
  });

  it('fails closed without a balance', () => {
    expect(validateBatch(batch([{ recipient: ALICE, amount: '1' }]), undefined).ok).toBe(false);
  });
});

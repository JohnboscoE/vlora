import { describe, expect, it } from 'vitest';
import { cleanAmount, depositProblem, orderProblem } from './offramp';

// The cash-out route decides where a user's money goes, so these are the checks
// that have to hold before an order is created and before anything is bridged.

const good = {
  amount: '10',
  currency: 'NGN',
  institution: 'GTBINGLA',
  accountIdentifier: '1234567890',
  accountName: 'JOHN DOE',
  refundAddress: '0x5051DB0F8b6bd4B2e1B1fc0dc0B93c0a23A48312',
};

const ok = (payload: Record<string, unknown>) => orderProblem(payload, 100);
const problem = (payload: Record<string, unknown>) => {
  const result = orderProblem(payload, 100);
  return 'problem' in result ? result.problem : null;
};

describe('cleanAmount', () => {
  it('accepts amounts inside the ceiling, up to 6 decimals', () => {
    expect(cleanAmount('10', 100)).toBe('10');
    expect(cleanAmount('1.234567', 100)).toBe('1.234567');
    expect(cleanAmount('100', 100)).toBe('100');
  });

  it('refuses amounts below the floor or above the ceiling', () => {
    expect(cleanAmount('0.4', 100)).toBeNull();
    expect(cleanAmount('100.01', 100)).toBeNull();
    expect(cleanAmount('1000', 100)).toBeNull();
  });

  it('refuses anything that is not a plain decimal', () => {
    for (const bad of ['', ' ', '1e3', '-5', '10,5', '1.2345678', 'ten', '0x10', null, undefined, 10]) {
      expect(cleanAmount(bad, 100)).toBeNull();
    }
  });
});

describe('orderProblem', () => {
  it('passes a complete order through, normalising case', () => {
    const result = ok({ ...good, currency: 'ngn', institution: 'gtbingla' });
    expect('order' in result).toBe(true);
    if (!('order' in result)) return;
    expect(result.order.currency).toBe('NGN');
    expect(result.order.institution).toBe('GTBINGLA');
    expect(result.order.memo).toBe('');
  });

  it('requires a refund address that can receive a refund', () => {
    expect(problem({ ...good, refundAddress: '' })).toMatch(/refund address/i);
    expect(problem({ ...good, refundAddress: '0x123' })).toMatch(/refund address/i);
    expect(problem({ ...good, refundAddress: 'not-an-address' })).toMatch(/refund address/i);
  });

  it('rejects a missing or malformed bank, account or name', () => {
    expect(problem({ ...good, institution: '' })).toMatch(/bank/i);
    expect(problem({ ...good, institution: 'gtb bank!' })).toMatch(/bank/i);
    expect(problem({ ...good, accountIdentifier: '123' })).toMatch(/account number/i);
    expect(problem({ ...good, accountIdentifier: '12345678901234567890123456789012345678901' })).toMatch(/account number/i);
    expect(problem({ ...good, accountName: 'X' })).toMatch(/account name/i);
  });

  it('rejects an amount outside the beta ceiling', () => {
    expect(problem({ ...good, amount: '500' })).toMatch(/between/i);
    expect(problem({ ...good, amount: '0' })).toMatch(/between/i);
  });

  it('keeps mobile-money and Paybill identifiers', () => {
    const result = ok({ ...good, currency: 'KES', institution: 'SAFAKEPC', accountIdentifier: '254712345678' });
    expect('order' in result).toBe(true);
    const paybill = ok({ ...good, currency: 'KES', institution: 'SAFAKEPC', accountIdentifier: '400200|12345' });
    expect('order' in paybill).toBe(true);
  });

  it('keeps at most three well-formed provider ids and drops the rest', () => {
    const result = ok({ ...good, providerIds: ['AbCdEfGh', 'IjKlMnOp', 'QrStUvWx', 'YzAbCdEf', 'no!', 1] });
    expect('order' in result).toBe(true);
    if (!('order' in result)) return;
    expect(result.order.providerIds).toEqual(['AbCdEfGh', 'IjKlMnOp', 'QrStUvWx']);
  });

  it('trims a memo to something a bank narration can hold', () => {
    const result = ok({ ...good, memo: 'x'.repeat(200) });
    if (!('order' in result)) throw new Error('expected a valid order');
    expect(result.order.memo).toHaveLength(100);
  });
});

describe('depositProblem', () => {
  const account = { network: 'base', receiveAddress: '0x5051DB0F8b6bd4B2e1B1fc0dc0B93c0a23A48312' };

  it('accepts an order that says where to deposit', () => {
    expect(depositProblem({ id: 'abc-123', providerAccount: account })).toBeNull();
  });

  it('refuses a deposit on the wrong network', () => {
    expect(depositProblem({ id: 'abc-123', providerAccount: { ...account, network: 'solana' } })).toMatch(/not on base/);
  });

  it('refuses a deposit address that is not an address', () => {
    expect(depositProblem({ id: 'abc-123', providerAccount: { ...account, receiveAddress: 'send it to me' } })).toMatch(/not an address/);
    expect(depositProblem({ id: 'abc-123', providerAccount: { network: 'base' } })).toMatch(/not an address/);
  });

  it('refuses an order with no id to track', () => {
    expect(depositProblem({ providerAccount: account })).toMatch(/no id/);
    expect(depositProblem(null)).toMatch(/no id/);
  });
});

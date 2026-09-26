import { describe, expect, it } from 'vitest';
import { invoiceProblem, paymentProblem } from './bills';

// A bill payment buys something for a phone number or meter and can't be undone,
// so these are the checks that run before an invoice is created and before the
// app pays one.

const good = {
  productId: 'mtn-nigeria',
  packageId: 'mtn-nigeria<&>1000',
  recipient: '+2348012345678',
  refundAddress: '0x5051DB0F8b6bd4B2e1B1fc0dc0B93c0a23A48312',
};

const problem = (payload: Record<string, unknown>) => {
  const result = invoiceProblem(payload);
  return 'problem' in result ? result.problem : null;
};

describe('invoiceProblem', () => {
  it('accepts a package purchase', () => {
    const result = invoiceProblem(good);
    expect('invoice' in result).toBe(true);
    if (!('invoice' in result)) return;
    expect(result.invoice.packageId).toBe('mtn-nigeria<&>1000');
    expect(result.invoice.recipient).toBe('+2348012345678');
  });

  it('accepts a ranged purchase and a meter number', () => {
    const result = invoiceProblem({ ...good, packageId: '', value: '2500', recipient: '04123456789' });
    expect('invoice' in result).toBe(true);
    if (!('invoice' in result)) return;
    expect(result.invoice.value).toBe('2500');
    expect(result.invoice.packageId).toBeUndefined();
  });

  it('strips spaces and brackets people paste into a phone number', () => {
    const result = invoiceProblem({ ...good, recipient: '+234 (801) 234-5678' });
    if (!('invoice' in result)) throw new Error('expected a valid invoice');
    expect(result.invoice.recipient).toBe('+2348012345678');
  });

  it('refuses a package that belongs to a different product', () => {
    expect(problem({ ...good, packageId: 'airtel-nigeria<&>1000' })).toMatch(/does not belong/i);
  });

  it('requires an amount', () => {
    expect(problem({ ...good, packageId: '', value: '' })).toMatch(/amount/i);
    expect(problem({ ...good, packageId: '', value: 'lots' })).toMatch(/not a number/i);
  });

  it('refuses a missing product or recipient', () => {
    expect(problem({ ...good, productId: '' })).toMatch(/pick something/i);
    expect(problem({ ...good, productId: '../../admin' })).toMatch(/pick something/i);
    expect(problem({ ...good, recipient: '12' })).toMatch(/phone or meter/i);
    expect(problem({ ...good, recipient: 'drop table users' })).toMatch(/phone or meter/i);
  });

  it('requires a refund address for a crypto invoice', () => {
    expect(problem({ ...good, refundAddress: '' })).toMatch(/refund address/i);
    expect(problem({ ...good, refundAddress: '0xnope' })).toMatch(/refund address/i);
  });
});

describe('paymentProblem', () => {
  const payment = { address: '0x5051DB0F8b6bd4B2e1B1fc0dc0B93c0a23A48312', price: 0.68, currency: 'USDC' };

  it('accepts a USDC invoice inside the ceiling', () => {
    const result = paymentProblem({ id: 'inv_1', payment }, 100);
    expect('payment' in result).toBe(true);
    if (!('payment' in result)) return;
    expect(result.payment.price).toBe('0.68');
    expect(result.id).toBe('inv_1');
  });

  it('refuses an invoice priced above the ceiling', () => {
    const result = paymentProblem({ id: 'inv_1', payment: { ...payment, price: 250 } }, 100);
    expect('problem' in result && result.problem).toMatch(/above the 100 USDC limit/);
  });

  it('refuses an invoice in another currency', () => {
    const result = paymentProblem({ id: 'inv_1', payment: { ...payment, currency: 'BTC' } }, 100);
    expect('problem' in result && result.problem).toMatch(/not USDC/);
  });

  it('refuses a payment address that is not an address', () => {
    const result = paymentProblem({ id: 'inv_1', payment: { ...payment, address: 'bc1qthrlhrdtk8vv7p25cmwat87kg' } }, 100);
    expect('problem' in result && result.problem).toMatch(/not an address/);
  });

  it('refuses an invoice with no price or no id', () => {
    expect('problem' in paymentProblem({ id: 'inv_1', payment: { ...payment, price: 0 } }, 100)).toBe(true);
    expect('problem' in paymentProblem({ payment }, 100)).toBe(true);
    expect('problem' in paymentProblem(null, 100)).toBe(true);
  });
});

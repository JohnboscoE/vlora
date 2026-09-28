import { describe, expect, it } from 'vitest';
import { parseBill, parseCashOut, parseSweep } from './moneyIntent';

// These decide what a typed message means before any money is quoted, so the
// cases that matter are the ones where a wrong reading would cost someone: an
// account number read as an amount, a question read as an order.

describe('parseCashOut', () => {
  it('reads the amount, bank and account number', () => {
    const intent = parseCashOut('cash out 20 USDC to gtbank 0123456789');
    expect(intent).toMatchObject({ type: 'cashout', amount: '20', bankQuery: 'gtbank', accountNumber: '0123456789', currency: 'NGN' });
  });

  it('never reads the account number as the amount', () => {
    for (const text of [
      'withdraw 15 to access bank 0123456789',
      'cash out 15 usdc to my access bank account 0123456789',
      'cash out to access bank 0123456789 15 usdc',
    ]) {
      expect(parseCashOut(text)?.amount).toBe('15');
      expect(parseCashOut(text)?.accountNumber).toBe('0123456789');
    }
  });

  it('strips filler words out of the bank name', () => {
    expect(parseCashOut('cash out 10 usdc to my gtb account 0123456789')?.bankQuery).toBe('gtb');
    expect(parseCashOut('withdraw 10 to the first bank account no 3011234567')?.bankQuery).toBe('first');
  });

  it('picks up other payout currencies', () => {
    expect(parseCashOut('cash out 10 usdc to kcb 1234567890 in kenyan shillings')?.currency).toBe('KES');
    expect(parseCashOut('withdraw 10 usdc to stanbic 1234567890 ugx')?.currency).toBe('UGX');
    expect(parseCashOut('cash out 5 usdc to gtbank 0123456789')?.currency).toBe('NGN');
  });

  it('keeps decimals', () => {
    expect(parseCashOut('cash out 12.50 usdc to gtbank 0123456789')?.amount).toBe('12.50');
  });

  it('ignores messages that are not cash-outs', () => {
    expect(parseCashOut('send 10 USDC to 0x1234567890123456789012345678901234567890')).toBeNull();
    expect(parseCashOut('what is my balance')).toBeNull();
    expect(parseCashOut('swap 10 usdc for eurc')).toBeNull();
  });

  it('returns null when there is no account number to pay', () => {
    expect(parseCashOut('cash out 20 usdc')).toBeNull();
    expect(parseCashOut('how do I cash out to my bank?')).toBeNull();
  });
});

describe('parseBill', () => {
  it('reads airtime for a phone number', () => {
    expect(parseBill('buy 500 airtime for 08012345678')).toMatchObject({
      type: 'bill',
      category: 'airtime',
      amount: '500',
      recipient: '08012345678',
      country: 'NG',
    });
  });

  it('reads the amount when the phone number comes first', () => {
    expect(parseBill('recharge 08012345678 with 1000')).toMatchObject({ category: 'airtime', amount: '1000', recipient: '08012345678' });
    expect(parseBill('top up 08012345678 1000')).toMatchObject({ amount: '1000', recipient: '08012345678' });
  });

  it('keeps an international number intact', () => {
    expect(parseBill('buy 500 airtime for +2348012345678')?.recipient).toBe('+2348012345678');
  });

  it('tells data from airtime', () => {
    expect(parseBill('buy 1000 data for 08012345678')?.category).toBe('data');
    expect(parseBill('buy 2gb data for 08012345678')?.category).toBe('data');
  });

  it('reads electricity with a meter number and a disco', () => {
    expect(parseBill('pay 5000 electricity for meter 04123456789 on ikeja')).toMatchObject({
      category: 'electricity',
      amount: '5000',
      recipient: '04123456789',
      providerQuery: 'ikeja',
    });
    expect(parseBill('pay 2000 nepa bill for 1234567890')?.category).toBe('electricity');
  });

  it('reads TV subscriptions', () => {
    expect(parseBill('pay 8000 for dstv 1234567890')).toMatchObject({ category: 'tv', amount: '8000', providerQuery: 'dstv' });
  });

  it('picks up the operator when one is named', () => {
    expect(parseBill('buy 500 mtn airtime for 08012345678')?.providerQuery).toBe('mtn');
    expect(parseBill('buy 500 airtime for 08012345678 with glo')?.providerQuery).toBe('glo');
  });

  it('follows the country when the message says one', () => {
    expect(parseBill('buy 100 airtime for 0712345678 in kenya')?.country).toBe('KE');
  });

  it('leaves questions alone', () => {
    expect(parseBill('how do I buy airtime?')).toBeNull();
    expect(parseBill('can you pay electricity bills?')).toBeNull();
    expect(parseBill('what is airtime')).toBeNull();
  });

  it('ignores a bill with nothing to pay for or pay to', () => {
    expect(parseBill('buy airtime')).toBeNull();
    expect(parseBill('buy 500 airtime')).toBeNull();
    expect(parseBill('send 10 usdc to 0x1234567890123456789012345678901234567890')).toBeNull();
  });
});

describe('parseSweep — emptying a wallet needs both "all" and a destination', () => {
  const ADDRESS = '0x1234567890123456789012345678901234567890';

  it('reads a sweep with an address', () => {
    for (const text of [
      `send everything to ${ADDRESS}`,
      `move all my funds to ${ADDRESS}`,
      `transfer all my assets to ${ADDRESS}`,
      `sweep my wallet to ${ADDRESS}`,
      `empty my wallet to ${ADDRESS}`,
    ]) {
      expect(parseSweep(text)).toEqual({ type: 'sweep', to: ADDRESS });
    }
  });

  it('refuses without a destination — the dangerous half of the sentence', () => {
    expect(parseSweep('send everything')).toBeNull();
    expect(parseSweep('move all my funds')).toBeNull();
    expect(parseSweep('sweep my wallet')).toBeNull();
  });

  it('leaves an ordinary send alone', () => {
    expect(parseSweep(`send 10 USDC to ${ADDRESS}`)).toBeNull();
    expect(parseSweep(`pay 5 EURC to ${ADDRESS}`)).toBeNull();
  });

  it('leaves questions alone', () => {
    expect(parseSweep('how do I send everything to another wallet?')).toBeNull();
    expect(parseSweep('can i move all my assets?')).toBeNull();
  });
});

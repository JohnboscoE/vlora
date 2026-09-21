import { describe, expect, it } from 'vitest';
import { parseCsvBatch, parseIntent } from './intentParser';

const ALICE = '0x1111111111111111111111111111111111111111';
const BOB = '0x2222222222222222222222222222222222222222';

describe('parseIntent', () => {
  it('parses a send with amount, token and recipient', () => {
    expect(parseIntent(`send 5 USDC to ${ALICE}`)).toMatchObject({ type: 'send', amount: '5', token: 'USDC', recipient: ALICE });
  });

  it('parses EURC sends', () => {
    expect(parseIntent(`send 2.5 EURC to ${ALICE}`)).toMatchObject({ type: 'send', amount: '2.5', token: 'EURC' });
  });

  it('parses several recipients as one batch', () => {
    const intent = parseIntent(`send 10 USDC to ${ALICE}, 25 to ${BOB}`);
    expect(intent.type).toBe('batch');
    if (intent.type === 'batch') expect(intent.items.map((i) => i.amount)).toEqual(['10', '25']);
  });

  it('parses swaps', () => {
    expect(parseIntent('swap 10 USDC for EURC')).toMatchObject({ type: 'swap', amountIn: '10', tokenIn: 'USDC', tokenOut: 'EURC' });
  });

  it('parses balance checks', () => {
    expect(parseIntent("what's my balance?").type).toBe('balance');
  });

  it('answers questions about a feature instead of acting on them', () => {
    expect(parseIntent('how do I swap on uniswap?').type).toBe('question');
  });

  it('never turns small talk into a transaction', () => {
    for (const text of ['hi', 'hello', 'thanks']) {
      expect(['chat', 'unknown']).toContain(parseIntent(text).type);
    }
  });
});

describe('parseCsvBatch', () => {
  it('reads address,amount rows and reports bad ones', () => {
    const batch = parseCsvBatch(`${ALICE}, 10\n${BOB},2.5\nnot-an-address, 3`);
    expect(batch.items.map((i) => i.amount)).toEqual(['10', '2.5']);
    expect(batch.problems.length).toBeGreaterThan(0);
  });
});

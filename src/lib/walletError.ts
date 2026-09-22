import { BaseError } from 'viem';
import { ACTIVE_CHAIN } from '@/chain-env';

/**
 * A short, human reason a wallet action failed — never a generic "failed", so the
 * user (and we) can see what actually went wrong. The full error goes to the console.
 */
export function describeWalletError(err: unknown): string {
  console.error('[vlora] wallet action failed', err);
  const raw = err instanceof Error ? err.message : String(err);
  const msg = raw.toLowerCase();
  if (msg.includes('user rejected') || msg.includes('user denied') || msg.includes('rejected the request')) return 'Cancelled in your wallet.';
  if (err instanceof BaseError && err.name === 'ChainMismatchError') {
    return `Your wallet is on a different network. Switch it to ${ACTIVE_CHAIN.name} and try again.`;
  }
  if (msg.includes('does not match the target chain') || msg.includes('chain mismatch')) {
    return `Your wallet is on a different network. Switch it to ${ACTIVE_CHAIN.name} and try again.`;
  }
  if (msg.includes('insufficient funds') || msg.includes('exceeds balance') || msg.includes('insufficient balance')) {
    return ACTIVE_CHAIN.isTestnet
      ? 'Not enough USDC (gas on Arc is paid in USDC). Get test USDC from faucet.circle.com.'
      : 'Not enough USDC — on Arc, gas is paid in USDC too, so leave a little for the fee.';
  }
  if (msg.includes('out of gas') || msg.includes('intrinsic gas')) return 'The transaction ran out of gas. Try again.';
  // viem's shortMessage (plus the revert reason when there is one) is readable and secret-free
  if (err instanceof BaseError) {
    const detail = err.details && !err.shortMessage.includes(err.details) ? ` — ${err.details}` : '';
    return `${err.shortMessage}${detail}`.slice(0, 220);
  }
  return (raw.split('\n')[0] ?? '').slice(0, 220) || 'The wallet returned an error.';
}

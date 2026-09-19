import type { TransactionReceipt } from 'viem';
import { getPublicClient } from 'wagmi/actions';
import { config } from '@/config';
import { ACTIVE_CHAIN_ID } from '@/chain-env';

export type TxOutcome =
  | { outcome: 'success'; receipt: TransactionReceipt }
  | { outcome: 'reverted'; receipt: TransactionReceipt; outOfGas: boolean }
  /** The network never saw the transaction — the wallet likely failed to broadcast it */
  | { outcome: 'dropped' }
  | { outcome: 'timeout' };

const RECEIPT_TIMEOUT_MS = 60_000;
/** If Arc still doesn't know the hash after this long, it was never broadcast */
const DROPPED_AFTER_MS = 20_000;
const POLL_MS = 1_500;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Waits for a submitted transaction, and always settles: success, reverted,
 * dropped (never reached the chain), or timeout. Uses viem's public client
 * directly — wagmi's wrapper throws on a revert instead of returning the receipt.
 */
export async function watchTx(hash: `0x${string}`): Promise<TxOutcome> {
  const client = getPublicClient(config, { chainId: ACTIVE_CHAIN_ID });
  if (!client) return { outcome: 'timeout' };

  const receiptWatch: Promise<TxOutcome> = client
    .waitForTransactionReceipt({ hash, timeout: RECEIPT_TIMEOUT_MS, pollingInterval: POLL_MS })
    .then(async (receipt): Promise<TxOutcome> => {
      if (receipt.status === 'success') return { outcome: 'success', receipt };
      // A revert that used all its gas almost always means the gas limit was too low
      let outOfGas = false;
      try {
        const tx = await client.getTransaction({ hash });
        outOfGas = receipt.gasUsed >= tx.gas;
      } catch {
        // best effort only
      }
      return { outcome: 'reverted', receipt, outOfGas };
    })
    .catch((): TxOutcome => ({ outcome: 'timeout' }));

  // Resolves only if the chain never learns about the hash
  const droppedWatch = (async (): Promise<TxOutcome> => {
    const deadline = Date.now() + DROPPED_AFTER_MS;
    while (Date.now() < deadline) {
      await sleep(POLL_MS);
      try {
        await client.getTransaction({ hash });
        return new Promise<TxOutcome>(() => {}); // seen: let the receipt decide
      } catch {
        // not found (yet)
      }
    }
    return { outcome: 'dropped' };
  })();

  return Promise.race([receiptWatch, droppedWatch]);
}

/**
 * Finish what the history log started.
 *
 * A bill or a cash-out is recorded as pending the moment it is paid, but it
 * settles at the provider a minute or two later. The panels polled while they
 * were open; a payment made from the chat had nobody watching it, so it sat at
 * "in progress" forever even though it had long since been delivered.
 *
 * This watches every pending entry that carries a provider reference — including
 * ones from a previous visit, since the log is stored — and writes the real
 * outcome back. It reads only; the money has already moved.
 */
import { loadActivity, updateActivity, type ActivityEntry } from '@/lib/activity';
import { fetchBillInvoice, isFinalInvoiceStatus } from '@/lib/bills';
import { fetchOfframpOrder, isFinalStatus } from '@/lib/offramp';

/** How often to ask. Bitrefill allows 60 reads per invoice per 10 minutes. */
const EVERY_MS = 30_000;
/** Stop watching an entry this old: it is never going to change now */
const GIVE_UP_AFTER_MS = 6 * 60 * 60 * 1000;

const BILL_KINDS = new Set(['airtime', 'utilities']);

function pending(address: string | undefined): ActivityEntry[] {
  const now = Date.now();
  return loadActivity(address).filter(
    (entry) => entry.status === 'pending' && entry.reference != null && now - entry.at < GIVE_UP_AFTER_MS,
  );
}

async function settle(address: string, entry: ActivityEntry): Promise<void> {
  const reference = entry.reference;
  if (!reference) return;
  try {
    if (BILL_KINDS.has(entry.kind)) {
      const invoice = await fetchBillInvoice(reference);
      if (!isFinalInvoiceStatus(invoice.status)) return;
      updateActivity(address, entry.id, { status: invoice.status === 'complete' ? 'success' : 'failed' });
      return;
    }
    if (entry.kind === 'cashout') {
      const order = await fetchOfframpOrder(reference);
      if (!isFinalStatus(order.status)) return;
      updateActivity(address, entry.id, { status: order.status === 'settled' ? 'success' : 'failed' });
    }
  } catch {
    // The provider or the network is having a moment; the next tick tries again
  }
}

/**
 * Start watching this wallet's unfinished payments. Returns a stop function.
 */
export function watchPendingActivity(address: string | undefined): () => void {
  if (!address) return () => undefined;
  let alive = true;
  const tick = async () => {
    const outstanding = pending(address);
    if (outstanding.length === 0 || !alive) return;
    // One at a time: these are provider APIs with their own rate limits
    for (const entry of outstanding) {
      if (!alive) return;
      await settle(address, entry);
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), EVERY_MS);
  return () => {
    alive = false;
    clearInterval(timer);
  };
}

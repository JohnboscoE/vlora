/**
 * The two flows that move money through another company: cashing out to a bank
 * (Paycrest) and paying a bill (Bitrefill). Both are the same shape —
 *
 *   1. ask them for an order/invoice, which names an address and an exact price
 *   2. check that what came back is what we asked for
 *   3. bridge exactly that from Arc, one signature (src/lib/bridge.ts)
 *   4. record it so "/history" has a receipt
 *
 * — so they live here rather than inside a panel, and the chat and the panels
 * run the very same code.
 */
import type { Address } from 'viem';
import { bridgeOut, BRIDGE_CHAIN_LABEL } from '@/lib/bridge';
import { createOfframpOrder, orderTotal, type OfframpOrder } from '@/lib/offramp';
import { amountToPay, createBillInvoice, type BillCategory, type BillInvoice } from '@/lib/bills';
import { recordActivity, updateActivity } from '@/lib/activity';
import type { ResolvedBill, ResolvedCashOut } from '@/lib/resolveMoneyIntent';

/** Progress worth telling the user about, as it happens */
export type StepReport = (message: string) => void;

export interface CashOutRun {
  order: OfframpOrder;
  /** The activity-log entry, so the caller can follow it to settled */
  entryId: string;
  txHash?: string;
}

export async function runCashOut(address: Address, plan: ResolvedCashOut, onStep: StepReport = () => {}): Promise<CashOutRun> {
  onStep('Getting a payout quote…');
  const order = await createOfframpOrder({
    amount: plan.amount,
    currency: plan.currency,
    institution: plan.institution,
    accountIdentifier: plan.accountNumber,
    accountName: plan.accountName,
    // Refunds land on the settlement network, so this is the user's own address there
    refundAddress: address,
    providerIds: plan.providerIds,
  });

  // The order decides how much leaves the wallet: check it against what was
  // agreed before bridging. Fees are cents; more than a few percent is not our order.
  const total = orderTotal(order);
  if (Number(order.amount) !== Number(plan.amount) || Number(total) > Number(plan.amount) * 1.05) {
    throw new Error(`The payout quote came back as ${total} USDC instead of ${plan.amount}. Nothing was sent.`);
  }
  const quoted = order.providerAccount.amountToTransfer;
  if (quoted && Math.abs(Number(quoted) - Number(total)) > 1e-6) {
    throw new Error(`The payout account asked for ${quoted} USDC, not ${total}. Nothing was sent.`);
  }

  const entryId = recordActivity(address, {
    kind: 'cashout',
    status: 'pending',
    title: `Cashed out ${plan.amount} USDC to ${plan.bankName}`,
    amount: total,
    token: 'USDC',
    counterparty: plan.accountNumber,
    detail: `${plan.bankName} · ${plan.accountName}`,
    fiat: { currency: plan.currency, amount: plan.payout, rate: plan.rate },
    fee: (Number(total) - Number(order.amount)).toFixed(6).replace(/\.?0+$/, ''),
    reference: order.id,
  });

  onStep(`Sending ${total} USDC to the payout account on ${BRIDGE_CHAIN_LABEL}…`);
  try {
    const result = await bridgeOut(order.providerAccount.receiveAddress, total);
    if (result.state === 'error') throw new Error('The transfer did not complete. Nothing was paid out.');
    if (result.sourceTxHash) updateActivity(address, entryId, { txHash: result.sourceTxHash });
    return { order, entryId, ...(result.sourceTxHash ? { txHash: result.sourceTxHash } : {}) };
  } catch (err) {
    updateActivity(address, entryId, { status: 'failed' });
    throw err;
  }
}

export interface BillRun {
  invoice: BillInvoice;
  entryId: string;
  txHash?: string;
}

const KIND: Record<BillCategory, 'airtime' | 'utilities'> = {
  airtime: 'airtime',
  data: 'airtime',
  electricity: 'utilities',
  tv: 'utilities',
};

export async function runBillPayment(address: Address, plan: ResolvedBill, onStep: StepReport = () => {}): Promise<BillRun> {
  onStep('Getting a price from Bitrefill…');
  const created = await createBillInvoice({
    productId: plan.product.id,
    ...(plan.packageId ? { packageId: plan.packageId } : {}),
    ...(plan.value ? { value: plan.value } : {}),
    recipient: plan.recipient,
    refundAddress: address,
  });

  const total = amountToPay(created.payment.price);
  const entryId = recordActivity(address, {
    kind: KIND[plan.category],
    status: 'pending',
    title: `Paid ${plan.label} for ${plan.recipient}`,
    amount: total,
    token: 'USDC',
    counterparty: plan.recipient,
    detail: `${plan.product.name} · ${plan.product.country}`,
    ...(plan.packageId || plan.value
      ? { fiat: { currency: plan.product.currency, amount: plan.value ?? plan.product.packages.find((p) => p.id === plan.packageId)?.value ?? '' } }
      : {}),
    reference: created.id,
  });

  onStep(`Paying ${total} USDC on ${BRIDGE_CHAIN_LABEL}…`);
  try {
    const result = await bridgeOut(created.payment.address, total);
    if (result.state === 'error') throw new Error('The payment did not complete. Nothing was delivered.');
    if (result.sourceTxHash) updateActivity(address, entryId, { txHash: result.sourceTxHash });
    return { invoice: created.invoice, entryId, ...(result.sourceTxHash ? { txHash: result.sourceTxHash } : {}) };
  } catch (err) {
    updateActivity(address, entryId, { status: 'failed' });
    throw err;
  }
}

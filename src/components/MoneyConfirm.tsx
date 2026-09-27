import { Banknote, Loader2, Receipt } from 'lucide-react';
import { ACTIVE_CHAIN } from '@/chain-env';
import { BRIDGE_CHAIN_LABEL } from '@/lib/bridge';
import type { ResolvedBill, ResolvedCashOut } from '@/lib/resolveMoneyIntent';
import { cn } from '@/lib/utils';

/** What the chat is holding, ready to run */
export type MoneyPlan = { kind: 'cashout'; plan: ResolvedCashOut } | { kind: 'bill'; plan: ResolvedBill };

interface MoneyConfirmProps {
  pending: MoneyPlan;
  onConfirm: () => void;
  onCancel: () => void;
  busy: boolean;
  /** What the run is doing right now, if it has started */
  step?: string;
}

const money = (value: string | number, currency: string) =>
  `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${currency}`;

/**
 * The confirmation for a cash-out or a bill typed into the chat. It exists so
 * the answer to "cash out 20 USDC to gtbank 0123456789" is one look and one
 * press — the panels are for browsing, not for the common case.
 */
export function MoneyConfirm({ pending, onConfirm, onCancel, busy, step }: MoneyConfirmProps) {
  const rows: [string, string][] =
    pending.kind === 'cashout'
      ? [
          ['They receive', money(pending.plan.payout, pending.plan.currency)],
          ['Account', `${pending.plan.accountName} · ${pending.plan.accountNumber}`],
          ['Bank', pending.plan.bankName],
          ['Rate', `${money(pending.plan.rate, pending.plan.currency)} per USDC`],
          ['You pay', `${pending.plan.amount} USDC`],
        ]
      : [
          ['Buying', pending.plan.label],
          ['For', pending.plan.recipient],
          ['Delivered by', `Bitrefill · ${pending.plan.product.country}`],
        ];

  const title = pending.kind === 'cashout' ? 'Cash out to a bank' : 'Pay with USDC';
  const Icon = pending.kind === 'cashout' ? Banknote : Receipt;

  return (
    <div className="rounded-3xl border border-line/10 bg-surface/90 p-4 backdrop-blur">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
        <Icon className="size-4 text-brand" /> {title}
      </h3>

      <dl className="mt-3 space-y-1.5 text-xs">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-3">
            <dt className="shrink-0 text-muted">{label}</dt>
            <dd className="truncate text-right font-medium text-ink">{value}</dd>
          </div>
        ))}
      </dl>

      <p className="mt-3 text-[11px] leading-relaxed text-subtle">
        {pending.kind === 'cashout'
          ? `Paycrest pays the bank. They don't accept ${ACTIVE_CHAIN.name} yet, so your USDC goes to their account on ${BRIDGE_CHAIN_LABEL} first — one signature, and the detour goes when they add ${ACTIVE_CHAIN.name}. A refund, if no provider takes it, lands on ${BRIDGE_CHAIN_LABEL}.`
          : `Bitrefill delivers straight to that number. Check it before you confirm — a top-up can't be undone.`}
      </p>

      {busy ? (
        <p className="mt-3 flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2.5 text-xs text-muted">
          <Loader2 className="size-3.5 shrink-0 animate-spin" /> {step || 'Working…'}
        </p>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button onClick={onCancel} className="rounded-xl border border-line/15 py-2.5 text-xs font-semibold text-ink">
            Cancel
          </button>
          <button onClick={onConfirm} className={cn('rounded-xl bg-primary py-2.5 text-xs font-semibold text-primary-ink')}>
            Confirm
          </button>
        </div>
      )}
    </div>
  );
}

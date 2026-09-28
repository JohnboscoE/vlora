import { useState } from 'react';
import { AlertTriangle, Loader2, Send } from 'lucide-react';
import { ACTIVE_CHAIN } from '@/chain-env';
import { cn } from '@/lib/utils';

export interface SweepLine {
  symbol: string;
  /** Whole tokens, as it will be sent */
  amount: string;
  /** For the gas token, what is deliberately left behind */
  reserved?: string;
}

export interface SweepPlan {
  to: `0x${string}`;
  /** A .arc name or saved contact, when the address came from one */
  label?: string;
  lines: SweepLine[];
}

interface SweepConfirmProps {
  plan: SweepPlan;
  onConfirm: () => void;
  onCancel: () => void;
  busy: boolean;
  step?: string;
}

/**
 * Confirming a sweep.
 *
 * Every other confirmation in Vlora is one press, because every other action
 * leaves you with something. This one doesn't, and it cannot be undone, so it
 * asks for the last four characters of the destination to be typed. That is not
 * friction for its own sake: it is the one check that catches the mistake that
 * actually happens — a wrong address that looks right at a glance.
 */
export function SweepConfirm({ plan, onConfirm, onCancel, busy, step }: SweepConfirmProps) {
  const [typed, setTyped] = useState('');
  const tail = plan.to.slice(-4);
  const matches = typed.trim().toLowerCase() === tail.toLowerCase();

  return (
    <div className="rounded-3xl border border-danger/30 bg-surface/95 p-4 backdrop-blur">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
        <AlertTriangle className="size-4 text-danger" /> Send everything
      </h3>

      <p className="mt-2 text-xs leading-relaxed text-muted">
        This empties your wallet on {ACTIVE_CHAIN.name} and cannot be undone. Check the address character by character — nobody can
        return it for you.
      </p>

      <div className="mt-3 rounded-xl bg-surface-2 px-3 py-2.5">
        <p className="text-[11px] text-muted">To{plan.label ? ` · ${plan.label}` : ''}</p>
        {/* The whole address, never truncated: truncation is how people miss a swap */}
        <p className="mt-1 break-all font-mono text-[11px] leading-relaxed text-ink">{plan.to}</p>
      </div>

      <dl className="mt-3 space-y-1.5 text-xs">
        {plan.lines.map((line) => (
          <div key={line.symbol} className="flex justify-between gap-3">
            <dt className="text-muted">{line.symbol}</dt>
            <dd className="text-right font-medium text-ink">
              {line.amount}
              {line.reserved && <span className="block text-[11px] font-normal text-subtle">{line.reserved} left for fees</span>}
            </dd>
          </div>
        ))}
      </dl>

      {busy ? (
        <p className="mt-3 flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2.5 text-xs text-muted">
          <Loader2 className="size-3.5 shrink-0 animate-spin" /> {step || 'Working…'}
        </p>
      ) : (
        <>
          <label className="mt-3 block text-[11px] text-muted">
            Type the last four characters of the address ({tail}) to confirm
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              aria-label="Last four characters of the destination address"
              className="mt-1 w-full rounded-xl border border-line/15 bg-surface px-3 py-2 font-mono text-sm text-ink outline-none focus:border-danger/50"
            />
          </label>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <button onClick={onCancel} className="rounded-xl border border-line/15 py-2.5 text-xs font-semibold text-ink">
              Cancel
            </button>
            <button
              onClick={onConfirm}
              disabled={!matches}
              className={cn(
                'flex items-center justify-center gap-2 rounded-xl bg-danger py-2.5 text-xs font-semibold text-white',
                !matches && 'opacity-40',
              )}
            >
              <Send className="size-3.5" /> Send everything
            </button>
          </div>
        </>
      )}
    </div>
  );
}

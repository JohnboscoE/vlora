import { useEffect, useState } from 'react';
import { readContract } from 'wagmi/actions';
import { AtSign, Check, ChevronDown, Loader2, X } from 'lucide-react';
import { config } from '@/config';
import { ACTIVE_CHAIN_ID } from '@/chain-env';
import { ARC_NAME_LABEL_RE, ARC_NAME_MAX_YEARS, arcNamesAbi, getArcNamesAddress } from '@/arcnames-config';
import { normalizeArcLabel } from '@/lib/arcNames';
import { cn } from '@/lib/utils';
import { formatUsdcFee, useArcNameFee } from '@/lib/arcNameFee';

type Availability = 'idle' | 'invalid' | 'checking' | 'available' | 'taken' | 'error';

interface ClaimNameCardProps {
  onClaim: (label: string, years: number) => void;
  /** Mobile: starts as a one-line prompt that expands */
  collapsible?: boolean;
}

// Shown to connected wallets without a .arc name. Availability is read live;
// claiming opens the normal confirmation sheet (simulated, fee shown, then signed).
export function ClaimNameCard({ onClaim, collapsible = false }: ClaimNameCardProps) {
  const [open, setOpen] = useState(!collapsible);
  const [input, setInput] = useState('');
  const [years, setYears] = useState(1);
  const label = normalizeArcLabel(input);
  const yearlyFee = useArcNameFee();
  const contract = getArcNamesAddress(ACTIVE_CHAIN_ID);
  const checkable = !!label && ARC_NAME_LABEL_RE.test(label) && !!contract;

  // Result of the last on-chain check, tagged with the label it was for
  const [checked, setChecked] = useState<{ label: string; status: Availability } | null>(null);
  const status: Availability = !label
    ? 'idle'
    : !ARC_NAME_LABEL_RE.test(label)
      ? 'invalid'
      : !contract
        ? 'error'
        : checked?.label === label
          ? checked.status
          : 'checking';

  // Debounced on-chain availability check
  useEffect(() => {
    if (!checkable || !contract) return;
    let cancelled = false;
    const setStatus = (s: Availability) => setChecked({ label, status: s });
    const check = async () => {
      try {
        const available = await readContract(config, {
          address: contract,
          abi: arcNamesAbi,
          functionName: 'isAvailable',
          args: [label],
          chainId: ACTIVE_CHAIN_ID,
        });
        if (!cancelled) setStatus(available ? 'available' : 'taken');
      } catch (err) {
        console.error('[vlora] name availability check failed', err);
        if (!cancelled) setStatus('error');
      }
    };
    const t = setTimeout(() => void check(), 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [label, checkable, contract]);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-between gap-2 rounded-2xl border border-brand/20 bg-brand/5 px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2.5 text-sm font-medium text-ink">
          <AtSign className="size-4 text-brand" /> Claim your .arc name
        </span>
        <ChevronDown className="size-4 text-muted" />
      </button>
    );
  }

  return (
    <section className="rounded-3xl border border-brand/20 bg-gradient-to-br from-brand/10 via-surface/80 to-surface/80 p-5 backdrop-blur">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <AtSign className="size-4 text-brand" /> Claim your .arc name
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-muted">Get paid at a name instead of a 0x address.{yearlyFee != null ? ` ${formatUsdcFee(yearlyFee)} / year.` : ''}</p>
        </div>
        {collapsible && (
          <button onClick={() => setOpen(false)} aria-label="Hide" className="text-subtle hover:text-ink">
            <X className="size-4" />
          </button>
        )}
      </div>

      <form
        className="mt-4 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (status === 'available') onClaim(label, years);
        }}
      >
        <div className="flex items-center rounded-xl border border-line/15 bg-surface pr-3 focus-within:border-brand/50">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="yourname"
            aria-label="Name to claim"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={40}
            className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-sm font-medium text-ink outline-none placeholder:text-subtle"
          />
          <span className="text-sm font-semibold text-brand">.arc</span>
        </div>

        <p
          className={cn(
            'flex min-h-4 items-center gap-1.5 text-xs',
            status === 'available' && 'text-success',
            (status === 'taken' || status === 'invalid' || status === 'error') && 'text-danger',
            status === 'checking' && 'text-muted',
          )}
          aria-live="polite"
        >
          {status === 'checking' && (
            <>
              <Loader2 className="size-3 animate-spin" /> Checking {label}.arc…
            </>
          )}
          {status === 'available' && (
            <>
              <Check className="size-3.5" /> {label}.arc is available
            </>
          )}
          {status === 'taken' && `${label}.arc is taken — try another`}
          {status === 'invalid' && '3–32 characters: lowercase letters, numbers, hyphens'}
          {status === 'error' && 'Couldn\'t check right now — try again'}
        </p>

        <div className="flex gap-2">
          <select
            value={years}
            onChange={(e) => setYears(Number(e.target.value))}
            aria-label="Years"
            className="rounded-xl border border-line/15 bg-surface px-2.5 text-sm text-ink outline-none focus:border-brand/50"
          >
            {Array.from({ length: ARC_NAME_MAX_YEARS }, (_, i) => i + 1).map((y) => (
              <option key={y} value={y}>
                {y} yr{y === 1 ? '' : 's'}{yearlyFee != null ? ` · ${formatUsdcFee(yearlyFee * BigInt(y))}` : ''}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={status !== 'available'}
            className="flex-1 rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-ink transition-transform hover:scale-[1.02] disabled:opacity-40 disabled:hover:scale-100"
          >
            Claim
          </button>
        </div>
      </form>
    </section>
  );
}

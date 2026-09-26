import { useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ChevronDown, Loader2, PiggyBank, X } from 'lucide-react';
import { ACTIVE_CHAIN } from '@/chain-env';
import { depositToVault, exploreVaults, getPosition, withdrawFromVault, type EarnPosition, type EarnVault } from '@/lib/earn';
import { describeWalletError } from '@/lib/walletError';
import { cn } from '@/lib/utils';

interface EarnPanelProps {
  collapsible?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const pct = (fraction: number) => `${(fraction * 100).toFixed(2)}%`;

/**
 * Earn: put idle USDC into a lending vault on Arc and take it back out, through
 * Circle's App Kit (src/lib/earn.ts). Non-custodial — the vault contract holds the
 * deposit and your own wallet signs every step.
 */
export function EarnPanel({ collapsible = false, open: openProp, onOpenChange }: EarnPanelProps) {
  const { address, isConnected } = useAccount();
  const queryClient = useQueryClient();
  const [openSelf, setOpenSelf] = useState(!collapsible);
  const open = openProp ?? openSelf;
  const setOpen = (next: boolean) => {
    setOpenSelf(next);
    onOpenChange?.(next);
  };

  const [vaults, setVaults] = useState<EarnVault[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [position, setPosition] = useState<EarnPosition | null>(null);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState<'deposit' | 'withdraw' | null>(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    void exploreVaults().then(
      (list) => {
        if (!alive) return;
        setVaults(list);
        setSelected((current) => current ?? list[0]?.address ?? null);
      },
      (err: unknown) => {
        console.error('[vlora] earn vaults failed', err);
        if (alive) setFailed(true);
      },
    );
    return () => {
      alive = false;
    };
  }, [open]);

  const vault = vaults?.find((v) => v.address === selected) ?? null;

  useEffect(() => {
    if (!open || !vault || !isConnected) return;
    let alive = true;
    void getPosition(vault.address).then(
      (p) => alive && setPosition(p),
      () => alive && setPosition(null),
    );
    return () => {
      alive = false;
    };
  }, [open, vault, isConnected, refresh]);

  const run = async (kind: 'deposit' | 'withdraw') => {
    if (!vault || !amount) return;
    setBusy(kind);
    try {
      const result =
        kind === 'deposit' ? await depositToVault(vault.address, amount) : await withdrawFromVault(vault.address, amount);
      toast.success(
        kind === 'deposit'
          ? `Deposited ${amount} ${vault.asset} into ${vault.name}.`
          : `Withdrew ${amount} ${vault.asset} from ${vault.name}.`,
      );
      console.info('[vlora] earn result', result);
      setAmount('');
      setRefresh((n) => n + 1);
      void queryClient.invalidateQueries();
    } catch (err) {
      toast.error(`${kind === 'deposit' ? 'Deposit' : 'Withdrawal'}: ${describeWalletError(err)}`);
    } finally {
      setBusy(null);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-between gap-2 rounded-2xl border border-line/15 bg-surface/80 px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2.5 text-sm font-medium text-ink">
          <PiggyBank className="size-4 text-brand" /> Earn
          {vault && <span className="text-xs font-semibold text-success">{pct(vault.apy)}</span>}
        </span>
        <ChevronDown className="size-4 text-muted" />
      </button>
    );
  }

  return (
    <section className="rounded-3xl border border-line/10 bg-surface/80 p-5 backdrop-blur">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <PiggyBank className="size-4 text-brand" /> Earn
            <span className="rounded-full bg-brand/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand">Beta</span>
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            Put idle USDC into a lending vault on {ACTIVE_CHAIN.name}. The vault holds it, not Vlora, and you can withdraw any time.
          </p>
        </div>
        {collapsible && (
          <button onClick={() => setOpen(false)} aria-label="Hide" className="text-subtle hover:text-ink">
            <X className="size-4" />
          </button>
        )}
      </div>

      {failed ? (
        <p className="mt-4 rounded-xl bg-danger/10 px-3 py-2 text-xs text-danger">
          Couldn't load vaults right now. If you use an ad or privacy blocker, allow this site's requests and try again.
        </p>
      ) : vaults == null ? (
        <p className="mt-4 flex items-center gap-2 text-xs text-muted">
          <Loader2 className="size-3.5 animate-spin" /> Finding vaults…
        </p>
      ) : vaults.length === 0 ? (
        <p className="mt-4 rounded-xl bg-surface-2 px-3 py-2 text-xs text-muted">No vaults are available on {ACTIVE_CHAIN.name} yet.</p>
      ) : (
        <>
          <label className="mt-4 block text-xs text-muted">
            Vault
            <select
              value={selected ?? ''}
              onChange={(e) => setSelected(e.target.value)}
              className="mt-1 w-full rounded-xl border border-line/15 bg-surface px-3 py-2 text-sm font-medium text-ink outline-none focus:border-brand/50"
            >
              {vaults.map((v) => (
                <option key={v.address} value={v.address}>
                  {v.name} · {pct(v.apy)} · {v.asset}
                </option>
              ))}
            </select>
          </label>

          {vault && (
            <dl className="mt-3 space-y-1.5 text-xs">
              <div className="flex justify-between">
                <dt className="text-muted">Current rate</dt>
                <dd className="font-semibold text-success">{pct(vault.apy)} APY</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">Protocol</dt>
                <dd className="font-medium text-ink-2">{vault.protocol}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">Vault fee</dt>
                <dd className="font-medium text-ink-2">{pct(vault.fee)}</dd>
              </div>
              {position && (
                <div className="flex justify-between border-t border-line/10 pt-1.5">
                  <dt className="text-muted">Your position</dt>
                  <dd className="font-semibold text-ink">
                    {Number(position.balance).toLocaleString(undefined, { maximumFractionDigits: 4 })} {position.asset}
                  </dd>
                </div>
              )}
              {vault.lowLiquidity && <p className="pt-1 text-[11px] text-danger">This vault is low on liquidity — withdrawals may be delayed.</p>}
            </dl>
          )}

          {!isConnected || !address ? (
            <p className="mt-4 rounded-xl bg-surface-2 px-3 py-2 text-xs text-muted">Connect or sign in to deposit.</p>
          ) : (
            <>
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
                inputMode="decimal"
                placeholder={`Amount in ${vault?.asset ?? 'USDC'}`}
                aria-label="Amount"
                className="mt-4 w-full rounded-xl border border-line/15 bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand/50"
              />
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button
                  onClick={() => void run('deposit')}
                  disabled={busy != null || !amount}
                  className={cn(
                    'flex items-center justify-center gap-2 rounded-xl bg-primary py-2.5 text-xs font-semibold text-primary-ink',
                    (busy != null || !amount) && 'opacity-40',
                  )}
                >
                  {busy === 'deposit' && <Loader2 className="size-3.5 animate-spin" />} Deposit
                </button>
                <button
                  onClick={() => void run('withdraw')}
                  disabled={busy != null || !amount || !position}
                  className={cn(
                    'flex items-center justify-center gap-2 rounded-xl border border-line/15 text-xs font-semibold text-ink',
                    (busy != null || !amount || !position) && 'opacity-40',
                  )}
                >
                  {busy === 'withdraw' && <Loader2 className="size-3.5 animate-spin" />} Withdraw
                </button>
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-subtle">
                Rates vary and aren't guaranteed; a lending protocol holds the funds, so there's smart-contract risk. Your wallet signs
                the approval and the deposit. Gas on Arc is paid in USDC.
              </p>
            </>
          )}
        </>
      )}
    </section>
  );
}

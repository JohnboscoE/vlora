import { useEffect, useMemo, useState } from 'react';
import { useAccount, useSwitchChain } from 'wagmi';
import { toast } from 'sonner';
import { Banknote, Check, ChevronDown, Loader2, X } from 'lucide-react';
import { ACTIVE_CHAIN, ACTIVE_CHAIN_ID } from '@/chain-env';
import { BRIDGE_CHAIN_LABEL, bridgeOut, estimateBridgeOut } from '@/lib/bridge';
import {
  createOfframpOrder,
  describeOrderStatus,
  fetchInstitutions,
  fetchOfframpInfo,
  fetchOfframpOrder,
  fetchOfframpQuote,
  isFinalStatus,
  orderTotal,
  verifyAccount,
  type Institution,
  type OfframpInfo,
  type OfframpOrder,
  type OfframpQuote,
} from '@/lib/offramp';
import { recordActivity, updateActivity } from '@/lib/activity';
import { describeWalletError } from '@/lib/walletError';
import { cn } from '@/lib/utils';

interface OfframpPanelProps {
  collapsible?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/** Steps the user walks through; the order matters for the progress copy */
type Stage = 'form' | 'review' | 'working' | 'tracking';

const money = (value: string | number, symbol: string) =>
  `${symbol}${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

/**
 * Cash out USDC to a bank account in local currency, through Paycrest
 * (src/lib/offramp.ts → server/offramp.ts).
 *
 * Paycrest doesn't settle on Arc yet, so the USDC takes a detour through Base:
 * the order gives us an address there, and App Kit's bridge delivers the exact
 * amount to it from the Arc wallet in one signature (src/lib/bridge.ts). Vlora
 * never holds the money at any point.
 */
export function OfframpPanel({ collapsible = false, open: openProp, onOpenChange }: OfframpPanelProps) {
  const { address, isConnected, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const [openSelf, setOpenSelf] = useState(!collapsible);
  const open = openProp ?? openSelf;
  const setOpen = (next: boolean) => {
    setOpenSelf(next);
    onOpenChange?.(next);
  };

  const [info, setInfo] = useState<OfframpInfo | null>(null);
  const [currency, setCurrency] = useState('NGN');
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [institution, setInstitution] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [accountName, setAccountName] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [amount, setAmount] = useState('');
  // Tagged with what it quoted, so a stale rate never shows against a new amount
  const [quote, setQuote] = useState<(OfframpQuote & { for: string }) | null>(null);
  const [bridgeFee, setBridgeFee] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>('form');
  const [order, setOrder] = useState<OfframpOrder | null>(null);
  const [step, setStep] = useState('');
  const [entryId, setEntryId] = useState<string | null>(null);

  const selectedCurrency = info?.currencies.find((c) => c.code === currency);
  const symbol = selectedCurrency?.symbol ?? '';

  useEffect(() => {
    if (!open) return;
    void fetchOfframpInfo().then(setInfo, (err: unknown) => {
      console.error('[vlora] offramp info failed', err);
      setInfo({ enabled: false, reason: 'offline', network: 'base', token: 'USDC', minUsdc: 1, maxUsdc: 100, currencies: [] });
    });
  }, [open]);

  useEffect(() => {
    if (!open || !currency) return;
    let alive = true;
    setInstitutions([]);
    setInstitution('');
    setAccountName('');
    void fetchInstitutions(currency).then(
      (list) => alive && setInstitutions(list),
      () => alive && setInstitutions([]),
    );
    return () => {
      alive = false;
    };
  }, [open, currency]);

  // Live rate, debounced while the amount is being typed
  useEffect(() => {
    const value = Number(amount);
    if (!open || !amount || !Number.isFinite(value) || value <= 0) {
      setQuote(null);
      return;
    }
    const tag = `${amount}:${currency}`;
    let alive = true;
    const timer = setTimeout(() => {
      void fetchOfframpQuote(amount, currency).then(
        (q) => alive && setQuote({ ...q, for: tag }),
        () => alive && setQuote(null),
      );
    }, 350);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [open, amount, currency]);

  const amountProblem = useMemo(() => {
    if (!info || !amount) return null;
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) return 'Enter an amount.';
    if (value < info.minUsdc) return `The smallest cash-out is ${info.minUsdc} USDC.`;
    if (value > info.maxUsdc) return `The most you can cash out at once is ${info.maxUsdc} USDC.`;
    return null;
  }, [info, amount]);

  const ready =
    isConnected && !!address && !!amount && !amountProblem && !!institution && !!accountNumber && !!accountName && !!quote;

  const verify = async () => {
    if (!institution || !accountNumber) return;
    setVerifying(true);
    setAccountName('');
    try {
      const name = await verifyAccount(institution, accountNumber);
      // Some corridors validate the account but can't return a name
      setAccountName(name && name !== 'OK' ? name : 'Account holder');
      if (name === 'OK') toast.info("That account is valid, but this bank doesn't return the holder's name.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't check that account.");
    } finally {
      setVerifying(false);
    }
  };

  const review = () => {
    if (!ready || !address) return;
    setStage('review');
    setBridgeFee(null);
    // The bridge fee is charged on Arc on top of the amount, so show it before confirming
    void estimateBridgeOut(address, amount).then(
      (e) => setBridgeFee(e.fees),
      (err: unknown) => {
        console.error('[vlora] bridge estimate failed', err);
        setBridgeFee(null);
      },
    );
  };

  const confirm = async () => {
    if (!ready || !address || !info) return;
    setStage('working');
    let id: string | null = null;
    let created: OfframpOrder | null = null;
    try {
      if (chainId !== ACTIVE_CHAIN_ID) {
        setStep(`Switching your wallet to ${ACTIVE_CHAIN.name}…`);
        await switchChainAsync({ chainId: ACTIVE_CHAIN_ID });
      }

      setStep('Getting a payout quote…');
      created = await createOfframpOrder({
        amount,
        currency,
        institution,
        accountIdentifier: accountNumber,
        accountName,
        // Refunds go back on the settlement network, so this is the user's own address there
        refundAddress: address,
        providerIds: quote?.providerIds,
      });
      setOrder(created);

      // The order decides how much leaves the wallet, so check it against what the
      // user actually agreed to before bridging. Fees are cents; anything beyond a
      // few percent means we are not looking at the order we asked for.
      const total = orderTotal(created);
      if (Number(created.amount) !== Number(amount) || Number(total) > Number(amount) * 1.05) {
        throw new Error(`The payout quote came back as ${total} USDC instead of ${amount}. Nothing was sent.`);
      }
      const quoted = created.providerAccount.amountToTransfer;
      if (quoted && Math.abs(Number(quoted) - Number(total)) > 1e-6) {
        throw new Error(`The payout account asked for ${quoted} USDC, not ${total}. Nothing was sent.`);
      }
      const bankName = institutions.find((i) => i.code === institution)?.name ?? institution;
      id = recordActivity(address, {
        kind: 'cashout',
        status: 'pending',
        title: `Cashed out ${amount} USDC to ${bankName}`,
        amount: total,
        token: 'USDC',
        counterparty: accountNumber,
        detail: `${bankName} · ${accountName}`,
        fiat: { currency, amount: (Number(created.amount) * Number(created.rate)).toFixed(2), rate: created.rate },
        fee: (Number(total) - Number(created.amount)).toFixed(6).replace(/\.?0+$/, ''),
        reference: created.id,
      });
      setEntryId(id);

      setStep(`Sending ${total} USDC to the payout account on ${BRIDGE_CHAIN_LABEL}…`);
      const result = await bridgeOut(created.providerAccount.receiveAddress, total);
      if (result.state === 'error') throw new Error('The transfer did not complete. Nothing was paid out.');
      if (result.sourceTxHash) updateActivity(address, id, { txHash: result.sourceTxHash });

      setStage('tracking');
      setStep('');
      toast.success('Sent. Your bank payout is on its way.');
    } catch (err) {
      console.error('[vlora] cash out failed', err);
      if (id) updateActivity(address, id, { status: 'failed' });
      toast.error(describeWalletError(err));
      // An order that was created is still worth watching: it either gets funded or expires
      setStage(created ? 'tracking' : 'form');
    }
  };

  // Follow the order until it settles (or doesn't)
  const orderId = order?.id;
  const settled = order ? isFinalStatus(order.status) : false;
  useEffect(() => {
    if (stage !== 'tracking' || !orderId || settled) return;
    let alive = true;
    const tick = async () => {
      try {
        const latest = await fetchOfframpOrder(orderId);
        if (!alive) return;
        setOrder(latest);
        if (isFinalStatus(latest.status)) {
          if (entryId) updateActivity(address, entryId, { status: latest.status === 'settled' ? 'success' : 'failed' });
          if (latest.status === 'settled') toast.success('Payout complete.');
        }
      } catch {
        // transient: the next tick tries again
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), 10_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [stage, orderId, settled, entryId, address]);

  const reset = () => {
    setStage('form');
    setOrder(null);
    setEntryId(null);
    setAmount('');
    setQuote(null);
    setStep('');
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-between gap-2 rounded-2xl border border-line/15 bg-surface/80 px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2.5 text-sm font-medium text-ink">
          <Banknote className="size-4 text-brand" /> Cash out to a bank
        </span>
        <ChevronDown className="size-4 text-muted" />
      </button>
    );
  }

  const payout = quote && amount ? Number(amount) * Number(quote.rate) : 0;

  return (
    <section className="rounded-3xl border border-line/10 bg-surface/80 p-5 backdrop-blur">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <Banknote className="size-4 text-brand" /> Cash out
            <span className="rounded-full bg-brand/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand">Beta</span>
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            Turn USDC into local currency, paid straight into a bank account.
          </p>
        </div>
        {collapsible && (
          <button onClick={() => setOpen(false)} aria-label="Hide" className="text-subtle hover:text-ink">
            <X className="size-4" />
          </button>
        )}
      </div>

      {info && !info.enabled ? (
        <p className="mt-4 rounded-xl bg-surface-2 px-3 py-2 text-xs leading-relaxed text-muted">
          Cashing out isn't switched on here yet{info.reason ? ` (${info.reason})` : ''}. You can still send USDC to an exchange that
          supports {ACTIVE_CHAIN.name}.
        </p>
      ) : !isConnected || !address ? (
        <p className="mt-4 rounded-xl bg-surface-2 px-3 py-2 text-xs text-muted">Connect or sign in to cash out.</p>
      ) : stage === 'form' ? (
        <>
          <div className="mt-4 grid grid-cols-[1fr_auto] gap-2">
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
              inputMode="decimal"
              placeholder="Amount in USDC"
              aria-label="Amount in USDC"
              className="w-full rounded-xl border border-line/15 bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand/50"
            />
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              aria-label="Payout currency"
              className="rounded-xl border border-line/15 bg-surface px-2 py-2 text-sm font-medium text-ink outline-none focus:border-brand/50"
            >
              {(info?.currencies ?? []).map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code}
                </option>
              ))}
            </select>
          </div>
          {amountProblem && <p className="mt-1.5 text-[11px] text-danger">{amountProblem}</p>}
          {quote && quote.for === `${amount}:${currency}` && !amountProblem && (
            <p className="mt-1.5 text-xs text-muted">
              They receive <span className="font-semibold text-ink">{money(payout, symbol)}</span> at {money(quote.rate, symbol)} per USDC
            </p>
          )}

          <label className="mt-3 block text-xs text-muted">
            Bank
            <select
              value={institution}
              onChange={(e) => {
                setInstitution(e.target.value);
                setAccountName('');
              }}
              className="mt-1 w-full rounded-xl border border-line/15 bg-surface px-3 py-2 text-sm font-medium text-ink outline-none focus:border-brand/50"
            >
              <option value="">Choose a bank…</option>
              {institutions.map((i) => (
                <option key={i.code} value={i.code}>
                  {i.name}
                </option>
              ))}
            </select>
          </label>

          <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
            <input
              value={accountNumber}
              onChange={(e) => {
                setAccountNumber(e.target.value.replace(/[^\d|+-]/g, ''));
                setAccountName('');
              }}
              inputMode="numeric"
              placeholder="Account number"
              aria-label="Account number"
              className="w-full rounded-xl border border-line/15 bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand/50"
            />
            <button
              onClick={() => void verify()}
              disabled={!institution || accountNumber.length < 5 || verifying}
              className={cn(
                'flex items-center gap-1.5 rounded-xl border border-line/15 px-3 text-xs font-semibold text-ink',
                (!institution || accountNumber.length < 5 || verifying) && 'opacity-40',
              )}
            >
              {verifying ? <Loader2 className="size-3.5 animate-spin" /> : accountName ? <Check className="size-3.5 text-success" /> : null}
              Check
            </button>
          </div>
          {accountName && <p className="mt-1.5 text-xs font-medium text-success">{accountName}</p>}

          <button
            onClick={review}
            disabled={!ready}
            className={cn(
              'mt-4 w-full rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-ink',
              !ready && 'opacity-40',
            )}
          >
            Review cash-out
          </button>
          <p className="mt-2 text-[11px] leading-relaxed text-subtle">
            Paycrest pays the bank. Rates move, so the figure is fixed when you confirm. Your wallet signs once, on {ACTIVE_CHAIN.name}.
          </p>
        </>
      ) : stage === 'review' ? (
        <>
          <dl className="mt-4 space-y-1.5 text-xs">
            <div className="flex justify-between">
              <dt className="text-muted">They receive</dt>
              <dd className="font-semibold text-ink">{money(payout, symbol)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Rate</dt>
              <dd className="font-medium text-ink-2">
                {money(quote?.rate ?? 0, symbol)} / USDC
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Account</dt>
              <dd className="max-w-[60%] truncate text-right font-medium text-ink-2">
                {accountName} · {accountNumber}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Transfer fee</dt>
              <dd className="font-medium text-ink-2">{bridgeFee == null ? 'estimating…' : `${bridgeFee} USDC`}</dd>
            </div>
            <div className="flex justify-between border-t border-line/10 pt-1.5">
              <dt className="text-muted">Leaves your wallet</dt>
              <dd className="font-semibold text-ink">≈ {(Number(amount) + Number(bridgeFee ?? 0)).toFixed(4).replace(/\.?0+$/, '')} USDC</dd>
            </div>
          </dl>
          <p className="mt-3 rounded-xl bg-surface-2 px-3 py-2 text-[11px] leading-relaxed text-muted">
            Paycrest doesn't accept {ACTIVE_CHAIN.name} yet, so Vlora moves your USDC to their account on {BRIDGE_CHAIN_LABEL} first — one
            signature, no extra wallet needed. This detour goes away when they add {ACTIVE_CHAIN.name}. If no payout provider takes the
            order, the USDC is refunded to your address on {BRIDGE_CHAIN_LABEL}, where moving it needs a little ETH for gas.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button onClick={() => setStage('form')} className="rounded-xl border border-line/15 py-2.5 text-xs font-semibold text-ink">
              Back
            </button>
            <button onClick={() => void confirm()} className="rounded-xl bg-primary py-2.5 text-xs font-semibold text-primary-ink">
              Confirm cash-out
            </button>
          </div>
        </>
      ) : stage === 'working' ? (
        <p className="mt-4 flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-3 text-xs text-muted">
          <Loader2 className="size-3.5 shrink-0 animate-spin" /> {step || 'Working…'}
        </p>
      ) : (
        <>
          <dl className="mt-4 space-y-1.5 text-xs">
            <div className="flex justify-between">
              <dt className="text-muted">Status</dt>
              <dd className={cn('font-semibold', order?.status === 'settled' ? 'text-success' : 'text-ink')}>
                {describeOrderStatus(order?.status ?? 'initiated')}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Payout</dt>
              <dd className="font-medium text-ink-2">
                {money(Number(order?.amount ?? 0) * Number(order?.rate ?? 0), symbol)} to {accountNumber}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Reference</dt>
              <dd className="max-w-[60%] truncate text-right font-mono text-[11px] text-ink-2">{order?.id}</dd>
            </div>
          </dl>
          <p className="mt-2 text-[11px] leading-relaxed text-subtle">
            Bank payouts usually land in a couple of minutes. You can close this — it keeps going, and "/history" has the receipt.
          </p>
          <button onClick={reset} className="mt-3 w-full rounded-xl border border-line/15 py-2.5 text-xs font-semibold text-ink">
            Cash out again
          </button>
        </>
      )}
    </section>
  );
}

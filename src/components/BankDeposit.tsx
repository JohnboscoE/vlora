import { useEffect, useMemo, useState } from 'react';
import { useAccount } from 'wagmi';
import { toast } from 'sonner';
import { Building2, Check, Copy, Loader2 } from 'lucide-react';
import { ACTIVE_CHAIN } from '@/chain-env';
import { BRIDGE_CHAIN_LABEL } from '@/lib/bridge';
import {
  createDeposit,
  describeDepositStatus,
  fetchInstitutions,
  fetchOfframpInfo,
  fetchOfframpOrder,
  isFinalStatus,
  verifyAccount,
  type DepositOrder,
  type Institution,
  type OfframpInfo,
} from '@/lib/offramp';
import { cn } from '@/lib/utils';

/**
 * Buying USDC with a bank transfer, through Paycrest.
 *
 * No card, no KYC queue at a card processor: you pay a virtual account from your
 * own bank and the USDC is released to your wallet.
 *
 * It lands on {BRIDGE_CHAIN_LABEL} rather than Arc, because Paycrest has no Arc —
 * the same reason cashing out and bills take that route. The panel says so
 * plainly instead of letting someone discover it afterwards.
 */
export function BankDeposit() {
  const { address } = useAccount();
  const [info, setInfo] = useState<OfframpInfo | null>(null);
  const [currency, setCurrency] = useState('NGN');
  const [bankList, setBankList] = useState<{ currency: string; list: Institution[] } | null>(null);
  const [chosenBank, setChosenBank] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [verified, setVerified] = useState<{ key: string; name: string } | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [order, setOrder] = useState<DepositOrder | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void fetchOfframpInfo().then(setInfo, () => undefined);
  }, []);

  useEffect(() => {
    if (!currency) return;
    let alive = true;
    void fetchInstitutions(currency).then(
      (list) => alive && setBankList({ currency, list }),
      () => alive && setBankList({ currency, list: [] }),
    );
    return () => {
      alive = false;
    };
  }, [currency]);

  const institutions = bankList?.currency === currency ? bankList.list : [];
  const institution = institutions.some((i) => i.code === chosenBank) ? chosenBank : '';
  const verifyKey = `${institution}:${accountNumber}`;
  const accountName = verified?.key === verifyKey ? verified.name : '';
  const symbol = info?.currencies.find((c) => c.code === currency)?.symbol ?? '';

  const ready = !!address && !!amount && Number(amount) > 0 && !!institution && !!accountName;

  const verify = async () => {
    if (!institution || accountNumber.length < 5) return;
    const key = verifyKey;
    setVerifying(true);
    try {
      const name = await verifyAccount(institution, accountNumber);
      setVerified({ key, name: name && name !== 'OK' ? name : 'Account holder' });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't check that account.");
    } finally {
      setVerifying(false);
    }
  };

  const start = async () => {
    if (!ready || !address) return;
    setBusy(true);
    try {
      setOrder(
        await createDeposit({ amount, currency, recipient: address, institution, accountIdentifier: accountNumber, accountName }),
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't set up the transfer.");
    } finally {
      setBusy(false);
    }
  };

  // Follow it until the USDC is released
  const orderId = order?.id;
  const done = order ? isFinalStatus(order.status) : false;
  useEffect(() => {
    if (!orderId || done) return;
    let alive = true;
    const tick = async () => {
      try {
        const latest = (await fetchOfframpOrder(orderId)) as unknown as DepositOrder;
        if (!alive) return;
        setOrder(latest);
        if (latest.status === 'settled') toast.success('Your USDC is on the way.');
      } catch {
        // transient; the next tick tries again
      }
    };
    const timer = setInterval(() => void tick(), 15_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [orderId, done]);

  const payTo = order?.providerAccount;
  const payAccount = payTo?.accountIdentifier ?? '';

  const copy = () => {
    if (!payAccount) return;
    navigator.clipboard.writeText(payAccount).then(
      () => {
        setCopied(true);
        toast.success('Account number copied');
        setTimeout(() => setCopied(false), 1800);
      },
      () => toast.error(`Couldn't copy. The account number is ${payAccount}`),
    );
  };

  const currencies = useMemo(() => info?.currencies ?? [], [info]);

  if (info && !info.enabled) {
    return (
      <p className="rounded-control bg-surface-2 px-3 py-2 text-xs leading-relaxed text-muted">
        Bank transfers aren&apos;t switched on here yet{info.reason ? ` (${info.reason})` : ''}.
      </p>
    );
  }

  if (order && payTo) {
    return (
      <div className="space-y-2">
        <p className="text-xs font-semibold text-ink">{describeDepositStatus(order.status)}</p>
        <div className="rounded-control bg-surface-2 px-3 py-2.5">
          <p className="text-xs text-muted">Transfer exactly</p>
          <p className="text-sm font-semibold text-ink">
            {payTo.amountToTransfer ?? order.amount} {payTo.currency ?? currency}
          </p>
          <p className="mt-2 text-xs text-muted">To</p>
          <button onClick={copy} className="flex w-full items-center justify-between gap-2 text-left">
            <span className="font-mono text-sm text-ink">{payAccount}</span>
            {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5 text-subtle" />}
          </button>
          <p className="text-xs text-ink-2">
            {payTo.bankName ?? payTo.institution} · {payTo.accountName}
          </p>
          {payTo.memo && <p className="mt-1 text-xs text-muted">Reference: {payTo.memo}</p>}
        </div>
        <p className="text-xs leading-relaxed text-subtle">
          Pay from the account you gave, or it may be refused. The USDC arrives on {BRIDGE_CHAIN_LABEL}; moving it to{' '}
          {ACTIVE_CHAIN.name} needs a little ETH there for now.
        </p>
        <button onClick={() => setOrder(null)} className="w-full rounded-control border border-line/15 py-2 text-xs font-semibold text-ink">
          Start another
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
          inputMode="decimal"
          placeholder={`Amount in ${currency}`}
          aria-label={`Amount in ${currency}`}
          className="w-full rounded-control border border-line/15 bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand/50"
        />
        <select
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
          aria-label="Currency"
          className="rounded-control border border-line/15 bg-surface px-2 py-2 text-sm font-medium text-ink outline-none focus:border-brand/50"
        >
          {currencies.map((c) => (
            <option key={c.code} value={c.code}>
              {c.code}
            </option>
          ))}
        </select>
      </div>

      <select
        value={institution}
        onChange={(e) => setChosenBank(e.target.value)}
        aria-label="Your bank"
        className="w-full rounded-control border border-line/15 bg-surface px-3 py-2 text-sm font-medium text-ink outline-none focus:border-brand/50"
      >
        <option value="">The bank you&apos;ll pay from…</option>
        {institutions.map((i) => (
          <option key={i.code} value={i.code}>
            {i.name}
          </option>
        ))}
      </select>

      <div className="grid grid-cols-[1fr_auto] gap-2">
        <input
          value={accountNumber}
          onChange={(e) => setAccountNumber(e.target.value.replace(/[^\d|+-]/g, ''))}
          inputMode="numeric"
          placeholder="Your account number"
          aria-label="Your account number"
          className="w-full rounded-control border border-line/15 bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand/50"
        />
        <button
          onClick={() => void verify()}
          disabled={!institution || accountNumber.length < 5 || verifying}
          className={cn(
            'flex items-center gap-1.5 rounded-control border border-line/15 px-3 text-xs font-semibold text-ink',
            (!institution || accountNumber.length < 5 || verifying) && 'opacity-40',
          )}
        >
          {verifying ? <Loader2 className="size-3.5 animate-spin" /> : accountName ? <Check className="size-3.5 text-success" /> : null}
          Check
        </button>
      </div>
      {accountName && <p className="text-xs font-medium text-success">{accountName}</p>}

      <button
        onClick={() => void start()}
        disabled={!ready || busy}
        className={cn(
          'flex w-full items-center justify-center gap-2 rounded-control bg-primary py-2.5 text-sm font-semibold text-primary-ink',
          (!ready || busy) && 'opacity-40',
        )}
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Building2 className="size-4" />}
        Get transfer details
      </button>
      <p className="text-xs leading-relaxed text-subtle">
        You pay a virtual account from your own bank — no card. {symbol ? `Rates are Paycrest's. ` : ''}The USDC is released on{' '}
        {BRIDGE_CHAIN_LABEL}, since Paycrest doesn&apos;t settle on {ACTIVE_CHAIN.name} yet.
      </p>
    </div>
  );
}

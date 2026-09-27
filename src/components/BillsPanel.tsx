import { useEffect, useMemo, useState } from 'react';
import { useAccount, useSwitchChain } from 'wagmi';
import { toast } from 'sonner';
import { ChevronDown, Loader2, Receipt, X } from 'lucide-react';
import { ACTIVE_CHAIN, ACTIVE_CHAIN_ID } from '@/chain-env';
import { BRIDGE_CHAIN_LABEL } from '@/lib/bridge';

import {
  BILL_CATEGORY_LABELS,
  describeInvoiceStatus,
  fetchBillProduct,
  fetchBillProducts,
  fetchBillInvoice,
  fetchBillsInfo,
  isFinalInvoiceStatus,
  recipientLabel,
  type BillCategory,
  type BillInvoice,
  type BillProduct,
  type BillsInfo,
} from '@/lib/bills';
import { updateActivity } from '@/lib/activity';
import { runBillPayment } from '@/lib/runMoney';
import { describeWalletError } from '@/lib/walletError';
import { cn } from '@/lib/utils';

interface BillsPanelProps {
  collapsible?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Which tab to land on, e.g. from "/airtime" */
  category?: BillCategory;
}

const CATEGORIES: BillCategory[] = ['airtime', 'data', 'electricity', 'tv'];
/** Countries Bitrefill covers that Vlora's users are most likely to want */
const COUNTRIES = [
  { code: 'NG', name: 'Nigeria' },
  { code: 'KE', name: 'Kenya' },
  { code: 'GH', name: 'Ghana' },
  { code: 'UG', name: 'Uganda' },
  { code: 'TZ', name: 'Tanzania' },
  { code: 'ZA', name: 'South Africa' },
  { code: 'US', name: 'United States' },
  { code: 'GB', name: 'United Kingdom' },
];

type Stage = 'form' | 'working' | 'tracking';

/**
 * Pay a bill or top up a phone with USDC, through Bitrefill (src/lib/bills.ts).
 *
 * Bitrefill quotes in USDC on Base and delivers to the number itself, so paying
 * is one bridge from Arc — the same single signature as a cash-out. Vlora holds
 * nothing: the invoice is paid from the user's wallet to Bitrefill's address.
 */
export function BillsPanel({ collapsible = false, open: openProp, onOpenChange, category: categoryProp }: BillsPanelProps) {
  const { address, isConnected, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const [openSelf, setOpenSelf] = useState(!collapsible);
  const open = openProp ?? openSelf;
  const setOpen = (next: boolean) => {
    setOpenSelf(next);
    onOpenChange?.(next);
  };

  const [info, setInfo] = useState<BillsInfo | null>(null);
  const [category, setCategory] = useState<BillCategory>(categoryProp ?? 'airtime');
  // Follow the slash command that opened the panel
  const [lastCategoryProp, setLastCategoryProp] = useState(categoryProp);
  if (categoryProp && categoryProp !== lastCategoryProp) {
    setLastCategoryProp(categoryProp);
    setCategory(categoryProp);
  }

  const [country, setCountry] = useState('NG');
  const [catalogue, setCatalogue] = useState<{ key: string; list: BillProduct[] } | null>(null);
  const [chosenProduct, setChosenProduct] = useState('');
  const [detail, setDetail] = useState<{ id: string; product: BillProduct } | null>(null);
  const [chosenPackage, setChosenPackage] = useState('');
  const [value, setValue] = useState('');
  const [recipient, setRecipient] = useState('');
  const [stage, setStage] = useState<Stage>('form');
  const [step, setStep] = useState('');
  const [invoice, setInvoice] = useState<BillInvoice | null>(null);
  const [entryId, setEntryId] = useState<string | null>(null);

  // What the list is for, and what of the current selection still applies
  const catalogueKey = `${category}:${country}`;
  const products = catalogue?.key === catalogueKey ? catalogue.list : null;
  const productId = products?.some((p) => p.id === chosenProduct) ? chosenProduct : '';
  // The list carries enough to choose; the detail call adds the amounts
  const product = productId ? (detail?.id === productId ? detail.product : (products?.find((p) => p.id === productId) ?? null)) : null;
  const packageId = product?.packages.some((p) => p.id === chosenPackage) ? chosenPackage : '';

  useEffect(() => {
    if (!open) return;
    void fetchBillsInfo().then(setInfo, (err: unknown) => {
      console.error('[vlora] bills info failed', err);
      setInfo({ enabled: false, reason: 'offline', network: 'base', maxUsdc: 100, categories: [] });
    });
  }, [open]);

  useEffect(() => {
    if (!open || !info?.enabled) return;
    let alive = true;
    void fetchBillProducts(category, country).then(
      (list) => alive && setCatalogue({ key: catalogueKey, list }),
      (err: unknown) => {
        console.error('[vlora] bill products failed', err);
        if (alive) setCatalogue({ key: catalogueKey, list: [] });
      },
    );
    return () => {
      alive = false;
    };
  }, [open, info?.enabled, category, country, catalogueKey]);

  useEffect(() => {
    if (!productId) return;
    let alive = true;
    void fetchBillProduct(productId).then(
      (p) => alive && setDetail({ id: productId, product: p }),
      // Leave it untagged: the row from the list is used instead
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [productId]);

  const amountProblem = useMemo(() => {
    if (!product || packageId) return null;
    if (!value) return null;
    const n = Number(value);
    const range = product.range;
    if (!Number.isFinite(n) || n <= 0) return 'Enter an amount.';
    if (range && (n < range.min || n > range.max)) return `Between ${range.min} and ${range.max} ${product.currency}.`;
    return null;
  }, [product, packageId, value]);

  const ready = isConnected && !!address && !!product && (!!packageId || (!!value && !amountProblem)) && recipient.length >= 4;

  // The panel and the typed command ("buy 500 airtime for 0801…") run exactly
  // the same code — see src/lib/runMoney.ts.
  const pay = async () => {
    if (!ready || !address || !product) return;
    setStage('working');
    let run: Awaited<ReturnType<typeof runBillPayment>> | null = null;
    try {
      if (chainId !== ACTIVE_CHAIN_ID) {
        setStep(`Switching your wallet to ${ACTIVE_CHAIN.name}…`);
        await switchChainAsync({ chainId: ACTIVE_CHAIN_ID });
      }
      const chosen = packageId ? (product.packages.find((p) => p.id === packageId)?.value ?? '') : value;
      run = await runBillPayment(
        address,
        {
          category,
          product,
          ...(packageId ? { packageId } : { value }),
          recipient,
          label: `${chosen ? `${chosen} ${product.currency} of ` : ''}${product.name}`,
        },
        setStep,
      );
      setEntryId(run.entryId);
      setInvoice(run.invoice);
      setStage('tracking');
      setStep('');
      toast.success('Paid. Bitrefill is delivering it now.');
    } catch (err) {
      console.error('[vlora] bill payment failed', err);
      toast.error(describeWalletError(err));
      setStage(run ? 'tracking' : 'form');
    }
  };

  // Follow the invoice until it's delivered (or isn't). Bitrefill allows 60 reads
  // per 10 minutes per invoice, so this is deliberately unhurried.
  const invoiceId = invoice?.id;
  const done = invoice ? isFinalInvoiceStatus(invoice.status) : false;
  useEffect(() => {
    if (stage !== 'tracking' || !invoiceId || done) return;
    let alive = true;
    const tick = async () => {
      try {
        const latest = await fetchBillInvoice(invoiceId);
        if (!alive) return;
        setInvoice(latest);
        if (isFinalInvoiceStatus(latest.status)) {
          if (entryId) updateActivity(address, entryId, { status: latest.status === 'complete' ? 'success' : 'failed' });
          if (latest.status === 'complete') toast.success('Delivered.');
        }
      } catch {
        // transient: the next tick tries again
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), 20_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [stage, invoiceId, done, entryId, address]);

  const reset = () => {
    setStage('form');
    setInvoice(null);
    setEntryId(null);
    setValue('');
    setChosenPackage('');
    setStep('');
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-between gap-2 rounded-2xl border border-line/15 bg-surface/80 px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2.5 text-sm font-medium text-ink">
          <Receipt className="size-4 text-brand" /> Airtime & bills
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
            <Receipt className="size-4 text-brand" /> Airtime & bills
            <span className="rounded-full bg-brand/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand">Beta</span>
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-muted">Top up a phone or pay a bill with USDC. Bitrefill delivers it.</p>
        </div>
        {collapsible && (
          <button onClick={() => setOpen(false)} aria-label="Hide" className="text-subtle hover:text-ink">
            <X className="size-4" />
          </button>
        )}
      </div>

      {info && !info.enabled ? (
        <p className="mt-4 rounded-xl bg-surface-2 px-3 py-2 text-xs leading-relaxed text-muted">
          Bill payments aren't switched on here yet{info.reason ? ` (${info.reason})` : ''}.
        </p>
      ) : !isConnected || !address ? (
        <p className="mt-4 rounded-xl bg-surface-2 px-3 py-2 text-xs text-muted">Connect or sign in to pay a bill.</p>
      ) : stage === 'working' ? (
        <p className="mt-4 flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-3 text-xs text-muted">
          <Loader2 className="size-3.5 shrink-0 animate-spin" /> {step || 'Working…'}
        </p>
      ) : stage === 'tracking' ? (
        <>
          <dl className="mt-4 space-y-1.5 text-xs">
            <div className="flex justify-between">
              <dt className="text-muted">Status</dt>
              <dd className={cn('font-semibold', invoice?.status === 'complete' ? 'text-success' : 'text-ink')}>
                {describeInvoiceStatus(invoice?.status ?? 'unpaid')}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">For</dt>
              <dd className="max-w-[60%] truncate text-right font-medium text-ink-2">{recipient}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Reference</dt>
              <dd className="max-w-[60%] truncate text-right font-mono text-[11px] text-ink-2">{invoice?.id}</dd>
            </div>
          </dl>
          <p className="mt-2 text-[11px] leading-relaxed text-subtle">
            Top-ups usually land within a minute. You can close this — "/history" keeps the receipt.
          </p>
          <button onClick={reset} className="mt-3 w-full rounded-xl border border-line/15 py-2.5 text-xs font-semibold text-ink">
            Pay something else
          </button>
        </>
      ) : (
        <>
          <div className="mt-4 flex gap-1.5 overflow-x-auto pb-1">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                className={cn(
                  'shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold',
                  category === c ? 'border-brand/40 bg-brand/10 text-brand' : 'border-line/15 text-muted',
                )}
              >
                {BILL_CATEGORY_LABELS[c]}
              </button>
            ))}
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <label className="block text-xs text-muted">
              Country
              <select
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                className="mt-1 w-full rounded-xl border border-line/15 bg-surface px-3 py-2 text-sm font-medium text-ink outline-none focus:border-brand/50"
              >
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs text-muted">
              Provider
              <select
                value={productId}
                onChange={(e) => {
                  setChosenProduct(e.target.value);
                  setValue('');
                }}
                disabled={products == null}
                className="mt-1 w-full rounded-xl border border-line/15 bg-surface px-3 py-2 text-sm font-medium text-ink outline-none focus:border-brand/50"
              >
                <option value="">{products == null ? 'Loading…' : products.length ? 'Choose…' : 'None available'}</option>
                {(products ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {product && (
            <>
              {product.packages.length > 0 ? (
                <label className="mt-3 block text-xs text-muted">
                  Amount
                  <select
                    value={packageId}
                    onChange={(e) => setChosenPackage(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-line/15 bg-surface px-3 py-2 text-sm font-medium text-ink outline-none focus:border-brand/50"
                  >
                    <option value="">Choose…</option>
                    {product.packages.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.value} {product.currency}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <input
                  value={value}
                  onChange={(e) => setValue(e.target.value.replace(/[^\d.]/g, ''))}
                  inputMode="decimal"
                  placeholder={product.range ? `${product.range.min}–${product.range.max} ${product.currency}` : `Amount in ${product.currency}`}
                  aria-label="Amount"
                  className="mt-3 w-full rounded-xl border border-line/15 bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand/50"
                />
              )}
              {amountProblem && <p className="mt-1.5 text-[11px] text-danger">{amountProblem}</p>}

              <input
                value={recipient}
                onChange={(e) => setRecipient(e.target.value.replace(/[^\d+-]/g, ''))}
                placeholder={recipientLabel(product, category)}
                aria-label={recipientLabel(product, category)}
                className="mt-3 w-full rounded-xl border border-line/15 bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand/50"
              />
              {(category === 'airtime' || category === 'data') && (
                <p className="mt-1.5 text-[11px] text-subtle">Include the country code, e.g. +2348012345678.</p>
              )}
            </>
          )}

          <button
            onClick={() => void pay()}
            disabled={!ready}
            className={cn('mt-4 w-full rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-ink', !ready && 'opacity-40')}
          >
            Pay with USDC
          </button>
          <p className="mt-2 text-[11px] leading-relaxed text-subtle">
            Bitrefill prices this in USDC and delivers it. Because they don't take {ACTIVE_CHAIN.name} yet, Vlora pays them on{' '}
            {BRIDGE_CHAIN_LABEL} for you — one signature here, no second wallet. Check the number before you pay: a top-up can't be undone.
          </p>
        </>
      )}
    </section>
  );
}

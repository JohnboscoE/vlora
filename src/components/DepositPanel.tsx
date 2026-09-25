import { useEffect, useRef, useState } from 'react';
import { useAccount } from 'wagmi';
import { toast } from 'sonner';
import QRCode from 'qrcode';
import { ArrowDownToLine, Check, ChevronDown, Copy, CreditCard, Loader2, X } from 'lucide-react';
import { ACTIVE_CHAIN, ACTIVE_CHAIN_ID } from '@/chain-env';
import { getTokens } from '@/tokens';
import { cn } from '@/lib/utils';

interface OnrampInfo {
  enabled: boolean;
  reason?: string;
}

interface DepositPanelProps {
  collapsible?: boolean;
  /** Opened from the "/" menu */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * Add funds: your deposit address (copy or scan), plus Circle's Onramp widget for
 * buying USDC with a card where the server has a Circle key
 * (see server/onramp.ts). Everything lands in the connected wallet — including an
 * embedded wallet created by email/Google sign-in, which starts empty.
 */
export function DepositPanel({ collapsible = false, open: openProp, onOpenChange }: DepositPanelProps) {
  const { address } = useAccount();
  const [openSelf, setOpenSelf] = useState(!collapsible);
  const open = openProp ?? openSelf;
  const setOpen = (next: boolean) => {
    setOpenSelf(next);
    onOpenChange?.(next);
  };

  const [copied, setCopied] = useState(false);
  // Tagged with the address it encodes, so a stale QR never shows for a new wallet
  const [qr, setQr] = useState<{ address: string; url: string } | null>(null);
  const [onramp, setOnramp] = useState<OnrampInfo | null>(null);
  const [buying, setBuying] = useState(false);
  const widgetRef = useRef<HTMLDivElement>(null);
  const closeWidget = useRef<(() => void) | null>(null);

  const tokens = getTokens(ACTIVE_CHAIN_ID).map((t) => t.symbol);

  useEffect(() => {
    if (!address) return;
    void QRCode.toDataURL(address, { margin: 1, width: 320, color: { dark: '#122d45', light: '#ffffff' } }).then(
      (url) => setQr({ address, url }),
      () => undefined,
    );
  }, [address]);

  useEffect(() => {
    void fetch('/api/onramp/info')
      .then((r) => (r.ok ? (r.json() as Promise<OnrampInfo>) : { enabled: false }))
      .then(setOnramp, () => setOnramp({ enabled: false }));
  }, []);

  // Tear the widget down when the panel closes or unmounts
  useEffect(() => () => closeWidget.current?.(), []);

  const copy = () => {
    if (!address) return;
    navigator.clipboard.writeText(address).then(
      () => {
        setCopied(true);
        toast.success('Deposit address copied');
        setTimeout(() => setCopied(false), 1800);
      },
      () => toast.error(`Couldn't copy. Your address is ${address}`),
    );
  };

  const buyWithCard = async () => {
    if (!address || !widgetRef.current) return;
    setBuying(true);
    try {
      const { AppKit } = await import('@circle-fin/app-kit');
      const kit = new AppKit();
      const session = await kit.onramp.fetchSession({
        url: '/api/onramp/sessions',
        body: { appUserId: address, destinationAddress: address },
      });
      closeWidget.current?.();
      const widget = kit.onramp.mountIframe({
        session,
        container: widgetRef.current,
        onDepositSettled: () => toast.success('Top-up complete — your balance will update shortly.'),
        onDepositNotCompleted: () => toast.info('Top-up not completed.'),
      });
      closeWidget.current = () => {
        widget.close();
        closeWidget.current = null;
      };
    } catch (err) {
      console.error('[vlora] onramp failed', err);
      toast.error('Couldn\'t start the card top-up. Try the deposit address instead.');
    } finally {
      setBuying(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-between gap-2 rounded-2xl border border-line/15 bg-surface/80 px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2.5 text-sm font-medium text-ink">
          <ArrowDownToLine className="size-4 text-brand" /> Add funds
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
            <ArrowDownToLine className="size-4 text-brand" /> Add funds
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            Send {tokens.join(', ')} on {ACTIVE_CHAIN.name} to this address, or buy with a card.
          </p>
        </div>
        {collapsible && (
          <button onClick={() => setOpen(false)} aria-label="Hide" className="text-subtle hover:text-ink">
            <X className="size-4" />
          </button>
        )}
      </div>

      {!address ? (
        <p className="mt-4 rounded-xl bg-surface-2 px-3 py-2 text-xs text-muted">Connect or sign in first to see your deposit address.</p>
      ) : (
        <>
          {qr?.address === address && (
            <div className="mt-4 flex justify-center">
              <img src={qr.url} alt={`QR code for ${address}`} className="size-36 rounded-xl border border-line/10 bg-white p-1" />
            </div>
          )}

          <button
            onClick={copy}
            className="mt-3 flex w-full items-center justify-between gap-2 rounded-xl border border-line/15 bg-surface px-3 py-2.5 text-left transition-colors hover:bg-surface-2"
            title="Copy your deposit address"
          >
            <span className="mono min-w-0 break-all text-[11px] leading-snug text-ink-2">{address}</span>
            {copied ? <Check className="size-4 shrink-0 text-success" /> : <Copy className="size-4 shrink-0 text-muted" />}
          </button>

          <p className="mt-2 text-[11px] leading-relaxed text-subtle">
            Only send on {ACTIVE_CHAIN.name} (chain {ACTIVE_CHAIN_ID}). Funds sent on another network can't be recovered. Gas on Arc is
            paid in USDC, so keep a little for fees.
          </p>

          <div className="mt-4 border-t border-line/10 pt-4">
            {onramp?.enabled ? (
              <button
                onClick={() => void buyWithCard()}
                disabled={buying}
                className={cn(
                  'flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-ink',
                  buying && 'opacity-60',
                )}
              >
                {buying ? <Loader2 className="size-4 animate-spin" /> : <CreditCard className="size-4" />}
                Buy USDC with a card
              </button>
            ) : (
              <p className="rounded-xl bg-surface-2 px-3 py-2 text-[11px] leading-relaxed text-muted">
                <span className="font-semibold text-ink-2">Card top-ups aren't available yet.</span> They need a verified Circle account
                for {ACTIVE_CHAIN.name}. Until then, send {tokens[0]} to the address above from an exchange or another wallet.
              </p>
            )}
            {/* Circle's widget renders in here; it needs an explicit height */}
            <div ref={widgetRef} className="mt-3 w-full empty:hidden [&:not(:empty)]:h-[620px]" />
          </div>
        </>
      )}
    </section>
  );
}

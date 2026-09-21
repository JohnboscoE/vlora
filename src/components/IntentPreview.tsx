import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowRight,
  ArrowUpDown,
  Droplets,
  Wallet,
  X,
  AlertTriangle,
  Info,
  Loader2,
  ShieldCheck,
  Users,
  Trash2,
  BookmarkPlus,
  Check,
  AtSign,
} from 'lucide-react';
import type { ArcNameIntent, BatchIntent, ParsedIntent, SwapIntent } from '../utils/intentParser';
import { formatUnits } from 'viem';
import { useSwapQuote, type QuoteState, type SwapQuote } from '@/lib/swapQuote';
import { useGaslessEnabled } from '@/lib/gasless';
import type { TokenBalances } from '@/hooks/useTokenBalances';
import { getSwapVenue } from '@/swap-config';
import { formatTokenAmount } from '@/tokens';
import { formatUsdcFee, useArcNameFee } from '@/lib/arcNameFee';
import type { SwapCheck } from '../utils/validateSend';
import { TokenUSDC } from '@web3icons/react';
import { ACTIVE_CHAIN, ACTIVE_CHAIN_ID } from '@/chain-env';
import { validateArcName, validateBatch, validateSend, validateSwap } from '../utils/validateSend';
import { ARC_NAME_MAX_YEARS } from '@/arcnames-config';
import { useTxPreview, type PlannedTx, type TxPreview } from '@/hooks/useTxPreview';
import { contactName, type Contact } from '@/lib/contacts';
import { cn } from '@/lib/utils';

function formatAddr(addr: string) {
  if (!addr || addr.length < 10) return addr;
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
}

interface IntentPreviewProps {
  intent: ParsedIntent;
  /**
   * quote: for swaps, the quote the user reviewed (route + minimum output).
   * gasless: for USDC sends, Circle submits it and pays the network fee.
   */
  onConfirm: (opts: { quote?: SwapQuote; gasless?: boolean }) => void;
  onCancel: () => void;
  isPending: boolean;
  isConfirming: boolean;
  isConnected: boolean;
  account?: `0x${string}`;
  balances: TokenBalances;
  wrongChain: boolean;
  onSwitchChain: () => void;
  contacts: Contact[];
  /** address (lowercase) → "name.arc" for recipients typed as .arc names */
  arcLabels: Record<string, string>;
  /** Edits made in the preview (batch rows, years) replace the intent being previewed */
  onEditIntent: (next: ParsedIntent) => void;
  onSaveTemplate: (name: string, intent: BatchIntent) => void;
}

export function IntentPreview({
  intent,
  onConfirm,
  onCancel,
  isPending,
  isConfirming,
  isConnected,
  account,
  balances,
  wrongChain,
  onSwitchChain,
  contacts,
  arcLabels,
  onEditIntent,
  onSaveTemplate,
}: IntentPreviewProps) {
  const busy = isPending || isConfirming;
  // Either check gates the button the same way; a batch just has more to verify
  const swapsLive = getSwapVenue(ACTIVE_CHAIN_ID) != null;
  const arcNameFee = useArcNameFee();
  const sendCheck =
    intent.type === 'send'
      ? validateSend(intent, balances)
      : intent.type === 'batch'
        ? validateBatch(intent, balances.USDC)
        : intent.type === 'arcname'
          ? validateArcName(intent, arcNameFee)
          : intent.type === 'swap' && swapsLive
            ? validateSwap(intent, balances)
            : null;
  const previewOnly = intent.type === 'add_lp' || (intent.type === 'swap' && !swapsLive);

  // Live quote for swaps that pass the local checks
  const swapCheck = intent.type === 'swap' && sendCheck?.ok && 'venue' in sendCheck ? sendCheck : null;
  const quote = useSwapQuote(swapCheck?.tokenIn.address, swapCheck?.tokenOut.address, swapCheck?.amountIn.raw, account);

  // Gasless (Circle Facilitator) is offered for USDC sends when the server has it on
  const gaslessAvailable = useGaslessEnabled() && intent.type === 'send' && intent.token.toUpperCase() === 'USDC';
  const [gaslessChoice, setGaslessChoice] = useState(true);
  const gasless = gaslessAvailable && gaslessChoice;

  // Only dry-run transactions that already pass the local checks
  let planned: PlannedTx | null = null;
  if (sendCheck?.ok && intent.type === 'send' && 'amount' in sendCheck) {
    planned = {
      kind: 'send',
      token: sendCheck.token.address,
      spendsGasToken: sendCheck.token.symbol === 'USDC',
      recipient: intent.recipient as `0x${string}`,
      amountRaw: sendCheck.amount.raw,
      gasless,
    };
  } else if (swapCheck && quote.status === 'ok' && quote.quote.lifi) {
    planned = {
      kind: 'lifi',
      router: quote.quote.lifi.to,
      tokenIn: swapCheck.tokenIn.address,
      amountIn: swapCheck.amountIn.raw,
      data: quote.quote.lifi.data,
      gasLimit: quote.quote.lifi.gasLimit,
      spendsGasToken: swapCheck.tokenIn.symbol === 'USDC',
    };
  } else if (swapCheck && quote.status === 'ok') {
    planned = {
      kind: 'swap',
      router: swapCheck.venue.router,
      tokenIn: swapCheck.tokenIn.address,
      tokenOut: swapCheck.tokenOut.address,
      fee: quote.quote.fee,
      amountIn: swapCheck.amountIn.raw,
      minOut: quote.quote.minOut,
      spendsGasToken: swapCheck.tokenIn.symbol === 'USDC',
    };
  } else if (sendCheck?.ok && intent.type === 'batch' && 'total' in sendCheck) {
    planned = {
      kind: 'batch',
      batchSender: sendCheck.batchSender,
      recipients: sendCheck.recipients,
      amounts: sendCheck.amounts,
      totalRaw: sendCheck.total.raw,
    };
  } else if (sendCheck?.ok && intent.type === 'arcname' && 'feeRaw' in sendCheck) {
    planned =
      intent.op === 'primary'
        ? { kind: 'primary', contract: sendCheck.contract, label: intent.label }
        : intent.op === 'register' || intent.op === 'renew'
          ? { kind: 'arcname', op: intent.op, contract: sendCheck.contract, label: intent.label, years: intent.years, feeRaw: sendCheck.feeRaw }
          : null;
  }
  const sim = useTxPreview(wrongChain ? null : planned, account);

  const confirmDisabled =
    busy ||
    (!isConnected && !previewOnly) ||
    intent.type === 'unknown' ||
    (sendCheck != null && !sendCheck.ok) ||
    sim.status === 'checking' ||
    sim.status === 'fail' ||
    sim.status === 'unknown' || // fail closed: never sign something we couldn't check
    (swapCheck != null && quote.status !== 'ok');

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-end justify-center md:items-center md:p-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-[#050b1a]/40 backdrop-blur-sm" onClick={busy ? undefined : onCancel} />

      {/* Sheet (bottom sheet on mobile, dialog on desktop) */}
      <motion.section
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        className="relative flex max-h-[92dvh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl border border-line/10 bg-surface shadow-2xl md:max-w-lg md:rounded-3xl"
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', stiffness: 380, damping: 38 }}
      >
        <div className="h-1 shrink-0 bg-gradient-to-r from-[#1f51ff] via-[#00c6e6] to-[#7ef1b3]" />

        {/* Drag handle (mobile only) */}
        <div className="flex shrink-0 justify-center pt-3 md:hidden">
          <div className="h-1 w-10 rounded-full bg-line/15" />
        </div>

        <div className="overflow-y-auto px-5 pb-7 pt-4 md:px-7 md:pt-6">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h2 id="confirm-title" className="display text-xl font-semibold text-ink">
                {previewOnly ? 'Preview' : 'Confirm action'}
              </h2>
              <p className="mt-0.5 text-xs text-muted">
                {previewOnly ? 'This action isn\'t executable yet' : 'Review before your wallet signs'}
              </p>
            </div>
            {!busy && (
              <button
                onClick={onCancel}
                aria-label="Close"
                className="flex size-8 items-center justify-center rounded-full bg-surface-2 text-muted transition-colors hover:text-ink"
              >
                <X className="size-4" />
              </button>
            )}
          </div>

          <div className="mb-4 rounded-2xl border border-line/10 bg-surface-2/60 p-4">
            {intent.type === 'batch' ? (
              <BatchRows intent={intent} contacts={contacts} arcLabels={arcLabels} onEdit={onEditIntent} editable={!busy} sim={sim} />
            ) : intent.type === 'arcname' ? (
              <ArcNameRows intent={intent} account={account} onEdit={onEditIntent} editable={!busy} sim={sim} yearlyFee={arcNameFee} />
            ) : (
              intent.type === 'swap' && swapCheck ? (
                <SwapRows intent={intent} check={swapCheck} quote={quote} sim={sim} />
              ) : (
                <IntentRows
                  intent={intent}
                  contacts={contacts}
                  arcLabels={arcLabels}
                  sim={sim}
                  gasless={gaslessAvailable ? { on: gaslessChoice, set: setGaslessChoice, editable: !busy } : undefined}
                />
              )
            )}
          </div>

          {/* Why a send can't be executed (bad token, address, amount, or balance) */}
          {sendCheck && !sendCheck.ok && <Notice tone="danger">{sendCheck.reason}</Notice>}

          {/* On-chain dry run */}
          {sendCheck?.ok && <SimulationNotice sim={sim} kind={intent.type} />}

          {intent.type === 'batch' && intent.items.length > 0 && !busy && (
            <SaveTemplate onSave={(name) => onSaveTemplate(name, intent)} />
          )}

          {previewOnly && (
            <Notice tone="neutral" icon={Info}>
              Preview only — {intent.type === 'swap' ? 'swaps' : 'liquidity deposits'} can't be executed yet. Nothing will be sent.
            </Notice>
          )}

          {intent.type === 'unknown' && (
            <Notice tone="danger">Command not recognized. Try: "send", "swap", "add liquidity", or "check balance".</Notice>
          )}

          {wrongChain && !previewOnly ? (
            <button
              onClick={onSwitchChain}
              className="mt-2 w-full rounded-2xl bg-primary py-3.5 text-sm font-semibold text-primary-ink transition-transform hover:scale-[1.01] active:scale-[0.99]"
            >
              Switch to {ACTIVE_CHAIN.name}
            </button>
          ) : (
            <button
              disabled={confirmDisabled}
              onClick={() => onConfirm({ quote: quote.status === 'ok' ? quote.quote : undefined, gasless })}
              className="mt-2 w-full rounded-2xl bg-primary py-3.5 text-sm font-semibold text-primary-ink transition-transform hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100"
            >
              {previewOnly ? (
                'Got it'
              ) : !isConnected ? (
                'Connect wallet first'
              ) : isPending ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="size-4 animate-spin" /> Confirm in wallet…
                </span>
              ) : isConfirming ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="size-4 animate-spin" /> Confirming on {ACTIVE_CHAIN.name}…
                </span>
              ) : sim.status === 'checking' ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="size-4 animate-spin" /> Checking on {ACTIVE_CHAIN.name}…
                </span>
              ) : intent.type === 'swap' && swapCheck && quote.status === 'ok' ? (
                `Swap ${intent.amountIn} ${swapCheck.tokenIn.symbol} → ${fmt(quote.quote.amountOut, swapCheck.tokenOut.decimals)} ${swapCheck.tokenOut.symbol}`
              ) : intent.type === 'swap' && swapCheck && quote.status === 'loading' ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="size-4 animate-spin" /> Getting the best price…
                </span>
              ) : intent.type === 'send' ? (
                `Send ${intent.amount} ${intent.token}`
              ) : intent.type === 'batch' ? (
                sendCheck?.ok && 'total' in sendCheck
                  ? `Send ${sendCheck.total.toFixed(2)} USDC to ${intent.items.length} recipients`
                  : `Send to ${intent.items.length} recipients`
              ) : intent.type === 'arcname' ? (
                intent.op === 'primary'
                  ? `Set ${intent.label}.arc as my name`
                  : `${intent.op === 'register' ? 'Register' : 'Renew'} ${intent.label}.arc${arcNameFee != null ? ` · ${formatUsdcFee(arcNameFee * BigInt(intent.years))}` : ''}`
              ) : (
                'Execute'
              )}
            </button>
          )}
        </div>
      </motion.section>
    </motion.div>
  );
}

function SimulationNotice({ sim, kind }: { sim: TxPreview; kind: ParsedIntent['type'] }) {
  const isBatch = kind === 'batch';
  if (sim.status === 'checking') {
    return (
      <Notice tone="neutral" icon={Loader2} spin>
        Simulating this transaction on {ACTIVE_CHAIN.name}…
      </Notice>
    );
  }
  if (sim.status === 'fail') {
    return <Notice tone="danger">Simulation failed — this would revert on-chain: {sim.reason}</Notice>;
  }
  if (sim.status === 'unknown') {
    return (
      <Notice tone="danger">
        Couldn't reach {ACTIVE_CHAIN.name} to check this transaction, so signing is blocked. If you use an ad or privacy
        blocker or a VPN, allow the Arc RPC, then close and retry.
      </Notice>
    );
  }
  if (sim.status === 'ok') {
    return (
      <Notice tone="success" icon={ShieldCheck}>
        {kind === 'swap'
          ? sim.needsApproval
            ? 'Checks passed. Two signatures: approve exactly the amount you\'re swapping, then the swap. You get at least the minimum shown, or it reverts.'
            : 'Simulated on-chain: this swap succeeds at the quoted price.'
          : kind === 'arcname'
          ? sim.needsApproval
            ? 'Checks passed. Two signatures: approve exactly the name fee, then the registration.'
            : 'Simulated on-chain: this succeeds.'
          : isBatch
          ? sim.needsApproval
            ? 'Checks passed. Two signatures: a one-time approval for the exact total, then the batch — all-or-nothing.'
            : 'Simulated on-chain: the batch succeeds. One signature, all-or-nothing.'
          : sim.gasless
          ? 'Simulated on-chain: this transfer succeeds. You sign once — no transaction, no gas. Circle submits it and pays the network fee.'
          : 'Simulated on-chain: this transfer succeeds.'}
      </Notice>
    );
  }
  return null;
}

function FeeValue({ sim }: { sim: TxPreview }) {
  if (sim.status === 'ok' && sim.gasless) return <span className="font-medium text-success">Free · paid by Circle</span>;
  if (sim.status === 'ok') return <>{sim.feeIsEstimate ? `≈ ${sim.feeLabel}` : `~${sim.feeLabel}`}</>;
  if (sim.status === 'checking') return <Loader2 className="size-3.5 animate-spin text-muted" />;
  return <span className="font-medium text-muted">Paid in USDC</span>;
}

function SaveTemplate({ onSave }: { onSave: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [saved, setSaved] = useState(false);

  if (saved) {
    return (
      <p className="mb-3 flex items-center gap-1.5 text-xs font-medium text-success">
        <Check className="size-3.5" /> Saved as "{name}" — find it under Saved batches.
      </p>
    );
  }
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mb-3 flex items-center gap-1.5 text-xs font-medium text-brand hover:underline"
      >
        <BookmarkPlus className="size-3.5" /> Save this batch as a template
      </button>
    );
  }
  return (
    <form
      className="mb-3 flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const trimmed = name.trim();
        if (!trimmed) return;
        onSave(trimmed);
        setSaved(true);
      }}
    >
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={40}
        placeholder='Template name, e.g. "Team payroll"'
        aria-label="Template name"
        className="flex-1 rounded-xl border border-line/15 bg-surface px-3 py-2 text-sm text-ink outline-none placeholder:text-subtle focus:border-brand/50"
      />
      <button type="submit" className="rounded-xl bg-surface-2 px-3 text-sm font-semibold text-ink hover:bg-line/10">
        Save
      </button>
    </form>
  );
}

function Notice({
  tone,
  icon: Icon = AlertTriangle,
  spin = false,
  children,
}: {
  tone: 'danger' | 'neutral' | 'success';
  icon?: typeof AlertTriangle;
  spin?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'mb-3 flex items-start gap-2 rounded-xl px-3 py-2.5 text-xs',
        tone === 'danger' && 'bg-danger/10 text-danger',
        tone === 'neutral' && 'bg-surface-2 text-muted',
        tone === 'success' && 'bg-success/10 text-success',
      )}
    >
      <Icon className={cn('mt-0.5 size-3.5 shrink-0', spin && 'animate-spin')} />
      <p>{children}</p>
    </div>
  );
}

function Row({ label, children, mono = false }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-[11px] font-medium uppercase tracking-widest text-subtle">{label}</span>
      <span className={cn('flex items-center gap-1.5 text-sm font-semibold tabular-nums text-ink', mono && 'mono')}>
        {children}
      </span>
    </div>
  );
}

function RowsHeader({ icon: Icon, title }: { icon: typeof ArrowRight; title: string }) {
  return (
    <div className="flex items-center gap-2.5 pb-1">
      <div className="flex size-9 items-center justify-center rounded-xl bg-brand/10 text-brand">
        <Icon className="size-4" />
      </div>
      <span className="text-sm font-semibold text-ink">{title}</span>
    </div>
  );
}

function Recipient({ address, contacts, arcLabels }: { address: string; contacts: Contact[]; arcLabels: Record<string, string> }) {
  const name = arcLabels[address.toLowerCase()] ?? contactName(address, contacts);
  return name ? (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="font-semibold text-ink">{name}</span>
      <span className="mono truncate text-xs text-subtle">{formatAddr(address)}</span>
    </span>
  ) : (
    <span className="mono truncate text-ink-2">{formatAddr(address)}</span>
  );
}

// Editable list: change an amount or drop a row, then everything re-validates and re-simulates
function BatchRows({
  intent,
  contacts,
  arcLabels,
  onEdit,
  editable,
  sim,
}: {
  intent: BatchIntent;
  contacts: Contact[];
  arcLabels: Record<string, string>;
  onEdit: (next: BatchIntent) => void;
  editable: boolean;
  sim: TxPreview;
}) {
  // Sum for display only; validateBatch owns the exact total used on-chain
  const displayTotal = intent.items.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);

  const setAmount = (index: number, amount: string) =>
    onEdit({ ...intent, items: intent.items.map((it, i) => (i === index ? { ...it, amount } : it)) });
  const removeRow = (index: number) => onEdit({ ...intent, items: intent.items.filter((_, i) => i !== index) });

  return (
    <div className="space-y-3">
      <RowsHeader icon={Users} title={`Batch payment · ${intent.items.length} recipients`} />
      <ol className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
        {intent.items.map((item, i) => (
          <li key={`${item.recipient}-${i}`} className="flex items-center justify-between gap-2 rounded-lg bg-surface px-3 py-1.5 text-sm">
            <span className="flex min-w-0 items-center gap-2.5">
              <span className="w-5 shrink-0 text-right text-xs tabular-nums text-subtle">{i + 1}</span>
              <Recipient address={item.recipient} contacts={contacts} arcLabels={arcLabels} />
            </span>
            <span className="flex shrink-0 items-center gap-1">
              {editable ? (
                <input
                  value={item.amount}
                  onChange={(e) => setAmount(i, e.target.value.replace(/[^\d.]/g, ''))}
                  inputMode="decimal"
                  aria-label={`Amount for row ${i + 1}`}
                  className="w-20 rounded-md border border-transparent bg-transparent px-1.5 py-1 text-right font-semibold tabular-nums text-ink outline-none hover:border-line/15 focus:border-brand/50 focus:bg-surface-2"
                />
              ) : (
                <span className="font-semibold tabular-nums text-ink">{item.amount}</span>
              )}
              <span className="text-xs text-muted">{intent.token}</span>
              {editable && (
                <button
                  onClick={() => removeRow(i)}
                  aria-label={`Remove row ${i + 1}`}
                  className="ml-1 flex size-7 items-center justify-center rounded-md text-subtle transition-colors hover:bg-danger/10 hover:text-danger"
                >
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </span>
          </li>
        ))}
      </ol>
      <div className="border-t border-line/10 pt-3">
        <Row label="Total">
          {intent.token === 'USDC' && <TokenUSDC size={16} variant="branded" />}
          {displayTotal.toLocaleString(undefined, { maximumFractionDigits: 6 })} {intent.token}
        </Row>
      </div>
      <Row label="Network">{ACTIVE_CHAIN.name}</Row>
      <Row label="Network fee">
        <FeeValue sim={sim} />
      </Row>
    </div>
  );
}

function fmt(raw: bigint, decimals: number): string {
  return formatTokenAmount(Number(formatUnits(raw, decimals)), decimals);
}

function SwapRows({
  intent,
  check,
  quote,
  sim,
}: {
  intent: SwapIntent;
  check: Extract<SwapCheck, { ok: true }>;
  quote: QuoteState;
  sim: TxPreview;
}) {
  const { tokenIn, tokenOut, venue } = check;
  const q = quote.status === 'ok' ? quote.quote : null;
  // Rate from the actual quote: how much tokenOut one tokenIn buys at this size
  const rate = q ? Number(formatUnits(q.amountOut, tokenOut.decimals)) / Number(formatUnits(q.amountIn, tokenIn.decimals)) : null;

  return (
    <div className="space-y-3">
      <RowsHeader icon={ArrowUpDown} title={`Swap ${tokenIn.symbol} → ${tokenOut.symbol}`} />
      <Row label="You pay">
        {tokenIn.symbol === 'USDC' && <TokenUSDC size={16} variant="branded" />}
        {intent.amountIn} {tokenIn.symbol}
      </Row>
      <Row label="You receive">
        {quote.status === 'loading' ? (
          <Loader2 className="size-3.5 animate-spin text-muted" />
        ) : q ? (
          <>
            {tokenOut.symbol === 'USDC' && <TokenUSDC size={16} variant="branded" />}~{fmt(q.amountOut, tokenOut.decimals)} {tokenOut.symbol}
          </>
        ) : (
          <span className="font-medium text-danger">No quote</span>
        )}
      </Row>
      {q && rate != null && (
        <>
          <Row label="Rate">
            1 {tokenIn.symbol} = {formatTokenAmount(rate, 8)} {tokenOut.symbol}
          </Row>
          <Row label="Minimum received">
            {fmt(q.minOut, tokenOut.decimals)} {tokenOut.symbol}
          </Row>
          <Row label="Route">
            <span className="font-medium text-ink-2">
              {q.lifi ? `${q.lifi.tool} via LI.FI` : `${venue.name} · ${q.fee / 10_000}% pool`}
            </span>
          </Row>
          {q.lifi && q.lifi.feeUsd > 0 && (
            <Row label="LI.FI fee">
              <span className="font-medium text-ink-2">~${q.lifi.feeUsd.toFixed(3)} (included)</span>
            </Row>
          )}
        </>
      )}
      <Row label="Network fee">
        <FeeValue sim={sim} />
      </Row>
      {quote.status === 'none' && (
        <p className="text-xs text-danger">
          {venue.kind === 'lifi' ? 'LI.FI found no route' : `No ${venue.name} pool can fill this size`} right now. Try a smaller amount.
        </p>
      )}
      {quote.status === 'error' && <p className="text-xs text-danger">Couldn't get a price from {venue.name}. Close and try again.</p>}
      {q && (
        <p className="pt-1 text-xs leading-relaxed text-muted">
          Prices refresh every 20s. If the price moves more than 0.5% before your swap lands, it reverts and nothing is swapped.
        </p>
      )}
    </div>
  );
}

function ArcNameRows({
  intent,
  account,
  onEdit,
  editable,
  sim,
  yearlyFee,
}: {
  intent: ArcNameIntent;
  account?: `0x${string}`;
  onEdit: (next: ArcNameIntent) => void;
  editable: boolean;
  sim: TxPreview;
  yearlyFee?: bigint;
}) {
  const paid = intent.op === 'register' || intent.op === 'renew';
  const title = intent.op === 'register' ? 'Register name' : intent.op === 'renew' ? 'Renew name' : 'Set primary name';
  return (
    <div className="space-y-3">
      <RowsHeader icon={AtSign} title={title} />
      <Row label="Name">
        <span className="display text-base">
          {intent.label}
          <span className="text-brand">.arc</span>
        </span>
      </Row>
      <Row label="Owner">{account ? <span className="mono text-xs text-ink-2">{formatAddr(account)} (you)</span> : '—'}</Row>
      {paid && (
        <Row label="Duration">
          {editable ? (
            <select
              value={intent.years}
              onChange={(e) => onEdit({ ...intent, years: Number(e.target.value) })}
              aria-label="Years"
              className="rounded-lg border border-line/15 bg-surface px-2 py-1 text-sm font-semibold text-ink outline-none focus:border-brand/50"
            >
              {Array.from({ length: ARC_NAME_MAX_YEARS }, (_, i) => i + 1).map((y) => (
                <option key={y} value={y}>
                  {y} year{y === 1 ? '' : 's'}
                </option>
              ))}
            </select>
          ) : (
            `${intent.years} year${intent.years === 1 ? '' : 's'}`
          )}
        </Row>
      )}
      {paid && (
        <Row label="Name fee">
          <TokenUSDC size={16} variant="branded" />
          {yearlyFee != null ? formatUsdcFee(yearlyFee * BigInt(intent.years)) : <Loader2 className="size-3.5 animate-spin text-muted" />}
        </Row>
      )}
      <Row label="Network">{ACTIVE_CHAIN.name}</Row>
      <Row label="Network fee">
        <FeeValue sim={sim} />
      </Row>
      {intent.op === 'register' && (
        <p className="pt-1 text-xs leading-relaxed text-muted">
          Once registered, anyone can pay you at <span className="font-semibold text-ink">{intent.label}.arc</span>. The name is an NFT
          in your wallet and becomes your primary name if you don't have one yet.
        </p>
      )}
    </div>
  );
}

function IntentRows({
  intent,
  contacts,
  arcLabels,
  sim,
  gasless,
}: {
  intent: ParsedIntent;
  contacts: Contact[];
  arcLabels: Record<string, string>;
  sim: TxPreview;
  /** Present when a gasless send is possible */
  gasless?: { on: boolean; set: (on: boolean) => void; editable: boolean };
}) {
  switch (intent.type) {
    case 'send':
      return (
        <div className="space-y-3">
          <RowsHeader icon={ArrowRight} title="Send" />
          <Row label="Amount">
            {intent.token === 'USDC' && <TokenUSDC size={16} variant="branded" />}
            {intent.amount} {intent.token}
          </Row>
          <Row label="To">
            {intent.recipient ? <Recipient address={intent.recipient} contacts={contacts} arcLabels={arcLabels} /> : '—'}
          </Row>
          <Row label="Network">{ACTIVE_CHAIN.name}</Row>
          <Row label="Network fee">
            <FeeValue sim={sim} />
          </Row>
          {gasless && (
            <label className="flex cursor-pointer items-center justify-between gap-3 border-t border-line/10 pt-3 text-sm">
              <span>
                <span className="font-medium text-ink">Gasless</span>
                <span className="block text-xs text-muted">Sign once; Circle submits it and pays the fee</span>
              </span>
              <input
                type="checkbox"
                checked={gasless.on}
                disabled={!gasless.editable}
                onChange={(e) => gasless.set(e.target.checked)}
                className="size-4 accent-[rgb(var(--brand))]"
              />
            </label>
          )}
        </div>
      );

    case 'swap':
      return (
        <div className="space-y-3">
          <RowsHeader icon={ArrowUpDown} title="Swap" />
          <Row label="You pay">
            {intent.tokenIn === 'USDC' && <TokenUSDC size={16} variant="branded" />}
            {intent.amountIn} {intent.tokenIn}
          </Row>
          <Row label="You get">
            {intent.tokenOut === 'USDC' && <TokenUSDC size={16} variant="branded" />}
            {intent.tokenOut} (no quote yet)
          </Row>
          <Row label="Network">{ACTIVE_CHAIN.name}</Row>
        </div>
      );

    case 'add_lp':
      return (
        <div className="space-y-3">
          <RowsHeader icon={Droplets} title="Add liquidity" />
          <Row label="Amount">
            {intent.amount} {intent.token}
          </Row>
          {intent.pair && <Row label="Pair">{intent.pair}</Row>}
          {intent.protocol && (
            <Row label="Protocol">{intent.protocol.charAt(0).toUpperCase() + intent.protocol.slice(1)}</Row>
          )}
          <Row label="Network">{ACTIVE_CHAIN.name}</Row>
        </div>
      );

    case 'balance':
      return (
        <div className="space-y-3">
          <RowsHeader icon={Wallet} title="Check balance" />
          <Row label="Token">{intent.token ?? 'USDC'}</Row>
          <Row label="Network">{ACTIVE_CHAIN.name}</Row>
        </div>
      );

    default:
      return <p className="text-sm text-muted">Could not parse this command.</p>;
  }
}

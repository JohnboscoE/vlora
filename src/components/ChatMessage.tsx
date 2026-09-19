import { useState } from 'react';
import { motion } from 'framer-motion';
import { CheckCircle2, AlertCircle, Loader2, ExternalLink, Circle, Copy, Check, XCircle } from 'lucide-react';
import { LogoMark } from './Logo';
import { cn } from '@/lib/utils';

export type MessageRole = 'user' | 'agent';
export type MessageStatus = 'idle' | 'parsing' | 'pending' | 'confirming' | 'success' | 'error' | 'info';

export type StepState = 'pending' | 'active' | 'done' | 'error';

export interface TxStep {
  label: string;
  state: StepState;
}

export interface ChatMessageData {
  id: string;
  role: MessageRole;
  text: string;
  status?: MessageStatus;
  txHash?: string;
  explorerUrl?: string;
  /** Live progress for a transaction (sign → approve → confirm) */
  steps?: TxStep[];
  /** Shows a copy button, e.g. for a payment request link */
  copyText?: string;
  timestamp: number;
}

function StepIcon({ state }: { state: StepState }) {
  if (state === 'done') return <CheckCircle2 className="size-4 text-success" />;
  if (state === 'active') return <Loader2 className="size-4 animate-spin text-brand" />;
  if (state === 'error') return <XCircle className="size-4 text-danger" />;
  return <Circle className="size-4 text-subtle" />;
}

function StepTracker({ steps }: { steps: TxStep[] }) {
  return (
    <ol className="mt-3 space-y-2" aria-label="Transaction progress">
      {steps.map((step, i) => (
        <li key={step.label} className="flex items-center gap-2.5">
          <StepIcon state={step.state} />
          <span
            className={cn(
              'text-sm',
              step.state === 'pending' && 'text-subtle',
              step.state === 'active' && 'font-medium text-ink',
              step.state === 'done' && 'text-ink-2',
              step.state === 'error' && 'text-danger',
            )}
          >
            {step.label}
          </span>
          {i < steps.length - 1 && <span className="sr-only">then</span>}
        </li>
      ))}
    </ol>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        } catch {
          // clipboard blocked: the link is still visible to select manually
        }
      }}
      className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-ink transition-transform hover:scale-[1.02]"
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {copied ? 'Copied' : 'Copy link'}
    </button>
  );
}

function StatusIcon({ status }: { status?: MessageStatus }) {
  if (status === 'success') return <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />;
  if (status === 'error') return <AlertCircle className="mt-0.5 size-4 shrink-0 text-danger" />;
  if (status === 'pending' || status === 'confirming' || status === 'parsing') {
    return <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-muted" />;
  }
  return null;
}

export function ChatMessage({ msg }: { msg: ChatMessageData }) {
  const isUser = msg.role === 'user';
  const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: 'easeOut' }}
      className={cn('flex gap-3', isUser ? 'justify-end' : 'justify-start')}
    >
      {!isUser && <LogoMark className="mt-0.5 size-8" />}

      <div className={cn('flex max-w-[85%] flex-col gap-1 md:max-w-[75%]', isUser ? 'items-end' : 'items-start')}>
        <div
          className={cn(
            'rounded-2xl px-4 py-3 text-sm leading-relaxed',
            isUser && 'rounded-br-md bg-brand text-white',
            !isUser && msg.status === 'success' && 'rounded-bl-md border border-success/25 bg-success/10 text-ink',
            !isUser && msg.status === 'error' && 'rounded-bl-md border border-danger/25 bg-danger/10 text-ink',
            !isUser && msg.status !== 'success' && msg.status !== 'error' && 'rounded-bl-md border border-line/10 bg-surface-2 text-ink',
          )}
        >
          <div className="flex items-start gap-2">
            {!isUser && <StatusIcon status={msg.status} />}
            <span className="whitespace-pre-line break-words [overflow-wrap:anywhere]">{msg.text}</span>
          </div>

          {msg.steps && <StepTracker steps={msg.steps} />}
          {msg.copyText && <CopyButton text={msg.copyText} />}

          {msg.explorerUrl && msg.txHash && (
            <a
              href={msg.explorerUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg bg-surface px-2.5 py-1.5 text-xs font-medium text-brand ring-1 ring-line/10 transition-colors hover:bg-surface-2"
            >
              <span className="mono">{`${msg.txHash.slice(0, 10)}…${msg.txHash.slice(-6)}`}</span>
              View on explorer
              <ExternalLink className="size-3" />
            </a>
          )}
        </div>

        <span className="px-1 text-[10px] tabular-nums text-subtle">{time}</span>
      </div>
    </motion.div>
  );
}

// Three bouncing dots in an agent bubble while Vlora "thinks"
export function TypingBubble() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.12 } }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className="flex gap-3"
      role="status"
      aria-label="Vlora is typing"
    >
      <LogoMark className="mt-0.5 size-8" />
      <div className="flex h-11 items-center gap-1.5 rounded-2xl rounded-bl-md border border-line/10 bg-surface-2 px-4">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="size-2 rounded-full bg-muted"
            animate={{ y: [0, -5, 0], opacity: [0.45, 1, 0.45] }}
            transition={{ duration: 0.9, repeat: Infinity, ease: 'easeInOut', delay: i * 0.15 }}
          />
        ))}
      </div>
    </motion.div>
  );
}

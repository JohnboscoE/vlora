import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Check, ExternalLink, Loader2, Wallet } from 'lucide-react';
import { ACTIVE_CHAIN } from '@/chain-env';
import { cn } from '@/lib/utils';
import { LogoMark } from './Logo';

const COMMAND = 'send 25 USDC to 0x8f3a…9c21';

// Each phase of the simulated flow and how long it holds before the next one.
// "typing" lasts as long as the typewriter takes; the rest are fixed holds.
const PHASES = ['typing', 'sent', 'reply', 'press', 'signing', 'confirming', 'done', 'reset'] as const;
type Phase = (typeof PHASES)[number];

const HOLD_MS: Record<Exclude<Phase, 'typing'>, number> = {
  sent: 450,
  reply: 1700,
  press: 450,
  signing: 1400,
  confirming: 1500,
  done: 2800,
  reset: 550,
};

const TYPE_MS_PER_CHAR = 55;

function after(phase: Phase, current: Phase) {
  return PHASES.indexOf(current) >= PHASES.indexOf(phase);
}

const bubbleMotion = {
  initial: { opacity: 0, y: 10, scale: 0.98 },
  animate: { opacity: 1, y: 0, scale: 1 },
  transition: { duration: 0.28, ease: 'easeOut' },
} as const;

export function TxDemo({ className }: { className?: string }) {
  const reduceMotion = useReducedMotion();
  const [phase, setPhase] = useState<Phase>(reduceMotion ? 'done' : 'typing');
  const [typed, setTyped] = useState(reduceMotion ? COMMAND.length : 0);

  // Drive the loop: typewriter first, then step through the timed phases forever
  useEffect(() => {
    if (reduceMotion) return;

    if (phase === 'typing') {
      if (typed < COMMAND.length) {
        const t = window.setTimeout(() => setTyped((n) => n + 1), TYPE_MS_PER_CHAR);
        return () => window.clearTimeout(t);
      }
      const t = window.setTimeout(() => setPhase('sent'), 350);
      return () => window.clearTimeout(t);
    }

    const t = window.setTimeout(() => {
      if (phase === 'reset') {
        setTyped(0);
        setPhase('typing');
      } else {
        setPhase(PHASES[PHASES.indexOf(phase) + 1]);
      }
    }, HOLD_MS[phase]);
    return () => window.clearTimeout(t);
  }, [phase, typed, reduceMotion]);

  const showUserBubble = after('sent', phase);
  const showReply = after('reply', phase);
  const pressed = phase === 'press';
  const cardStatus: 'idle' | 'signing' | 'confirming' | 'done' =
    phase === 'signing' ? 'signing' : phase === 'confirming' ? 'confirming' : after('done', phase) ? 'done' : 'idle';

  return (
    <div
      className={cn(
        'flex w-full max-w-sm flex-col rounded-3xl border border-white/15 bg-white/10 p-4 shadow-2xl backdrop-blur-xl',
        className,
      )}
      aria-label="Animated example: a one-line instruction becomes a confirmed 25 USDC transfer"
      role="img"
    >
      {/* Window chrome */}
      <div className="mb-4 flex items-center justify-between">
        <span className="flex items-center gap-2"><LogoMark className="size-6" /><span className="display text-sm font-semibold text-white">Vlora</span></span>
        <span className="flex items-center gap-1.5 text-[11px] text-white/70">
          <span className="size-1.5 rounded-full bg-[#7ef1b3]" />
          {ACTIVE_CHAIN.name}
        </span>
      </div>

      <motion.div
        className="flex min-h-[340px] flex-col gap-3"
        animate={{ opacity: phase === 'reset' ? 0 : 1 }}
        transition={{ duration: 0.4 }}
      >
        {/* User command */}
        <AnimatePresence>
          {showUserBubble && (
            <motion.div key="user" {...bubbleMotion} className="flex justify-end">
              <div className="rounded-2xl rounded-br-md bg-white px-4 py-2.5 text-sm font-medium text-[#0b1830]">
                {COMMAND}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Agent reply + confirmation card */}
        <AnimatePresence>
          {showReply && (
            <motion.div key="reply" {...bubbleMotion} className="flex flex-col gap-2">
              <p className="text-xs text-white/75">Here's exactly what will happen:</p>
              <div className="rounded-2xl bg-white/95 p-4 text-[#122d45]">
                <dl className="space-y-2 text-sm">
                  {[
                    ['Amount', '25 USDC'],
                    ['To', '0x8f3a…9c21'],
                    ['Network', ACTIVE_CHAIN.name],
                  ].map(([k, v]) => (
                    <div key={k} className="flex justify-between">
                      <dt className="text-[11px] font-medium uppercase tracking-widest text-[#8a849c]">{k}</dt>
                      <dd className="font-semibold tabular-nums">{v}</dd>
                    </div>
                  ))}
                </dl>

                <motion.div
                  className={cn(
                    'mt-4 flex h-10 items-center justify-center gap-2 overflow-hidden rounded-xl text-sm font-semibold text-white',
                    cardStatus === 'done' ? 'bg-[#1a8047]' : 'bg-[#122d45]',
                  )}
                  animate={{ scale: pressed ? 0.95 : 1 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 22 }}
                >
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.span
                      key={cardStatus}
                      className="flex items-center gap-2"
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ duration: 0.18 }}
                    >
                      {cardStatus === 'idle' && 'Execute'}
                      {cardStatus === 'signing' && (
                        <>
                          <Wallet className="size-4" /> Confirm in wallet…
                        </>
                      )}
                      {cardStatus === 'confirming' && (
                        <>
                          <Loader2 className="size-4 animate-spin" /> Confirming on Arc…
                        </>
                      )}
                      {cardStatus === 'done' && (
                        <>
                          <Check className="size-4" /> Confirmed
                        </>
                      )}
                    </motion.span>
                  </AnimatePresence>
                </motion.div>

                {/* Settlement progress */}
                <div className="mt-3 h-1 overflow-hidden rounded-full bg-[#122d45]/10">
                  <motion.div
                    className="h-full rounded-full bg-gradient-to-r from-[#1f51ff] to-[#00e5ff]"
                    initial={false}
                    animate={{
                      width:
                        cardStatus === 'idle' ? '0%' : cardStatus === 'signing' ? '30%' : cardStatus === 'confirming' ? '80%' : '100%',
                    }}
                    transition={{ duration: cardStatus === 'confirming' ? 1.3 : 0.4, ease: 'easeOut' }}
                  />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Completion */}
        <AnimatePresence>
          {after('done', phase) && (
            <motion.div
              key="done"
              {...bubbleMotion}
              className="flex items-start gap-2.5 rounded-2xl bg-[#7ef1b3]/15 px-3.5 py-3 text-sm text-white"
            >
              <motion.span
                className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-[#7ef1b3] text-[#0b1830]"
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 420, damping: 14, delay: 0.1 }}
              >
                <Check className="size-3.5" strokeWidth={3} />
              </motion.span>
              <div>
                <p className="font-medium">Sent 25 USDC. Confirmed on {ACTIVE_CHAIN.name}.</p>
                <p className="mt-1 flex items-center gap-1 text-xs text-white/70">
                  View on explorer <ExternalLink className="size-3" />
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* Composer with typewriter */}
      <div className="mt-3 flex h-11 items-center gap-2 rounded-2xl bg-white/90 px-4 text-sm text-[#0b1830]">
        <span className="flex-1 truncate">
          {phase === 'typing' ? (
            <>
              {COMMAND.slice(0, typed)}
              <span className="ml-px inline-block h-4 w-px translate-y-0.5 animate-pulse bg-[#0b1830]" />
            </>
          ) : (
            <span className="text-[#8a849c]">Type a command…</span>
          )}
        </span>
        <span
          className={cn(
            'flex size-7 items-center justify-center rounded-lg bg-[#122d45] text-white transition-opacity',
            phase === 'typing' && typed === COMMAND.length ? 'opacity-100' : 'opacity-40',
          )}
        >
          <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </span>
      </div>
    </div>
  );
}

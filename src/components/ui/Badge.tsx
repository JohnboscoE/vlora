import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

type Tone = 'neutral' | 'brand' | 'success' | 'danger' | 'muted';

const TONES: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-ink-2',
  brand: 'bg-brand/10 text-brand',
  success: 'bg-success/10 text-success',
  danger: 'bg-danger/10 text-danger',
  muted: 'bg-surface-2 text-subtle',
};

/**
 * A small piece of state: Live, Pending, Testnet, 3 people.
 *
 * `dot` puts a filled circle in front, which is how a status reads at a glance
 * without relying on the colour alone — the same badge works for someone who
 * can't tell the green from the red.
 */
export function Badge({
  children,
  tone = 'neutral',
  dot = false,
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  dot?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-pill px-2 py-0.5 text-micro font-semibold',
        TONES[tone],
        className,
      )}
    >
      {dot && <span className="size-1.5 rounded-pill bg-current" />}
      {children}
    </span>
  );
}

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * The app's surface.
 *
 * This treatment was pasted inline in fifteen places, so it had already drifted:
 * some cards had the border, some didn't, padding ran from p-4 to p-5. One
 * component means a change to the surface is a change to every surface.
 */
export function Card({
  children,
  className,
  padding = 'normal',
  nested = false,
}: {
  children: ReactNode;
  className?: string;
  /** `tight` for dense lists and nested cards, `none` when the child paints its own edges */
  padding?: 'none' | 'tight' | 'normal';
  /** A card inside another card: smaller radius, flat background, no blur */
  nested?: boolean;
}) {
  return (
    <section
      className={cn(
        nested ? 'rounded-card-sm bg-surface-2' : 'rounded-card border border-line/10 bg-surface/80 backdrop-blur',
        padding === 'normal' && 'p-5',
        padding === 'tight' && 'p-3.5',
        className,
      )}
    >
      {children}
    </section>
  );
}

/**
 * A card's heading. Small, uppercase and wide-tracked — the label is furniture,
 * so it stays quiet and lets the content it introduces be the thing you read.
 */
export function CardTitle({ children, className, action }: { children: ReactNode; className?: string; action?: ReactNode }) {
  return (
    <div className={cn('flex items-center justify-between gap-3', className)}>
      <h2 className="text-micro font-semibold uppercase tracking-[0.16em] text-subtle">{children}</h2>
      {action}
    </div>
  );
}

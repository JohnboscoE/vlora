import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

/**
 * Four variants, and each one means something: `primary` is the action the
 * screen exists for and there is at most one per view; `secondary` is a real
 * alternative; `ghost` is a way out or a minor extra; `danger` is a thing you
 * can't undo.
 *
 * Deciding that here rather than at each call site is what stops a screen
 * growing three equally loud buttons.
 */
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-primary text-primary-ink hover:opacity-90 active:opacity-80',
  secondary: 'border border-line/15 bg-surface text-ink hover:bg-surface-2',
  ghost: 'text-muted hover:bg-surface-2 hover:text-ink',
  danger: 'bg-danger/10 text-danger hover:bg-danger/15',
};

const SIZES: Record<Size, string> = {
  sm: 'gap-1.5 px-3 py-1.5 text-xs',
  md: 'gap-2 px-4 py-2.5 text-sm',
  lg: 'gap-2 px-5 py-3 text-sm',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** Shows a spinner in place of any leading icon and blocks further presses */
  busy?: boolean;
  icon?: ReactNode;
  full?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', busy = false, icon, full = false, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      // A busy button that can still be pressed sends the transaction twice
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={cn(
        'inline-flex items-center justify-center rounded-control font-semibold transition disabled:opacity-40',
        VARIANTS[variant],
        SIZES[size],
        full && 'w-full',
        className,
      )}
      {...rest}
    >
      {busy ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
});

import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * What a section says before it has anything in it.
 *
 * An empty panel reads as broken, so every one of these says what belongs here
 * and gives one thing to do about it — usually the sentence you would type,
 * since typing is how the app works.
 */
export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  /** One suggestion, not a menu: a sentence to try, or a single button */
  action?: { label: string; onClick: () => void };
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center px-4 py-8 text-center', className)}>
      <span className="flex size-10 items-center justify-center rounded-pill bg-surface-2 text-subtle">
        <Icon className="size-[18px]" />
      </span>
      <p className="mt-3 text-sm font-semibold text-ink">{title}</p>
      <p className="mt-1 max-w-[34ch] text-xs leading-relaxed text-muted">{body}</p>
      {action && (
        <button
          onClick={action.onClick}
          className="mono mt-3 rounded-pill bg-brand/10 px-3 py-1.5 text-xs font-medium text-brand transition hover:bg-brand/15"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

import { cn } from '@/lib/utils';

/**
 * A placeholder shaped like the thing that is coming.
 *
 * A spinner says "wait"; a skeleton says "wait, and here is what for" — and
 * because it occupies the final layout, the page doesn't jump when the data
 * lands. Every wait in the app used to be a spinner or an empty box.
 */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('animate-pulse rounded-control bg-surface-2', className)} />;
}

/** Placeholder rows for a list that is still loading */
export function SkeletonRows({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('space-y-2', className)} role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center justify-between gap-3 rounded-card-sm bg-surface-2/60 px-3 py-2.5">
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-3 w-2/5" />
            <Skeleton className="h-2.5 w-1/4 opacity-60" />
          </div>
          <Skeleton className="h-3 w-14" />
        </div>
      ))}
    </div>
  );
}

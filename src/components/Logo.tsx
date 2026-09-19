import { useId } from 'react';
import { cn } from '@/lib/utils';

// Vlora mark: a "V" drawn as a checkmark (short left arm) — the brand letter and
// "payment confirmed" in one stroke. Same geometry as public/favicon.svg.
export function LogoMark({ className }: { className?: string }) {
  const gradientId = useId();

  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden="true"
      className={cn('size-8 shrink-0 drop-shadow-[0_4px_12px_rgba(31,81,255,0.35)]', className)}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1f51ff" />
          <stop offset="1" stopColor="#00c6e6" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill={`url(#${gradientId})`} />
      <path
        d="M17 27 L28.5 45 L47 17"
        fill="none"
        stroke="#fff"
        strokeWidth="7.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

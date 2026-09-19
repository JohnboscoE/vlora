import { Moon, Sun } from 'lucide-react';
import { useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';

// `overlay` is for placement on the always-dark shader hero
export function ThemeToggle({ variant = 'default', className }: { variant?: 'default' | 'overlay'; className?: string }) {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={isDark ? 'Light mode' : 'Dark mode'}
      className={cn(
        'relative flex size-10 items-center justify-center overflow-hidden rounded-full transition-colors',
        variant === 'overlay'
          ? 'border border-white/20 bg-white/10 text-white hover:bg-white/20'
          : 'border border-line/15 bg-surface text-ink hover:bg-surface-2',
        className,
      )}
    >
      <Sun className={cn('absolute size-[18px] transition-all duration-300', isDark ? 'rotate-90 scale-0 opacity-0' : 'rotate-0 scale-100 opacity-100')} />
      <Moon className={cn('absolute size-[18px] transition-all duration-300', isDark ? 'rotate-0 scale-100 opacity-100' : '-rotate-90 scale-0 opacity-0')} />
    </button>
  );
}

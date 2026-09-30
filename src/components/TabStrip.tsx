import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface TabItem {
  id: string;
  label: string;
  icon: LucideIcon;
}

interface TabStripProps {
  tabs: TabItem[];
  active: string;
  onSelect: (id: string) => void;
}

/**
 * The app's navigation.
 *
 * Everything used to live inside the chat, which meant six collapsed panels
 * stacked above the messages and, on a phone, no messages left. Each of those is
 * now a tab, and the chat is simply the first one.
 *
 * A scrolling strip rather than a fixed bottom bar: a bottom bar fights the
 * keyboard in a wallet's in-app browser, and this holds as many tabs as the app
 * grows to without a "more" menu.
 */
export function TabStrip({ tabs, active, onSelect }: TabStripProps) {
  return (
    <div
      role="tablist"
      aria-label="Sections"
      className="flex gap-1 overflow-x-auto border-b border-line/10 px-3 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {tabs.map((tab) => {
        const selected = tab.id === active;
        const Icon = tab.icon;
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={selected}
            onClick={() => onSelect(tab.id)}
            className={cn(
              'flex shrink-0 items-center gap-1.5 rounded-pill px-3 py-1.5 text-xs font-semibold transition-colors',
              selected ? 'bg-brand/10 text-brand' : 'text-muted hover:bg-surface-2 hover:text-ink',
            )}
          >
            <Icon className="size-3.5" />
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

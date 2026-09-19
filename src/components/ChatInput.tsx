import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Paperclip, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SlashCommand {
  id: string;
  label: string;
  hint: string;
  icon: LucideIcon;
  /**
   * `insert`: put `template` in the box ("|" marks where the cursor goes);
   * `submit`: send `template` right away; `csv`: open the file picker.
   */
  action: 'insert' | 'submit' | 'csv';
  template?: string;
}

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (text: string) => void;
  onImportCsv: (file: File) => void;
  commands: SlashCommand[];
  disabled?: boolean;
  placeholder?: string;
}

export function ChatInput({ value, onChange, onSubmit, onImportCsv, commands, disabled, placeholder }: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [active, setActive] = useState(0);
  const [menuDismissed, setMenuDismissed] = useState(false);

  // "/" at the start opens the menu; the text after it filters by name
  const slashQuery = /^\/\S*$/.test(value) ? value.slice(1).toLowerCase() : null;
  const matches = slashQuery == null ? [] : commands.filter((c) => c.id.startsWith(slashQuery) || c.label.toLowerCase().includes(slashQuery));
  const menuOpen = matches.length > 0 && !menuDismissed;

  useEffect(() => {
    setActive(0);
    if (slashQuery == null) setMenuDismissed(false);
  }, [slashQuery]);

  // Auto-grow whenever the value changes, including when it's prefilled from outside
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [value]);

  // Focus the box when an example prefills it, with the cursor at the end
  useEffect(() => {
    const el = textareaRef.current;
    if (!el || !value || document.activeElement === el) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(value.length, value.length);
  }, [value]);

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSubmit(trimmed);
    onChange('');
  };

  const runCommand = (cmd: SlashCommand) => {
    if (cmd.action === 'csv') {
      onChange('');
      fileRef.current?.click();
      return;
    }
    const template = cmd.template ?? '';
    if (cmd.action === 'submit') {
      onChange('');
      if (!disabled) onSubmit(template);
      return;
    }
    const cursor = template.indexOf('|');
    const text = template.replace('|', '');
    onChange(text);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus({ preventScroll: true });
      const at = cursor === -1 ? text.length : cursor;
      el.setSelectionRange(at, at);
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (menuOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const step = e.key === 'ArrowDown' ? 1 : -1;
        setActive((i) => (i + step + matches.length) % matches.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const cmd = matches[active];
        if (cmd) runCommand(cmd);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMenuDismissed(true);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="relative">
      {menuOpen && (
        <ul
          role="listbox"
          aria-label="Quick actions"
          className="absolute inset-x-0 bottom-full z-20 mb-2 overflow-hidden rounded-2xl border border-line/15 bg-surface p-1.5 shadow-xl"
        >
          {matches.map((cmd, i) => {
            const Icon = cmd.icon;
            return (
              <li key={cmd.id} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => e.preventDefault()} // keep focus in the textarea
                  onClick={() => runCommand(cmd)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors',
                    i === active ? 'bg-surface-2' : 'hover:bg-surface-2',
                  )}
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
                    <Icon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-sm font-medium text-ink">
                      {cmd.label}
                      <span className="mono text-[11px] text-subtle">/{cmd.id}</span>
                    </span>
                    <span className="block truncate text-xs text-muted">{cmd.hint}</span>
                  </span>
                </button>
              </li>
            );
          })}
          <li className="px-3 pb-1 pt-1.5 text-[10px] text-subtle">↑↓ to move · Enter to pick · Esc to close</li>
        </ul>
      )}

      <div className="flex items-end gap-2 rounded-2xl border border-line/15 bg-surface py-2 pl-2 pr-2 shadow-sm transition-shadow focus-within:border-brand/50 focus-within:ring-4 focus-within:ring-brand/10">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={disabled}
          aria-label="Import a CSV of payments"
          title="Import a CSV of payments (address, amount)"
          className="flex size-9 shrink-0 items-center justify-center rounded-xl text-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-40"
        >
          <Paperclip className="size-4" />
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.tsv,.txt,text/csv,text/plain"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onImportCsv(file);
            e.target.value = ''; // allow picking the same file again
          }}
        />
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder={placeholder ?? 'Type a command, or / for quick actions'}
          rows={1}
          aria-label="Command"
          aria-expanded={menuOpen}
          className="max-h-[160px] flex-1 resize-none bg-transparent py-2 text-sm leading-relaxed text-ink outline-none placeholder:text-subtle disabled:opacity-60"
        />
        <button
          onClick={handleSubmit}
          disabled={!value.trim() || disabled}
          className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-ink transition-all hover:scale-105 active:scale-95 disabled:scale-100 disabled:opacity-30"
          aria-label="Send"
        >
          <ArrowUp className="size-4" strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
}

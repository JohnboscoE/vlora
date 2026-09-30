import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const CONTROL =
  'w-full rounded-control border border-line/15 bg-surface px-3 py-2.5 text-sm text-ink outline-none transition placeholder:text-subtle focus:border-brand/50 disabled:opacity-50';

/**
 * A labelled control.
 *
 * The label is a real `<label>` tied to the input by id, so a screen reader
 * announces it and a tap on the words puts the cursor in the box. Most of these
 * were a bare `<input>` under a `<span>`, which does neither.
 */
export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  hint?: ReactNode;
  /** Shown in place of the hint, and wired to the control via aria-describedby */
  error?: string | null;
  children: (props: { id: string; 'aria-describedby': string | undefined; 'aria-invalid': boolean | undefined }) => ReactNode;
  className?: string;
}) {
  const id = useId();
  const noteId = error || hint ? `${id}-note` : undefined;
  return (
    <div className={className}>
      <label htmlFor={id} className="block text-xs font-medium text-muted">
        {label}
      </label>
      <div className="mt-1.5">
        {children({ id, 'aria-describedby': noteId, 'aria-invalid': error ? true : undefined })}
      </div>
      {(error || hint) && (
        <p id={noteId} className={cn('mt-1.5 text-xs', error ? 'text-danger' : 'text-subtle')}>
          {error || hint}
        </p>
      )}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest },
  ref,
) {
  return <input ref={ref} className={cn(CONTROL, className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, ...rest },
  ref,
) {
  return <select ref={ref} className={cn(CONTROL, 'appearance-none', className)} {...rest} />;
});

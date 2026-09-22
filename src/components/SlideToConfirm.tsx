import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { ArrowRight, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

const THUMB = 44; // px
const PAD = 4; // px, rail padding around the thumb
const CONFIRM_AT = 0.85; // fraction of the track the thumb must travel

/**
 * Drag the thumb to the end to confirm — a deliberate gesture, so a stray tap on
 * the sheet can't send money. Keyboard: focus the thumb and press Enter or Space.
 */
export function SlideToConfirm({ label, onConfirm, disabled }: { label: string; onConfirm: () => void; disabled?: boolean }) {
  const railRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startX: number; max: number } | null>(null);
  const [x, setX] = useState(0);
  const [max, setMax] = useState(0); // track length, measured when a drag starts
  const [dragging, setDragging] = useState(false);
  const [done, setDone] = useState(false);

  const track = () => Math.max(0, (railRef.current?.clientWidth ?? 0) - THUMB - PAD * 2);
  const confirm = () => {
    if (done || disabled) return;
    const m = track();
    setMax(m);
    setX(m);
    setDone(true);
    if ('vibrate' in navigator) navigator.vibrate(8);
    onConfirm();
  };

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    if (disabled || done) return;
    const m = track();
    drag.current = { startX: e.clientX - x, max: m };
    setMax(m);
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (d) setX(Math.min(d.max, Math.max(0, e.clientX - d.startX)));
  };
  const onPointerUp = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    setDragging(false);
    if (d.max > 0 && x >= d.max * CONFIRM_AT) confirm();
    else setX(0);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      confirm();
    }
  };

  const progress = max > 0 ? x / max : 0;

  return (
    <div
      ref={railRef}
      className={cn(
        'relative mt-2 h-[52px] w-full select-none overflow-hidden rounded-2xl bg-primary',
        disabled && 'opacity-40',
      )}
    >
      {/* Filled track behind the thumb */}
      <div
        className="absolute inset-y-0 left-0 rounded-2xl bg-gradient-to-r from-brand to-brand-2"
        style={{ width: x + THUMB + PAD * 2, opacity: 0.35 + progress * 0.65, transition: dragging ? 'none' : 'width 200ms, opacity 200ms' }}
      />
      <span
        className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden whitespace-nowrap pl-14 pr-4 text-sm font-semibold text-primary-ink"
        style={{ opacity: done ? 1 : 1 - progress * 0.9 }}
      >
        {done ? 'Confirmed — check your wallet' : label}
      </span>
      <button
        type="button"
        disabled={disabled || done}
        aria-label={`Slide to confirm: ${label}. Or press Enter.`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
        className="absolute top-1 flex touch-none items-center justify-center rounded-xl bg-surface text-ink shadow-md outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed"
        style={{
          left: PAD,
          width: THUMB,
          height: THUMB,
          transform: `translateX(${x}px)`,
          transition: dragging ? 'none' : 'transform 200ms',
          cursor: disabled || done ? undefined : 'grab',
        }}
      >
        {done ? <Check className="size-5 text-success" /> : <ArrowRight className="size-5" />}
      </button>
    </div>
  );
}

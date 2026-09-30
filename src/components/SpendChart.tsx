import { useMemo, useState } from 'react';
import type { Bucket } from '@/lib/insights';
import { usdc } from '@/lib/insights';

interface SpendChartProps {
  buckets: Bucket[];
  /** Which period is open below the chart */
  selected: number | null;
  onSelect: (at: number | null) => void;
}

const WIDTH = 720;
const HEIGHT = 200;
const PAD = { top: 16, right: 16, bottom: 28, left: 44 };

/**
 * Spending over time: one line, because there is one thing being measured.
 *
 * One series means no legend — the heading already says what is plotted — and no
 * number on every point, which would be unreadable at a month of days. The axis
 * carries the scale, the end of the line is labelled, and tapping any point opens
 * that period's breakdown underneath.
 *
 * Drawn as plain SVG: it scales to the container, reads the same in both themes
 * because it uses the app's own ink and brand tokens, and adds no dependency.
 */
export function SpendChart({ buckets, selected, onSelect }: SpendChartProps) {
  const [hovered, setHovered] = useState<number | null>(null);

  const geometry = useMemo(() => {
    const peak = Math.max(...buckets.map((b) => b.out), 0);
    // A flat zero line still needs a scale, or every point sits on the axis
    const top = peak > 0 ? peak * 1.15 : 1;
    const plotWidth = WIDTH - PAD.left - PAD.right;
    const plotHeight = HEIGHT - PAD.top - PAD.bottom;
    const x = (index: number) => PAD.left + (buckets.length === 1 ? plotWidth / 2 : (index / (buckets.length - 1)) * plotWidth);
    const y = (value: number) => PAD.top + plotHeight - (value / top) * plotHeight;
    return { peak, top, x, y, plotHeight };
  }, [buckets]);

  if (buckets.length === 0) return null;

  const { top, x, y } = geometry;
  const points = buckets.map((bucket, i) => ({ bucket, cx: x(i), cy: y(bucket.out) }));
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.cx.toFixed(1)},${p.cy.toFixed(1)}`).join(' ');
  const area = `${line} L${points[points.length - 1]?.cx.toFixed(1)},${(HEIGHT - PAD.bottom).toFixed(1)} L${points[0]?.cx.toFixed(1)},${(HEIGHT - PAD.bottom).toFixed(1)} Z`;
  const last = points[points.length - 1];
  const active = points.find((p) => p.bucket.at === (hovered ?? selected));

  // Three gridlines is enough to read a value off; more is ink without meaning
  const ticks = [0, top / 2, top];

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full touch-pan-y"
        role="img"
        aria-label={`Spending per period, highest ${usdc(geometry.peak)} USDC`}
        onMouseLeave={() => setHovered(null)}
      >
        {ticks.map((value) => (
          <g key={value}>
            <line
              x1={PAD.left}
              x2={WIDTH - PAD.right}
              y1={y(value)}
              y2={y(value)}
              className="stroke-line/25"
              strokeWidth={1}
            />
            <text x={PAD.left - 8} y={y(value) + 4} textAnchor="end" className="fill-subtle text-xs">
              {usdc(value)}
            </text>
          </g>
        ))}

        <path d={area} className="fill-brand/10" />
        <path d={line} className="stroke-brand" strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" />

        {/* The end of the line is the one point worth labelling */}
        {last && (
          <>
            <circle cx={last.cx} cy={last.cy} r={4} className="fill-brand stroke-surface" strokeWidth={2} />
            <text x={last.cx} y={last.cy - 10} textAnchor="end" className="fill-ink text-xs font-semibold">
              {usdc(last.bucket.out)}
            </text>
          </>
        )}

        {active && (
          <>
            <line x1={active.cx} x2={active.cx} y1={PAD.top} y2={HEIGHT - PAD.bottom} className="stroke-brand/40" strokeWidth={1} />
            <circle cx={active.cx} cy={active.cy} r={5} className="fill-brand stroke-surface" strokeWidth={2} />
          </>
        )}

        {/* Hit targets: far bigger than the dots, so a finger can land on one */}
        {points.map((p, i) => (
          <rect
            key={p.bucket.at}
            x={p.cx - (WIDTH - PAD.left - PAD.right) / Math.max(1, buckets.length * 2)}
            y={PAD.top}
            width={(WIDTH - PAD.left - PAD.right) / Math.max(1, buckets.length)}
            height={HEIGHT - PAD.top - PAD.bottom}
            fill="transparent"
            className="cursor-pointer"
            onMouseEnter={() => setHovered(p.bucket.at)}
            onClick={() => onSelect(selected === p.bucket.at ? null : p.bucket.at)}
          >
            <title>{`${p.bucket.label}: ${usdc(p.bucket.out)} USDC out`}</title>
          </rect>
        ))}

        {/* Only the ends are labelled: a tick per day would overlap into mush */}
        {[points[0], points[points.length - 1]].map(
          (p, i) =>
            p && (
              <text
                key={`${p.bucket.at}-axis-${i}`}
                x={p.cx}
                y={HEIGHT - 8}
                textAnchor={i === 0 ? 'start' : 'end'}
                className="fill-subtle text-xs"
              >
                {p.bucket.label}
              </text>
            ),
        )}
      </svg>
    </figure>
  );
}

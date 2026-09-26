/**
 * Receipts for anything in the activity log (src/lib/activity.ts).
 *
 * Drawn on a canvas and saved as a PNG, because a receipt is usually forwarded to
 * someone — a landlord, an accountant, a WhatsApp thread — and an image opens
 * everywhere without a reader. Nothing is uploaded: the file is generated in the
 * browser from the entry that's already there.
 *
 * Every receipt carries the transaction hash or provider reference so the person
 * receiving it can check the claim against the chain itself.
 */
import { ACTIVITY_LABELS, explorerTxUrl, type ActivityEntry } from '@/lib/activity';

const W = 720;
const PAD = 48;
const BRAND = '#1f51ff';
const INK = '#122d45';
const MUTED = '#656e85';
const LINE = '#dce3ef';

const font = (size: number, weight = 400) => `${weight} ${size}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;

function fieldsFor(entry: ActivityEntry): [string, string][] {
  const fields: [string, string][] = [];
  if (entry.amount) fields.push(['Amount', `${entry.amount} ${entry.token ?? 'USDC'}`]);
  if (entry.fiat) fields.push(['Paid out', `${entry.fiat.amount} ${entry.fiat.currency}`]);
  if (entry.fiat?.rate) fields.push(['Rate', `${entry.fiat.rate} ${entry.fiat.currency} / ${entry.token ?? 'USDC'}`]);
  if (entry.fee && Number(entry.fee) > 0) fields.push(['Fee', `${entry.fee} ${entry.token ?? 'USDC'}`]);
  if (entry.counterparty) fields.push(['To', entry.counterparty]);
  if (entry.detail) fields.push(['Details', entry.detail]);
  fields.push(['Category', ACTIVITY_LABELS[entry.kind]]);
  fields.push(['Network', entry.chainName]);
  fields.push([
    'Status',
    entry.status === 'success' ? 'Completed' : entry.status === 'pending' ? 'In progress' : 'Failed',
  ]);
  if (entry.reference) fields.push(['Reference', entry.reference]);
  if (entry.txHash) fields.push(['Transaction', entry.txHash]);
  return fields;
}

/** Wraps a long value (a hash, a bank name) onto as many lines as it needs */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  if (ctx.measureText(text).width <= maxWidth) return [text];
  const lines: string[] = [];
  let line = '';
  for (const char of text) {
    if (ctx.measureText(line + char).width > maxWidth && line) {
      lines.push(line);
      line = '';
    }
    line += char;
  }
  if (line) lines.push(line);
  return lines;
}

function draw(entry: ActivityEntry): HTMLCanvasElement {
  const fields = fieldsFor(entry);
  const measure = document.createElement('canvas').getContext('2d');
  // Two lines is the common case for a hash; measure properly so nothing is clipped
  let rows = 0;
  if (measure) {
    measure.font = font(16, 500);
    for (const [, value] of fields) rows += wrap(measure, value, W - PAD * 2 - 150).length;
  } else {
    rows = fields.length + 2;
  }

  const height = 230 + rows * 30 + 110;
  const canvas = document.createElement('canvas');
  const scale = 2; // sharp on phone screens
  canvas.width = W * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.scale(scale, scale);

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, height);
  ctx.fillStyle = BRAND;
  ctx.fillRect(0, 0, W, 8);

  ctx.fillStyle = INK;
  ctx.font = font(30, 700);
  ctx.fillText('Vlora', PAD, 76);
  ctx.fillStyle = MUTED;
  ctx.font = font(15);
  ctx.fillText('Payment receipt', PAD, 102);

  ctx.fillStyle = INK;
  ctx.font = font(20, 600);
  for (const [i, line] of wrap(ctx, entry.title, W - PAD * 2).slice(0, 2).entries()) {
    ctx.fillText(line, PAD, 152 + i * 26);
  }
  ctx.fillStyle = MUTED;
  ctx.font = font(14);
  ctx.fillText(new Date(entry.at).toLocaleString(), PAD, 200);

  ctx.strokeStyle = LINE;
  ctx.beginPath();
  ctx.moveTo(PAD, 222);
  ctx.lineTo(W - PAD, 222);
  ctx.stroke();

  let y = 256;
  for (const [label, value] of fields) {
    ctx.fillStyle = MUTED;
    ctx.font = font(14);
    ctx.fillText(label, PAD, y);
    ctx.fillStyle = INK;
    ctx.font = font(16, 500);
    for (const line of wrap(ctx, value, W - PAD * 2 - 150)) {
      ctx.fillText(line, PAD + 150, y);
      y += 24;
    }
    y += 6;
  }

  ctx.strokeStyle = LINE;
  ctx.beginPath();
  ctx.moveTo(PAD, y + 8);
  ctx.lineTo(W - PAD, y + 8);
  ctx.stroke();

  ctx.fillStyle = MUTED;
  ctx.font = font(13);
  const footer = entry.txHash
    ? `Verify on ${new URL(explorerTxUrl(entry.txHash)).host}`
    : 'Vlora does not hold funds; this records a transfer you signed yourself.';
  ctx.fillText(footer, PAD, y + 40);
  ctx.fillText('vlora-two.vercel.app', PAD, y + 62);
  return canvas;
}

function filename(entry: ActivityEntry): string {
  const date = new Date(entry.at).toISOString().slice(0, 10);
  return `vlora-receipt-${entry.kind}-${date}-${entry.id.slice(0, 6)}.png`;
}

/** Build the receipt and hand it to the browser as a download */
export async function downloadReceipt(entry: ActivityEntry): Promise<void> {
  const canvas = draw(entry);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
  if (!blob) throw new Error("This browser couldn't generate the image.");
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename(entry);
  link.click();
  // Revoke late: Safari needs the object URL to survive the click
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Share the receipt through the OS share sheet where that exists (phones), which
 * is how most people actually pass one on. Falls back to a download.
 */
export async function shareReceipt(entry: ActivityEntry): Promise<'shared' | 'downloaded'> {
  const canvas = draw(entry);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
  if (!blob) throw new Error("This browser couldn't generate the image.");
  const file = new File([blob], filename(entry), { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Vlora receipt', text: entry.title });
      return 'shared';
    } catch (err) {
      // A cancelled share sheet is not a failure worth reporting
      if (err instanceof Error && err.name === 'AbortError') return 'shared';
    }
  }
  await downloadReceipt(entry);
  return 'downloaded';
}

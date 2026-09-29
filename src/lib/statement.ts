/**
 * A statement of account for a period.
 *
 * Two formats, because they get used differently: CSV for anyone who wants to
 * add it up themselves or hand it to an accountant, and a printable page for
 * anyone who needs something that looks like a bank statement. Both are made in
 * the browser from the activity log — nothing is uploaded, and no server sees
 * what you spent.
 *
 * Emailing one needs a mail sender and an address to send from; until that
 * exists, the app says so rather than showing a button that does nothing.
 */
import { ACTIVE_CHAIN } from '@/chain-env';
import type { ActivityEntry } from '@/lib/activity';
import { ACTIVITY_LABELS } from '@/lib/activity';

export interface StatementRequest {
  entries: ActivityEntry[];
  from: number;
  to: number;
  address: string;
  format: 'csv' | 'print';
}

const when = (at: number) => new Date(at).toLocaleString();
const period = (from: number, to: number) =>
  `${new Date(from).toLocaleDateString()} to ${new Date(to).toLocaleDateString()}`;

/** Spreadsheets treat a leading +, -, = or @ as a formula, so those get quoted out */
function csvCell(value: string): string {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

function toCsv(request: StatementRequest): string {
  const header = ['Date', 'Description', 'Category', 'Amount', 'Token', 'Local amount', 'Currency', 'Status', 'Reference', 'Transaction'];
  const rows = request.entries.map((entry) => [
    when(entry.at),
    entry.title,
    ACTIVITY_LABELS[entry.kind],
    entry.amount ?? '',
    entry.token ?? '',
    entry.fiat?.amount ?? '',
    entry.fiat?.currency ?? '',
    entry.status,
    entry.reference ?? '',
    entry.txHash ?? '',
  ]);
  return [header, ...rows].map((row) => row.map((cell) => csvCell(String(cell))).join(',')).join('\r\n');
}

function toHtml(request: StatementRequest): string {
  const total = request.entries
    .filter((e) => e.status !== 'failed' && !/^received/i.test(e.title))
    .reduce((sum, e) => sum + Number(e.amount ?? 0), 0);

  const rows = request.entries
    .map(
      (entry) => `<tr>
        <td>${when(entry.at)}</td>
        <td>${escape(entry.title)}${entry.detail ? `<br><span class="muted">${escape(entry.detail)}</span>` : ''}</td>
        <td>${ACTIVITY_LABELS[entry.kind]}</td>
        <td class="right">${entry.amount ?? ''} ${entry.token ?? ''}</td>
        <td class="right">${entry.fiat ? `${entry.fiat.amount} ${entry.fiat.currency}` : ''}</td>
        <td>${entry.status}</td>
      </tr>`,
    )
    .join('');

  // Deliberately plain: this is a document, and it has to survive being printed
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Vlora statement</title>
<style>
  body { font: 13px/1.5 ui-sans-serif, system-ui, sans-serif; color: #122d45; margin: 32px; }
  h1 { font-size: 20px; margin: 0; }
  .muted { color: #656e85; font-size: 11px; }
  table { width: 100%; border-collapse: collapse; margin-top: 16px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #dce3ef; vertical-align: top; }
  th { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #656e85; }
  .right { text-align: right; white-space: nowrap; }
  .total { margin-top: 16px; font-weight: 600; }
  @media print { body { margin: 0; } }
</style></head>
<body>
  <h1>Vlora statement</h1>
  <p class="muted">${period(request.from, request.to)} · ${ACTIVE_CHAIN.name}<br>Wallet ${escape(request.address)}</p>
  <table>
    <thead><tr><th>Date</th><th>Description</th><th>Category</th><th class="right">Amount</th><th class="right">Local</th><th>Status</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <p class="total">Total out: ${total.toLocaleString(undefined, { maximumFractionDigits: 4 })} USDC</p>
  <p class="muted">Generated on this device from Vlora's records. Every line with a transaction hash can be checked on ${ACTIVE_CHAIN.name}.</p>
</body></html>`;
}

function escape(text: string): string {
  return text.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c] ?? c);
}

export async function downloadStatement(request: StatementRequest): Promise<void> {
  if (request.entries.length === 0) throw new Error('There is nothing in this period to put on a statement.');

  if (request.format === 'csv') {
    const blob = new Blob([toCsv(request)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `vlora-statement-${new Date(request.from).toISOString().slice(0, 10)}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return;
  }

  // The print dialog is how a browser makes a PDF; a popup blocker is the only
  // thing that stops it, so say that rather than failing silently
  const win = window.open('', '_blank');
  if (!win) throw new Error('Your browser blocked the statement window. Allow pop-ups for this site and try again.');
  win.document.write(toHtml(request));
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 300);
}

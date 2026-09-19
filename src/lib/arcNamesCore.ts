// Pure .arc name helpers (no chain calls) so they can be unit-tested directly.

// "james.arc" anywhere in a message, but not inside a longer token like an email or URL
const ARC_NAME_IN_TEXT_RE = /(?<![\w.@/-])([a-z0-9-]{3,32})\.arc(?![\w.-])/gi;

/** Unique lowercase labels ("james" for "James.arc") in the order they appear */
export function findArcNames(text: string): string[] {
  const seen = new Set<string>();
  for (const m of text.matchAll(ARC_NAME_IN_TEXT_RE)) seen.add(m[1]!.toLowerCase());
  return [...seen];
}

/** Replace each resolved "label.arc" with its address */
export function replaceArcNames(text: string, resolved: Record<string, string>): string {
  return text.replace(ARC_NAME_IN_TEXT_RE, (whole, label: string) => resolved[label.toLowerCase()] ?? whole);
}

/** "James.arc" / "james" / "@james" → "james" */
export function normalizeArcLabel(raw: string): string {
  return raw.trim().replace(/^@/, '').replace(/\.arc$/i, '').toLowerCase();
}

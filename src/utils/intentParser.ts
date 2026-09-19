// Parses natural-language DeFi commands into structured intents.
// This runs entirely client-side — no LLM call, pure pattern matching.

export type IntentType = 'send' | 'batch' | 'contact_add' | 'contacts_list' | 'request' | 'arcname' | 'swap' | 'add_lp' | 'balance' | 'chat' | 'question' | 'unknown';

export interface SendIntent {
  type: 'send';
  amount: string;
  token: string;
  recipient: string;
}

// Several recipients in one message — executed through the BatchSender contract
export interface BatchItem {
  recipient: string;
  amount: string;
}

export interface BatchIntent {
  type: 'batch';
  token: string;
  items: BatchItem[];
  /** Parts of the message that couldn't be turned into a recipient + amount */
  problems: string[];
}

// "save 0x… as alice" / "add contact alice 0x…"
export interface ContactAddIntent {
  type: 'contact_add';
  name: string;
  address: string;
}

export interface ContactsListIntent {
  type: 'contacts_list';
}

// "request 25 USDC" — produces a payment link for the connected wallet
export interface RequestIntent {
  type: 'request';
  amount: string;
  token: string;
}

// .arc name management (ArcNames contract)
export type ArcNameOp = 'register' | 'renew' | 'primary' | 'lookup';

export interface ArcNameIntent {
  type: 'arcname';
  op: ArcNameOp;
  /** Lowercase label without ".arc" — validated by the caller */
  label: string;
  years: number;
}

export interface SwapIntent {
  type: 'swap';
  amountIn: string;
  tokenIn: string;
  tokenOut: string;
}

export interface AddLpIntent {
  type: 'add_lp';
  amount: string;
  token: string;
  pair?: string;
  protocol?: string;
}

export interface BalanceIntent {
  type: 'balance';
  token?: string;
}

// Conversational messages (greetings, help, thanks) — answered in chat, never a transaction
export interface ChatIntent {
  type: 'chat';
  kind: 'greeting' | 'help' | 'thanks';
}

// A question about a feature ("how do I swap on Uniswap?") — answered, never executed
export type QuestionTopic = 'swap' | 'liquidity' | 'send' | 'arc' | 'general';

export interface QuestionIntent {
  type: 'question';
  topic: QuestionTopic;
}

export interface UnknownIntent {
  type: 'unknown';
  raw: string;
}

export type ParsedIntent = SendIntent | BatchIntent | ContactAddIntent | ContactsListIntent | RequestIntent | ArcNameIntent | SwapIntent | AddLpIntent | BalanceIntent | ChatIntent | QuestionIntent | UnknownIntent;

// Supported tokens on Arc
const KNOWN_TOKENS = ['USDC', 'EURC', 'CIRBTC', 'ETH', 'WETH', 'WBTC', 'ARB', 'OP'];
const KNOWN_PROTOCOLS = ['uniswap', 'sushi', 'curve', 'velodrome', 'aerodrome', 'balancer'];

// Everyday currency words → token symbols ("euros" → EURC, "dollars" → USDC)
const TOKEN_ALIASES: Record<string, string> = {
  EUR: 'EURC',
  EURO: 'EURC',
  EUROS: 'EURC',
  USD: 'USDC',
  DOLLAR: 'USDC',
  DOLLARS: 'USDC',
  BTC: 'CIRBTC',
  BITCOIN: 'CIRBTC',
};

function normalizeToken(raw: string): string {
  const upper = raw.toUpperCase();
  return TOKEN_ALIASES[upper] ?? upper;
}

function findAmount(text: string): string | null {
  // Matches: 10, 10.5, $10, 10 USDC, 10.00, .5
  // Addresses are stripped first so hex digits in "0x…" are never read as the amount.
  const withoutAddresses = text.replace(/0x[a-fA-F0-9]+/g, ' ');
  const match = withoutAddresses.match(/\$?(\d[\d,]*(?:\.\d+)?|\.\d+)/);
  if (!match) return null;
  const amount = match[1].replace(/,/g, '');
  return amount.startsWith('.') ? `0${amount}` : amount;
}

function findToken(text: string, exclude?: string): string {
  if (/\b(eur|euros?)\b|€/i.test(text) && exclude !== 'EURC') return 'EURC';
  if (/\b(btc|bitcoin)\b/i.test(text) && !/\bcirbtc\b/i.test(text) && exclude !== 'CIRBTC') return 'CIRBTC';
  for (const token of KNOWN_TOKENS) {
    const re = new RegExp(`\\b${token}\\b`, 'i');
    if (re.test(text) && token.toUpperCase() !== exclude?.toUpperCase()) {
      return token;
    }
  }
  return 'USDC'; // default on Arc
}

function findAddress(text: string): string | null {
  const match = text.match(/0x[a-fA-F0-9]{40}/);
  return match ? match[0] : null;
}

function findProtocol(text: string): string | undefined {
  const lower = text.toLowerCase();
  return KNOWN_PROTOCOLS.find((p) => lower.includes(p));
}

const ADDRESS_RE = /0x[a-fA-F0-9]{40}/g;

// Split a batch message into one chunk per payment. Commas split too, except
// thousands separators like "1,000".
const BATCH_SEPARATOR_RE = /\n|;|,(?!\d{3}(?!\d))|\band\b/i;

function shortAddress(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/**
 * Recognises multi-recipient payments:
 *   "send 10 USDC to 0xA, 25 to 0xB and 5 to 0xC"
 *   "send 5 USDC each to 0xA, 0xB, 0xC"
 *   "0xA 10\n0xB 25"   (one recipient per line)
 * Returns null for fewer than two addresses, so single sends keep their own path.
 */
function parseBatch(input: string): BatchIntent | null {
  const addresses = input.match(ADDRESS_RE) ?? [];
  if (addresses.length < 2) return null;

  const token = findToken(input);
  const problems: string[] = [];

  // Same amount for everyone: "5 USDC each to …"
  if (/\beach\b/i.test(input)) {
    const amount = findAmount(input) ?? '0';
    return { type: 'batch', token, items: addresses.map((recipient) => ({ recipient, amount })), problems };
  }

  const items: BatchItem[] = [];
  for (const segment of input.split(BATCH_SEPARATOR_RE)) {
    const found = segment.match(ADDRESS_RE) ?? [];
    const [recipient] = found;
    if (!recipient) continue;
    if (found.length > 1) {
      problems.push(
        `Couldn't tell which amount goes to ${found.map(shortAddress).join(' and ')} — put each recipient on its own line or separate them with commas.`,
      );
      continue;
    }
    items.push({ recipient, amount: findAmount(segment) ?? '0' });
  }

  return { type: 'batch', token, items, problems };
}

const HELP_RE = /\b(help|what can you do|how (does|do) (this|it|i)|commands?|what do you do|who are you)\b/;

function isQuestion(lower: string): boolean {
  return (
    lower.endsWith('?') ||
    /^(how|what|why|where|when|which|who|can|could|is|are|does|do|should|will|would|explain|tell me)\b/.test(lower)
  );
}

function questionTopic(lower: string): QuestionTopic {
  if (/\b(swap|exchange|convert|trade|uniswap|dex|sushi|curve|aerodrome|velodrome|balancer)\b/.test(lower)) return 'swap';
  if (/\b(liquidity|lp|pool|provide|deposit|yield|farm)\b/.test(lower)) return 'liquidity';
  if (/\b(send|transfer|pay|move)\b/.test(lower)) return 'send';
  if (/\b(arc|gas|fee|fees|network|chain|testnet|mainnet|usdc)\b/.test(lower)) return 'arc';
  return 'general';
}

export function parseIntent(input: string): ParsedIntent {
  const lower = input.toLowerCase().trim();

  // ---- CONTACTS ----
  const saveAs = input.match(/^\s*(?:save|add)(?:\s+contact)?\s+(0x[a-fA-F0-9]{40})\s+as\s+@?([A-Za-z][\w-]*)\s*$/i);
  if (saveAs) return { type: 'contact_add', address: saveAs[1]!, name: saveAs[2]! };
  const addNamed = input.match(/^\s*(?:save|add)(?:\s+contact)?\s+@?([A-Za-z][\w-]*)\s+(?:as\s+)?(0x[a-fA-F0-9]{40})\s*$/i);
  if (addNamed) return { type: 'contact_add', name: addNamed[1]!, address: addNamed[2]! };
  if (/^(show |list |my )?(my )?contacts\??$/.test(lower) || /^address book$/.test(lower)) {
    return { type: 'contacts_list' };
  }

  // ---- PAYMENT REQUEST ----
  if (/^(request|invoice|ask for|bill)\b/.test(lower) || /\bpayment (link|request)\b/.test(lower)) {
    return { type: 'request', amount: findAmount(input) ?? '0', token: findToken(input) };
  }

  // ---- BALANCE ----
  if (/\b(balance|how much|what.?s my|check|show me)\b/.test(lower)) {
    const token = findToken(input);
    return { type: 'balance', token };
  }

  // ---- BATCH ---- (two or more addresses in one message)
  const batch = parseBatch(input);
  if (batch) return batch;

  // ---- QUESTIONS ----
  // Question-shaped messages with no address and no amount are asking about a
  // feature, not issuing a command: "how do I swap on uniswap" must not become
  // a swap preview. "can you send 5 USDC to 0x…" still falls through as a send.
  if (isQuestion(lower) && !findAddress(input) && !/\d/.test(input)) {
    const topic = questionTopic(lower);
    // "what can you do?" / "how does this work?" get the capabilities list
    if (topic === 'general' && HELP_RE.test(lower)) return { type: 'chat', kind: 'help' };
    return { type: 'question', topic };
  }

  // ---- SEND / TRANSFER ----
  if (/\b(send|transfer|pay|move)\b/.test(lower)) {
    const amount = findAmount(input) ?? '0';
    const token = findToken(input);
    const recipient = findAddress(input) ?? '';
    return { type: 'send', amount, token, recipient };
  }

  // ---- SWAP ----
  if (/\b(swap|exchange|convert|trade)\b/.test(lower)) {
    const amount = findAmount(input) ?? '0';
    // Detect tokenIn/tokenOut from patterns like "swap X USDC for EURC" or "swap X USDC to ETH"
    const forMatch = input.match(/(?:for|to|into)\s+([A-Za-z]+)/i);
    const ofMatch = input.match(/(?:swap|exchange|convert|trade)\s+[\d.,]+\s*([A-Za-z]+)/i);
    const tokenIn = ofMatch ? normalizeToken(ofMatch[1]) : findToken(input);
    const tokenOut = forMatch ? normalizeToken(forMatch[1]) : (tokenIn === 'USDC' ? 'EURC' : 'USDC');
    return { type: 'swap', amountIn: amount, tokenIn, tokenOut };
  }

  // ---- ADD LP ----
  if (/\b(add|provide|deposit|lp|liquidity)\b/.test(lower)) {
    const amount = findAmount(input) ?? '0';
    const token = findToken(input);
    const protocol = findProtocol(input);
    // Detect pair e.g. "USDC/EURC" or "USDC-ETH"
    const pairMatch = input.match(/([A-Za-z]+)[\/\-]([A-Za-z]+)/);
    const pair = pairMatch ? `${pairMatch[1].toUpperCase()}/${pairMatch[2].toUpperCase()}` : undefined;
    return { type: 'add_lp', amount, token, pair, protocol };
  }

  // ---- CHAT ---- (checked last so "hi, send 5 USDC to 0x…" still sends)
  if (HELP_RE.test(lower)) {
    return { type: 'chat', kind: 'help' };
  }
  if (/\b(thanks|thank you|thx|ty|cheers|appreciate)\b/.test(lower)) {
    return { type: 'chat', kind: 'thanks' };
  }
  if (/^(hi|hello|hey|hiya|yo|gm|sup|hola|howdy|good (morning|afternoon|evening|day))\b/.test(lower)) {
    return { type: 'chat', kind: 'greeting' };
  }

  return { type: 'unknown', raw: input };
}

// Generates a human-readable summary of the parsed intent for the preview card
export function describeIntent(intent: ParsedIntent): string {
  switch (intent.type) {
    case 'batch':
      return `Send ${intent.token} to ${intent.items.length} recipients`;
    case 'contact_add':
      return `Save ${intent.address} as ${intent.name}`;
    case 'contacts_list':
      return 'List contacts';
    case 'request':
      return `Request ${intent.amount} ${intent.token}`;
    case 'arcname':
      return intent.op === 'register'
        ? `Register ${intent.label}.arc for ${intent.years} year${intent.years === 1 ? '' : 's'}`
        : intent.op === 'renew'
          ? `Renew ${intent.label}.arc for ${intent.years} year${intent.years === 1 ? '' : 's'}`
          : intent.op === 'primary'
            ? `Set ${intent.label}.arc as your primary name`
            : `Look up ${intent.label}.arc`;
    case 'send':
      return `Send ${intent.amount} ${intent.token} to ${intent.recipient || '[no address found]'}`;
    case 'swap':
      return `Swap ${intent.amountIn} ${intent.tokenIn} for ${intent.tokenOut}`;
    case 'add_lp':
      return `Add ${intent.amount} ${intent.token} as liquidity${intent.pair ? ` to ${intent.pair}` : ''}${intent.protocol ? ` on ${intent.protocol}` : ''}`;
    case 'balance':
      return `Check ${intent.token ?? 'USDC'} balance`;
    case 'chat':
    case 'question':
      return 'Conversation';
    default:
      return 'Could not understand the command.';
  }
}

// Example chips prefill the input rather than submitting, so the send example
// can leave the address for the user to paste in.
export const EXAMPLE_PROMPTS = [
  'Send 1 USDC to 0x',
  'Swap 50 USDC for EURC',
  'Add 100 USDC/EURC liquidity on Uniswap',
  'Check my USDC balance',
];

/**
 * Reads a CSV/TSV of payments into a batch. Each row needs an address (or a
 * name the caller has already resolved) and an amount, in either column order.
 * A header row and blank lines are skipped.
 */
export function parseCsvBatch(text: string): BatchIntent {
  const items: BatchItem[] = [];
  const problems: string[] = [];

  text.split(/\r?\n/).forEach((line, i) => {
    const cells = line
      .split(/[,;\t]/)
      .map((c) => c.trim().replace(/^"|"$/g, ''))
      .filter(Boolean);
    if (cells.length === 0) return;

    const recipient = cells.find((c) => /^0x[a-fA-F0-9]{40}$/.test(c));
    const amount = cells.find((c) => /^\$?\d+(\.\d+)?$/.test(c))?.replace('$', '');
    if (!recipient && !amount) return; // header or comment row
    if (!recipient || !amount) {
      problems.push(`Line ${i + 1} needs both an address and an amount.`);
      return;
    }
    items.push({ recipient, amount });
  });

  return { type: 'batch', token: 'USDC', items, problems };
}

const YEARS_RE = /\bfor\s+(\d{1,2})\s*(?:years?|yrs?|y)\b/i;

/**
 * .arc name commands. Checked on the raw message, before .arc names are
 * resolved to addresses (otherwise "register james.arc" would become an address).
 *   register vlora.arc [for 2 years] · claim/get/buy vlora.arc
 *   renew vlora.arc [for 1 year]
 *   set vlora.arc as my primary name · use vlora.arc as my name
 *   who is vlora.arc · lookup vlora.arc · is vlora.arc available
 */
export function parseArcNameCommand(input: string): ArcNameIntent | null {
  const text = input.trim();
  const years = Number(text.match(YEARS_RE)?.[1] ?? 1);

  // "register" works with or without ".arc"; claim/get/buy need ".arc" so "get my balance" isn't a name
  const register =
    text.match(/^register\s+(?:the\s+name\s+)?@?([a-z0-9-]+)(?:\.arc)?\b/i) ??
    text.match(/^(?:claim|get|buy)\s+(?:the\s+name\s+)?@?([a-z0-9-]+)\.arc\b/i);
  if (register) return { type: 'arcname', op: 'register', label: register[1]!.toLowerCase(), years };

  const renew = text.match(/^(?:renew|extend)\s+@?([a-z0-9-]+)(?:\.arc)?\b/i);
  if (renew) return { type: 'arcname', op: 'renew', label: renew[1]!.toLowerCase(), years };

  const primary =
    text.match(/^(?:set|make|use)\s+@?([a-z0-9-]+)\.arc\s+(?:as\s+)?(?:my\s+)?(?:primary|main|default)?\s*(?:name)?\s*$/i) ??
    text.match(/^set\s+(?:my\s+)?primary\s+name\s+(?:to\s+)?@?([a-z0-9-]+)(?:\.arc)?\s*$/i);
  if (primary) return { type: 'arcname', op: 'primary', label: primary[1]!.toLowerCase(), years: 1 };

  const lookup =
    text.match(/^(?:who\s+is|whois|who\s+owns|resolve|look\s*up)\s+@?([a-z0-9-]+)\.arc\s*\??$/i) ??
    text.match(/^is\s+@?([a-z0-9-]+)\.arc\s+(?:available|taken|free|registered)\s*\??$/i);
  if (lookup) return { type: 'arcname', op: 'lookup', label: lookup[1]!.toLowerCase(), years: 1 };

  return null;
}

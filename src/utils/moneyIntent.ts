/**
 * Plain-language parsing for the two rails that arrived as panels: cashing out
 * to a bank, and paying for airtime, data, electricity or TV.
 *
 * Vlora is meant to be typed at, not filled in, so these have to work from the
 * message box:
 *
 *   "cash out 20 USDC to gtbank 0123456789"
 *   "buy 500 airtime for 08012345678"
 *   "pay 5000 electricity for meter 04123456789 on ikeja"
 *
 * The parser only reads what someone typed. Turning "gtbank" into an institution
 * code, or a phone number into an operator, happens against the live APIs — see
 * src/lib/resolveMoneyIntent.ts — because only they know what exists today.
 */

export interface CashOutIntent {
  type: 'cashout';
  /** USDC leaving the wallet */
  amount: string;
  /** Payout currency: NGN, KES, UGX, TZS */
  currency: string;
  /** What the user called their bank, e.g. "gtbank" — resolved later */
  bankQuery: string;
  accountNumber: string;
}

export type BillCategoryName = 'airtime' | 'data' | 'electricity' | 'tv' | 'exams';

export interface BillIntent {
  type: 'bill';
  category: BillCategoryName;
  /** Amount in the local currency, e.g. 500 naira of airtime */
  amount: string;
  /** Phone number, meter number or smartcard number */
  recipient: string;
  /** What the user called the provider, e.g. "mtn" or "ikeja" — resolved later */
  providerQuery?: string;
  /** ISO country code; NG unless the message says otherwise */
  country: string;
}

/** Payout currencies Paycrest settles, by the words people use for them */
const CURRENCIES: [RegExp, string][] = [
  [/\b(naira|ngn|#)\b/i, 'NGN'],
  [/\b(kenyan? shillings?|kes|ksh|mpesa|m-pesa)\b/i, 'KES'],
  [/\b(ugandan? shillings?|ugx)\b/i, 'UGX'],
  [/\b(tanzanian? shillings?|tzs)\b/i, 'TZS'],
];

const COUNTRIES: [RegExp, string][] = [
  [/\b(nigeria|nigerian|ng)\b/i, 'NG'],
  [/\b(kenya|kenyan|ke)\b/i, 'KE'],
  [/\b(ghana|ghanaian|gh)\b/i, 'GH'],
  [/\b(uganda|ugandan|ug)\b/i, 'UG'],
  [/\b(tanzania|tanzanian|tz)\b/i, 'TZ'],
  [/\b(south africa|za)\b/i, 'ZA'],
];

/** Words that are never part of a bank's name */
const FILLER = /\b(my|the|a|an|account|acct|acc|number|no|bank account|please|pls|to|in|at|on|with|for|from|usdc|usd|dollars?|naira|ngn|kes|ksh|ugx|tzs|shillings?)\b/gi;

const clean = (text: string) => text.replace(FILLER, ' ').replace(/[^\w\s&-]/g, ' ').replace(/\s+/g, ' ').trim();

/** A number that is plainly a phone number rather than an amount */
const PHONE = /(?:^|[\s(])(\+\d{10,14}|0\d{10})(?=$|[\s),.])/;
/** Meter, smartcard and bank account numbers: a run of digits, no separators */
const DIGITS = /(?:^|[\s(])(\d{8,13})(?=$|[\s),.])/;

function findCurrency(text: string, fallback = 'NGN'): string {
  for (const [re, code] of CURRENCIES) if (re.test(text)) return code;
  return fallback;
}

function findCountry(text: string, fallback = 'NG'): string {
  for (const [re, code] of COUNTRIES) if (re.test(text)) return code;
  return fallback;
}

/** The first plain number in the text, with thousands separators removed */
function findAmount(text: string): string | null {
  const match = text.match(/(?:^|[^\w.])(\d[\d,]*(?:\.\d{1,2})?)(?=$|[^\d.]|\.$)/);
  if (!match) return null;
  const amount = (match[1] ?? '').replace(/,/g, '');
  return amount === '' || Number(amount) <= 0 ? null : amount;
}

/**
 * "cash out 20 USDC to gtbank 0123456789" and its cousins. Returns null unless
 * the message really is a cash-out with an account number in it.
 */
export function parseCashOut(input: string): CashOutIntent | null {
  const text = input.trim();
  const asksToCashOut = /\b(cash\s*out|cashout|off\s*-?ramp|offramp|withdraw(?:al)?)\b/i.test(text);
  const asksForBank = /\b(to|into)\b[^.]*\bbank\b/i.test(text) || /\bbank account\b/i.test(text);
  if (!asksToCashOut && !asksForBank) return null;

  const account = text.match(DIGITS);
  if (!account) return null;
  const accountNumber = account[1] ?? '';

  // Take the account number out before reading the amount, or "0123456789"
  // becomes the amount on a message like "withdraw to gtb 0123456789"
  const withoutAccount = text.replace(accountNumber, ' ');
  const amount = findAmount(withoutAccount);
  if (!amount) return null;

  // The bank is whatever words sit between "to" and the account number
  const between = text.slice(text.search(/\bto\b/i) + 2, account.index ?? text.length);
  const bankQuery = clean(between.replace(/^\s*my\b/i, ''));

  return {
    type: 'cashout',
    amount,
    currency: findCurrency(text),
    bankQuery,
    accountNumber,
  };
}

function billCategory(text: string): BillCategoryName | null {
  if (/\b(waec|jamb|neco|nabteb|exam pin|result checker|scratch card)\b/i.test(text)) return 'exams';
  if (/\b(dstv|gotv|startimes|go\s?tv|tv\s?(sub|subscription)?)\b/i.test(text)) return 'tv';
  if (/\b(electricity|nepa|light|power|disco|prepaid|meter|ikeja|eko|aedc|phed|kedco|ibedc|bedc|eedc|jed|kaedco)\b/i.test(text)) return 'electricity';
  if (/\b(data|mb|gb|bundle|bundles)\b/i.test(text)) return 'data';
  if (/\b(airtime|recharge|top\s?-?up|topup|credit|units)\b/i.test(text)) return 'airtime';
  return null;
}

/** The operator or biller someone named, if they named one */
function providerQuery(text: string, category: BillCategoryName): string | undefined {
  const named = text.match(
    /\b(mtn|airtel|glo|9\s?mobile|etisalat|safaricom|vodafone|ikeja|eko|ekedc|aedc|abuja|phed|port\s?harcourt|kedco|kano|ibedc|ibadan|bedc|benin|eedc|enugu|jed|jos|kaedco|kaduna|aba|yola|dstv|gotv|startimes)\b/i,
  );
  if (named) return named[1]?.replace(/\s+/g, '').toLowerCase();
  // "on ikeja electric" / "with mtn"
  const after = text.match(/\b(?:on|with|via|from)\s+([a-z][a-z\s&-]{1,24}?)(?:\s+(?:for|to|electricity|airtime|data|tv)\b|$)/i);
  const word = after?.[1]?.trim();
  return word && category ? word.toLowerCase() : undefined;
}

/**
 * "buy 500 airtime for 08012345678", "recharge 08012345678 with 1000",
 * "pay 5000 electricity for meter 04123456789 on ikeja".
 */
export function parseBill(input: string): BillIntent | null {
  const text = input.trim();
  const category = billCategory(text);
  if (!category) return null;
  // Avoid hijacking questions ("how do I buy airtime?") and swaps
  if (/\b(how|what|can i|do you|does)\b/i.test(text) && !/\b(buy|pay|recharge|top\s?-?up)\b/i.test(text)) return null;

  const phone = text.match(PHONE);
  const digits = phone ?? text.match(DIGITS);
  if (!digits) return null;
  const recipient = (digits[1] ?? '').replace(/\s/g, '');

  const amount = findAmount(text.replace(recipient, ' '));
  if (!amount) return null;

  return {
    type: 'bill',
    category,
    amount,
    recipient,
    ...(providerQuery(text, category) ? { providerQuery: providerQuery(text, category) } : {}),
    country: findCountry(text),
  };
}

export interface SweepIntent {
  type: 'sweep';
  /** Where everything goes. Always an address by the time this is built. */
  to: string;
}

/**
 * "send everything to 0x…", "move all my funds to 0x…".
 *
 * Deliberately narrow, because this empties a wallet: it fires only when the
 * message says both *all* and *where*, with a real address. "Send everything"
 * on its own is not a command, it is half of one.
 */
export function parseSweep(input: string): SweepIntent | null {
  const text = input.trim();
  // A question about sweeping is not a sweep
  if (/\b(how|what|can i|does|should|is it)\b/i.test(text) && !/\b(send|move|transfer|sweep|empty)\b/i.test(text)) return null;

  const saysAll = /\b(everything|all|sweep|empty)\b/i.test(text);
  const saysMove = /\b(send|move|transfer|sweep|withdraw|empty)\b/i.test(text);
  if (!saysAll || !saysMove) return null;

  const to = text.match(/\b0x[a-fA-F0-9]{40}\b/);
  if (!to) return null;

  // "send 10 USDC to 0x…" is an ordinary send, even if the word "all" is nearby.
  // An amount anywhere in the message means the person named a figure, so this
  // is not "everything".
  const withoutAddress = text.replace(/0x[a-fA-F0-9]+/g, ' ');
  if (/\d/.test(withoutAddress)) return null;

  return { type: 'sweep', to: to[0] };
}

export interface EarnIntent {
  type: 'earn';
  action: 'deposit' | 'withdraw';
  /** Whole USDC, or "all" for everything in the vault */
  amount: string | 'all';
}

/**
 * "withdraw 5 USDC from earn", "take everything out of earn", "put 20 in earn".
 *
 * Earn is named explicitly for a withdrawal, because "withdraw 20" on its own is
 * ambiguous — it could mean a bank cash-out — and guessing wrong moves money the
 * wrong way. A deposit is safer to infer: "save 20 in earn" can only mean one
 * thing.
 */
export function parseEarn(input: string, onEarnTab = false): EarnIntent | null {
  const text = input.trim();
  if (/\b(how|what|can i|does|should|is it)\b/i.test(text) && !/\b(withdraw|deposit|put|take)\b/i.test(text)) return null;

  const mentionsEarn = /\b(earn|vault|savings vault|lending)\b/i.test(text);
  // "take 2.5 out" puts a decimal point between the two words, so the gap must
  // allow one — an earlier version excluded dots and missed every decimal amount
  const takesOut = /\b(withdraw|cash in|redeem|pull out)\b/i.test(text) || /\btake\b.{0,40}?\bout\b/i.test(text);
  const putsIn = /\b(deposit|put|add|move|save|stake|lend)\b/i.test(text);

  // On the Earn tab the context supplies what the words leave out: "deposit 1
  // USDC" there can only mean one thing
  if (!mentionsEarn && !onEarnTab) return null;
  if (!takesOut && !putsIn) return null;

  const everything = /\b(all|everything|the lot|max)\b/i.test(text);
  const amount = text.replace(/0x[a-fA-F0-9]+/g, ' ').match(/(\d[\d,]*(?:\.\d+)?)/);
  if (!everything && !amount) return null;

  return {
    type: 'earn',
    // Taking out wins when both words appear: "take all out and add to earn"
    // is not a sentence anyone means as a deposit
    action: takesOut ? 'withdraw' : 'deposit',
    amount: everything ? 'all' : (amount?.[1] ?? '').replace(/,/g, ''),
  };
}

/** A date written the way people write one: "30th October", "30 Oct", "2026-10-30" */
export function parseWhen(text: string, now = new Date()): number | null {
  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) {
    const at = new Date(`${iso[1]}-${iso[2]}-${iso[3]}T12:00:00`).getTime();
    return Number.isFinite(at) ? at : null;
  }

  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  // "30th October", "30 oct", "october 30"
  const dayFirst = text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([a-z]{3,9})\b/i);
  const monthFirst = text.match(/\b([a-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?\b/i);
  const found = dayFirst
    ? { day: Number(dayFirst[1]), month: (dayFirst[2] ?? '').toLowerCase() }
    : monthFirst
      ? { day: Number(monthFirst[2]), month: (monthFirst[1] ?? '').toLowerCase() }
      : null;
  if (!found) return null;

  const month = months.findIndex((m) => found.month.startsWith(m));
  if (month < 0 || found.day < 1 || found.day > 31) return null;

  // A date already gone means next year: "30 October" said in November is 2027
  let year = now.getFullYear();
  const at = new Date(year, month, found.day, 12, 0, 0);
  if (at.getTime() < now.getTime()) {
    year += 1;
    at.setFullYear(year);
  }
  return at.getTime();
}

export interface SavingsGoalIntent {
  type: 'savings_goal';
  name: string;
  amount: string;
  due: number | null;
}

/**
 * "create target for rent, total is 1 USDC, due 30th October".
 *
 * The name is whatever sits between "for" and the amount, which is how people
 * write it. A target with no amount is not a target, so that is required.
 */
export function parseSavingsGoal(input: string): SavingsGoalIntent | null {
  const text = input.trim();
  if (!/\b(target|goal|saving|save)\b/i.test(text)) return null;
  if (!/\b(create|new|add|set|start|make|save)\b/i.test(text)) return null;
  // "add 5 to rent" is a contribution, not a new target
  if (/\badd\b[^.]*\bto\b/i.test(text) && !/\b(target|goal)\b/i.test(text.split(/\bto\b/i)[0] ?? '')) return null;

  const amountMatch = text.match(/(\d[\d,]*(?:\.\d+)?)\s*(?:usdc|usd|\$)?/i);
  if (!amountMatch) return null;
  const amount = (amountMatch[1] ?? '').replace(/,/g, '');
  if (Number(amount) <= 0) return null;

  // The name: after "for", up to the amount or a "total"/"due"/date word
  const forMatch = text.match(/\bfor\s+([a-z0-9][a-z0-9 '&-]{0,39}?)(?=\s*(?:,|\.|total|amount|is|of|worth|due|by|on|before|\d|$))/i);
  const name = forMatch?.[1]?.trim();
  if (!name) return null;

  return { type: 'savings_goal', name, amount, due: parseWhen(text) };
}

export interface SavingsMoveIntent {
  type: 'savings_move';
  action: 'add' | 'take';
  amount: string;
  /** What the person called the target; matched against real ones by the app */
  goal: string;
}

/** "add 0.5 to rent", "take 1 out of school fees", "put 2 into rent" */
export function parseSavingsMove(input: string): SavingsMoveIntent | null {
  const text = input.trim();
  const takes = /\b(take|withdraw|remove|pull)\b/i.test(text);
  const adds = /\b(add|put|save|top ?up|contribute)\b/i.test(text);
  if (!takes && !adds) return null;

  const amountMatch = text.match(/(\d[\d,]*(?:\.\d+)?)/);
  if (!amountMatch) return null;

  // The target's name follows "to", "into", "toward" or "out of"
  const named = text.match(/\b(?:out of|from|to|into|towards?|for)\s+([a-z0-9][a-z0-9 '&-]{0,39}?)\s*$/i);
  const goal = named?.[1]?.trim();
  if (!goal) return null;

  return {
    type: 'savings_move',
    action: takes ? 'take' : 'add',
    amount: (amountMatch[1] ?? '').replace(/,/g, ''),
    goal,
  };
}

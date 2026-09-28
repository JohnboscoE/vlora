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
  if (/(waec|jamb|neco|nabteb|exam pin|result checker|scratch card)/i.test(text)) return 'exams';
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

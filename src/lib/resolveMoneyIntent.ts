/**
 * Turn what someone typed into something payable.
 *
 * The parser (src/utils/moneyIntent.ts) only reads the message; this asks the
 * live APIs what "gtbank" or "mtn" actually is today, and refuses rather than
 * guesses when the answer is ambiguous. Anything thrown here is written to be
 * read by the person who typed it.
 */
import { fetchInstitutions, fetchOfframpQuote, verifyAccount, type Institution } from '@/lib/offramp';
import { fetchBillProduct, fetchBillProducts, fetchPhoneOperators, type BillCategory, type BillProduct } from '@/lib/bills';
import type { BillIntent, CashOutIntent } from '@/utils/moneyIntent';

/** What people call their bank, against what the payout network calls it */
const BANK_ALIASES: Record<string, string> = {
  gtb: 'guaranty trust',
  gtbank: 'guaranty trust',
  gt: 'guaranty trust',
  uba: 'united bank for africa',
  firstbank: 'first bank',
  fbn: 'first bank',
  zenith: 'zenith',
  access: 'access',
  kuda: 'kuda',
  opay: 'opay',
  palmpay: 'palmpay',
  moniepoint: 'moniepoint',
  fcmb: 'fcmb',
  stanbic: 'stanbic',
  ecobank: 'ecobank',
  sterling: 'sterling',
  wema: 'wema',
  alat: 'wema',
  union: 'union bank',
  polaris: 'polaris',
  fidelity: 'fidelity',
  keystone: 'keystone',
  providus: 'providus',
  unity: 'unity',
  heritage: 'heritage',
  jaiz: 'jaiz',
  titan: 'titan',
  globus: 'globus',
  suntrust: 'suntrust',
  mpesa: 'm-pesa',
  safaricom: 'm-pesa',
  kcb: 'kcb',
  equity: 'equity',
};

const normalise = (text: string) => text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

/** Candidates for what the user typed, best first */
function rankBanks(query: string, institutions: Institution[]): Institution[] {
  const raw = normalise(query);
  const target = BANK_ALIASES[raw.replace(/\s/g, '')] ?? raw;
  if (!target) return [];
  const scored = institutions
    .map((bank) => {
      const name = normalise(bank.name);
      let score = 0;
      if (bank.code.toLowerCase() === raw) score = 100;
      else if (name === target) score = 90;
      else if (name.startsWith(target)) score = 80;
      else if (name.includes(target)) score = 70;
      // "first bank" should beat "first city monument bank" on word matches
      else if (target.split(' ').every((word) => word.length > 2 && name.includes(word))) score = 60;
      return { bank, score };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.map((row) => row.bank);
}

export interface ResolvedCashOut {
  amount: string;
  currency: string;
  institution: string;
  bankName: string;
  accountNumber: string;
  accountName: string;
  /** Local currency per 1 USDC */
  rate: string;
  /** What the recipient gets, in the payout currency */
  payout: string;
  providerIds: string[];
}

export async function resolveCashOut(intent: CashOutIntent): Promise<ResolvedCashOut> {
  const institutions = await fetchInstitutions(intent.currency);
  if (institutions.length === 0) throw new Error(`No banks are listed for ${intent.currency} payouts right now.`);

  const matches = rankBanks(intent.bankQuery, institutions);
  if (matches.length === 0) {
    throw new Error(
      `I couldn't find a bank called "${intent.bankQuery}". Open Cash out to pick from the list, or try the bank's full name.`,
    );
  }
  // Two equally good matches mean guessing with someone's money
  const [best, second] = matches;
  if (!best) throw new Error(`I couldn't find a bank called "${intent.bankQuery}".`);
  if (second && normalise(best.name).startsWith(normalise(intent.bankQuery)) && normalise(second.name).startsWith(normalise(intent.bankQuery))) {
    throw new Error(`Did you mean ${matches.slice(0, 3).map((b) => b.name).join(', ')}? Say the full name and I'll set it up.`);
  }

  const [accountName, quote] = await Promise.all([
    verifyAccount(best.code, intent.accountNumber),
    fetchOfframpQuote(intent.amount, intent.currency),
  ]);

  return {
    amount: intent.amount,
    currency: intent.currency,
    institution: best.code,
    bankName: best.name,
    accountNumber: intent.accountNumber,
    accountName: accountName && accountName !== 'OK' ? accountName : 'Account holder',
    rate: quote.rate,
    payout: (Number(intent.amount) * Number(quote.rate)).toFixed(2),
    providerIds: quote.providerIds,
  };
}

export interface ResolvedBill {
  category: BillCategory;
  product: BillProduct;
  /** One of the product's fixed denominations, when it has them */
  packageId?: string;
  /** A value inside the product's range, otherwise */
  value?: string;
  recipient: string;
  /** e.g. "500 NGN of MTN" */
  label: string;
}

/** A product whose name matches what the user typed, or the operator of their number */
async function pickProduct(intent: BillIntent, products: BillProduct[]): Promise<BillProduct> {
  if (products.length === 0) throw new Error(`Nothing is available for ${intent.category} in that country right now.`);

  if (intent.providerQuery) {
    const target = normalise(intent.providerQuery);
    const named = products.filter((p) => normalise(p.name).includes(target));
    if (named[0]) return named[0];
    throw new Error(
      `I couldn't find "${intent.providerQuery}". Available: ${products.slice(0, 6).map((p) => p.name).join(', ')}.`,
    );
  }

  // For a phone top-up, the number itself says which network it is
  if (intent.category === 'airtime' || intent.category === 'data') {
    const operators = await fetchPhoneOperators(intent.recipient).catch(() => []);
    for (const operator of operators) {
      const match = products.find((p) => p.id === operator.id) ?? products.find((p) => normalise(p.name).includes(normalise(operator.name)));
      if (match) return match;
    }
    throw new Error(
      `I couldn't tell which network ${intent.recipient} is on. Say it in the message, like "buy ${intent.amount} MTN airtime for ${intent.recipient}".`,
    );
  }

  throw new Error(`Which biller? ${products.slice(0, 6).map((p) => p.name).join(', ')}.`);
}

export async function resolveBill(intent: BillIntent): Promise<ResolvedBill> {
  const products = await fetchBillProducts(intent.category, intent.country);
  const chosen = await pickProduct(intent, products);
  // The list is enough to choose; the detail call has the amounts
  const product = await fetchBillProduct(chosen.id).catch(() => chosen);

  const wanted = Number(intent.amount);
  if (product.packages.length > 0) {
    const exact = product.packages.find((p) => Number(p.value) === wanted);
    if (!exact) {
      const nearby = product.packages
        .map((p) => p.value)
        .slice(0, 8)
        .join(', ');
      throw new Error(`${product.name} doesn't sell ${intent.amount} ${product.currency}. It has: ${nearby}.`);
    }
    return {
      category: intent.category,
      product,
      packageId: exact.id,
      recipient: intent.recipient,
      label: `${exact.value} ${product.currency} of ${product.name}`,
    };
  }

  const range = product.range;
  if (range && (wanted < range.min || wanted > range.max)) {
    throw new Error(`${product.name} takes between ${range.min} and ${range.max} ${product.currency}.`);
  }
  return {
    category: intent.category,
    product,
    value: intent.amount,
    recipient: intent.recipient,
    label: `${intent.amount} ${product.currency} of ${product.name}`,
  };
}

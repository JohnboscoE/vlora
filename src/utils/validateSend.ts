import { isAddress } from 'viem';
import { Amount, parseAmount, usdcDecimalsFor } from '@/onchain-money';
import { ACTIVE_CHAIN, ACTIVE_CHAIN_ID } from '@/chain-env';
import type { ArcNameIntent, BatchIntent, SendIntent, SwapIntent } from './intentParser';
import { getToken, getTokens, type TokenInfo } from '@/tokens';
import { getSwapVenue, isSupportedPair, type SwapVenue } from '@/swap-config';
import type { TokenBalances } from '@/hooks/useTokenBalances';
import { ARC_NAME_LABEL_RE, ARC_NAME_MAX_YEARS, getArcNamesAddress } from '@/arcnames-config';
import { getBatchSenderAddress, MAX_BATCH_RECIPIENTS } from '@/batch-config';

const BALANCE_UNKNOWN =
  "Couldn't read your USDC balance from Arc, so I can't check this payment yet. If you use an ad or privacy blocker or a VPN, allow *.arc.io and *.arc.network for this site, then try again.";

function balanceUnknown(symbol: string) {
  return BALANCE_UNKNOWN.replace('USDC', symbol);
}

function supportedList() {
  return getTokens(ACTIVE_CHAIN_ID)
    .map((t) => t.symbol)
    .join(' and ');
}

export type SendCheck = { ok: true; amount: Amount; token: TokenInfo } | { ok: false; reason: string };

// Everything that must hold before a send reaches the wallet. Used both to gate
// the Execute button in the preview and again at confirm time.
export function validateSend(intent: SendIntent, balances: TokenBalances): SendCheck {
  // Only registry tokens — never let an unknown symbol quietly fall back to USDC
  const token = getToken(ACTIVE_CHAIN_ID, intent.token);
  if (!token) {
    return { ok: false, reason: `${intent.token} isn't supported on ${ACTIVE_CHAIN.name} — I can send ${supportedList()}.` };
  }
  if (!intent.recipient || !isAddress(intent.recipient)) {
    return { ok: false, reason: 'No valid recipient address found. Please include a full 0x address (42 characters).' };
  }

  let amount: Amount;
  try {
    amount = Amount.parse(intent.amount, token.decimals);
  } catch {
    return { ok: false, reason: `"${intent.amount}" isn't a valid ${token.symbol} amount (max ${token.decimals} decimal places).` };
  }
  if (amount.raw <= 0n) {
    return { ok: false, reason: 'Amount must be greater than 0.' };
  }
  // Fail closed: without a balance we can't check the payment, so don't allow it
  const balance = balances[token.symbol];
  if (balance == null) return { ok: false, reason: balanceUnknown(token.symbol) };
  if (amount.raw > balance) {
    return { ok: false, reason: `Amount exceeds your ${token.symbol} balance.` };
  }

  return { ok: true, amount, token };
}

export type SwapCheck =
  | { ok: true; tokenIn: TokenInfo; tokenOut: TokenInfo; amountIn: Amount; venue: SwapVenue }
  | { ok: false; reason: string };

export function validateSwap(intent: SwapIntent, balances: TokenBalances): SwapCheck {
  const venue = getSwapVenue(ACTIVE_CHAIN_ID);
  if (!venue) return { ok: false, reason: `Swaps aren't available on ${ACTIVE_CHAIN.name} yet.` };
  const tokenIn = getToken(ACTIVE_CHAIN_ID, intent.tokenIn);
  const tokenOut = getToken(ACTIVE_CHAIN_ID, intent.tokenOut);
  if (!tokenIn || !tokenOut) {
    return { ok: false, reason: `I can only swap between ${supportedList()} right now.` };
  }
  if (tokenIn.symbol === tokenOut.symbol) return { ok: false, reason: 'Pick two different tokens to swap.' };
  if (!isSupportedPair(venue, tokenIn.symbol, tokenOut.symbol)) {
    return { ok: false, reason: `There's no ${tokenIn.symbol} → ${tokenOut.symbol} market on ${venue.name} yet.` };
  }

  let amountIn: Amount;
  try {
    amountIn = Amount.parse(intent.amountIn, tokenIn.decimals);
  } catch {
    return { ok: false, reason: `"${intent.amountIn}" isn't a valid ${tokenIn.symbol} amount.` };
  }
  if (amountIn.raw <= 0n) return { ok: false, reason: `How much ${tokenIn.symbol} should I swap? Try "swap 10 ${tokenIn.symbol} for ${tokenOut.symbol}".` };
  const balance = balances[tokenIn.symbol];
  if (balance == null) return { ok: false, reason: balanceUnknown(tokenIn.symbol) };
  if (amountIn.raw > balance) return { ok: false, reason: `Amount exceeds your ${tokenIn.symbol} balance.` };

  return { ok: true, tokenIn, tokenOut, amountIn, venue };
}

export type BatchCheck =
  | { ok: true; recipients: `0x${string}`[]; amounts: bigint[]; total: Amount; batchSender: `0x${string}` }
  | { ok: false; reason: string };

// Same rules as a single send, applied per row, plus batch-level limits.
// Row numbers in messages are 1-based, matching the preview list.
export function validateBatch(intent: BatchIntent, balanceRaw?: bigint): BatchCheck {
  const batchSender = getBatchSenderAddress(ACTIVE_CHAIN_ID);
  if (!batchSender) {
    return { ok: false, reason: `Batch payments aren't deployed on ${ACTIVE_CHAIN.name} yet.` };
  }
  if (intent.token !== 'USDC') {
    return { ok: false, reason: `Only USDC batches are supported right now (you asked for ${intent.token}).` };
  }
  if (intent.problems.length > 0) {
    return { ok: false, reason: intent.problems[0] };
  }
  if (intent.items.length < 2) {
    return { ok: false, reason: 'A batch needs at least two recipients.' };
  }
  if (intent.items.length > MAX_BATCH_RECIPIENTS) {
    return { ok: false, reason: `Up to ${MAX_BATCH_RECIPIENTS} recipients per batch (you have ${intent.items.length}).` };
  }

  const recipients: `0x${string}`[] = [];
  const amounts: bigint[] = [];
  let total = Amount.zero(usdcDecimalsFor(ACTIVE_CHAIN_ID));

  for (const [i, item] of intent.items.entries()) {
    const row = `Row ${i + 1}`;
    if (!isAddress(item.recipient)) {
      return { ok: false, reason: `${row}: "${item.recipient}" isn't a valid address.` };
    }
    let amount: Amount;
    try {
      amount = parseAmount(ACTIVE_CHAIN_ID, item.amount);
    } catch {
      return { ok: false, reason: `${row}: "${item.amount}" isn't a valid USDC amount (max 6 decimal places).` };
    }
    if (amount.raw <= 0n) {
      return { ok: false, reason: `${row}: amount is missing or 0.` };
    }
    recipients.push(item.recipient);
    amounts.push(amount.raw);
    total = total.add(amount);
  }

  if (balanceRaw == null) return { ok: false, reason: BALANCE_UNKNOWN };
  if (total.raw > balanceRaw) {
    return { ok: false, reason: `The total (${total.toFixed(2)} USDC) exceeds your USDC balance.` };
  }

  return { ok: true, recipients, amounts, total, batchSender };
}

export type ArcNameCheck =
  | { ok: true; contract: `0x${string}`; feeRaw: bigint }
  | { ok: false; reason: string };

// Local rules for .arc actions; availability/ownership are checked on-chain in the preview
/** yearlyFee: read from the contract (useArcNameFee); undefined = unknown → paid actions blocked */
export function validateArcName(intent: ArcNameIntent, yearlyFee?: bigint): ArcNameCheck {
  const contract = getArcNamesAddress(ACTIVE_CHAIN_ID);
  if (!contract) return { ok: false, reason: `.arc names aren't available on ${ACTIVE_CHAIN.name} yet.` };
  if (!ARC_NAME_LABEL_RE.test(intent.label)) {
    return { ok: false, reason: 'Names are 3–32 characters: lowercase letters, numbers and hyphens.' };
  }
  const paid = intent.op === 'register' || intent.op === 'renew';
  if (paid && (!Number.isInteger(intent.years) || intent.years < 1 || intent.years > ARC_NAME_MAX_YEARS)) {
    return { ok: false, reason: `Choose between 1 and ${ARC_NAME_MAX_YEARS} years.` };
  }
  if (paid && yearlyFee == null) {
    return { ok: false, reason: `Couldn't read the .arc name fee from ${ACTIVE_CHAIN.name} yet. Try again in a moment.` };
  }
  return { ok: true, contract, feeRaw: paid ? yearlyFee! * BigInt(intent.years) : 0n };
}

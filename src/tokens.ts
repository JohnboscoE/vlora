/**
 * Stablecoins Vlora can send, hold and swap, per chain. USDC comes from the
 * onchain-facts registry; everything else is listed here explicitly.
 */
import { getUsdc } from './onchain-facts';
import { ARC_TESTNET_ID } from './chain-env';

export type TokenSymbol = 'USDC' | 'EURC' | 'cirBTC';

export interface TokenInfo {
  symbol: TokenSymbol;
  name: string;
  address: `0x${string}`;
  decimals: number;
}

const EXTRA_TOKENS: Partial<Record<number, TokenInfo[]>> = {
  [ARC_TESTNET_ID]: [
    { symbol: 'EURC', name: 'Euro Coin', address: '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a', decimals: 6 },
    // Verified: the only cirBTC with Synthra liquidity (USDC and EURC pools). Beware same-named copies.
    { symbol: 'cirBTC', name: 'Circle BTC', address: '0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF', decimals: 8 },
  ],
  // Arc mainnet: add EURC here once its address is published
};

export function getTokens(chainId: number): TokenInfo[] {
  const usdc = getUsdc(chainId);
  const list: TokenInfo[] = usdc
    ? [{ symbol: 'USDC', name: 'USD Coin', address: usdc.address as `0x${string}`, decimals: usdc.decimals }]
    : [];
  return [...list, ...(EXTRA_TOKENS[chainId] ?? [])];
}

/** Human-readable amount: 2 decimals for stablecoins, significant digits for small values like BTC */
export function formatTokenAmount(value: number, decimals: number): string {
  if (value === 0) return '0';
  if (decimals <= 6 || Math.abs(value) >= 1) return value.toLocaleString(undefined, { maximumFractionDigits: decimals <= 6 ? 2 : 6 });
  return value.toLocaleString(undefined, { maximumSignificantDigits: 4 });
}

export function getToken(chainId: number, symbol: string): TokenInfo | undefined {
  return getTokens(chainId).find((t) => t.symbol.toUpperCase() === symbol.toUpperCase());
}

/**
 * Shared Circle App Kit plumbing (https://docs.arc.io/app-kit).
 *
 * App Kit drives everything through the EIP-1193 provider of whichever wallet
 * wagmi has connected, so a browser wallet and the embedded wallet from
 * email/Google sign-in work the same way. Keys never leave the wallet.
 *
 * No API key here on purpose: App Kit refuses a key passed from the browser, so
 * requests use the shared rate limit.
 */
import type { EIP1193Provider } from 'viem';
import { getAccount } from 'wagmi/actions';
import { config } from '@/config';
import { ACTIVE_CHAIN_ID, IS_MAINNET } from '@/chain-env';

/** App Kit's identifier for the active Arc network */
export const ARC_CHAIN: 'Arc' | 'Arc_Testnet' = IS_MAINNET ? 'Arc' : 'Arc_Testnet';

export async function appKit() {
  const { AppKit } = await import('@circle-fin/app-kit');
  return new AppKit();
}

/** The connected wallet as an App Kit adapter */
export async function walletAdapter() {
  const { connector } = getAccount(config);
  if (!connector) throw new Error('Connect a wallet first');
  const provider = (await connector.getProvider({ chainId: ACTIVE_CHAIN_ID })) as EIP1193Provider;
  const { createViemAdapterFromProvider } = await import('@circle-fin/adapter-viem-v2');
  return createViemAdapterFromProvider({ provider });
}

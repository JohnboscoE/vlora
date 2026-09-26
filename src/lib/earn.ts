/**
 * Earn: deposit USDC into a yield vault on Arc through Circle's App Kit, which wraps
 * the underlying lending-protocol vaults (https://docs.arc.io/app-kit/earn).
 *
 * Non-custodial: the deposit sits in the vault contract, you hold shares, and the
 * user's own wallet signs every transaction (App Kit drives it through the EIP-1193
 * provider of whichever wallet wagmi has connected — browser wallet or the embedded
 * one from email/Google sign-in).
 *
 * No API key here on purpose: App Kit refuses a key passed from the browser, so
 * requests use the shared rate limit.
 */
import type { EIP1193Provider } from 'viem';
import { getAccount } from 'wagmi/actions';
import { config } from '@/config';
import { ACTIVE_CHAIN_ID, IS_MAINNET } from '@/chain-env';

/** App Kit's identifier for the active network */
const EARN_CHAIN = IS_MAINNET ? 'Arc' : 'Arc_Testnet';

export interface EarnVault {
  address: string;
  name: string;
  /** Lending protocol behind the vault, e.g. "Morpho" */
  protocol: string;
  /** Deposit token symbol, e.g. "USDC" */
  asset: string;
  /** Current annual rate as a fraction: 0.042 = 4.2% */
  apy: number;
  /** Vault performance fee as a fraction */
  fee: number;
  lowLiquidity: boolean;
}

export interface EarnPosition {
  /** Deposit plus earnings, in whole tokens */
  balance: string;
  asset: string;
}

async function kit() {
  const { AppKit } = await import('@circle-fin/app-kit');
  return new AppKit();
}

/**
 * The connected wallet as an App Kit adapter. Every wagmi connector exposes the
 * wallet's own EIP-1193 provider, so this covers a browser wallet and Privy's
 * embedded wallet alike — App Kit signs through it, we never hold keys.
 */
async function adapter() {
  const { connector } = getAccount(config);
  if (!connector) throw new Error('Connect a wallet first');
  const provider = (await connector.getProvider({ chainId: ACTIVE_CHAIN_ID })) as EIP1193Provider;
  const { createViemAdapterFromProvider } = await import('@circle-fin/adapter-viem-v2');
  return createViemAdapterFromProvider({ provider });
}

/** Vaults on the active chain, highest rate first */
export async function exploreVaults(): Promise<EarnVault[]> {
  const { vaults } = await (await kit()).earn.exploreVaults({ chain: EARN_CHAIN, sortBy: 'apy' });
  return vaults.map((v) => ({
    address: v.address,
    name: v.name,
    protocol: v.protocol,
    asset: v.asset,
    apy: v.apyProfile?.current ?? v.currentApy ?? 0,
    fee: v.fee?.performance ?? v.vaultFee ?? 0,
    lowLiquidity: (v.liquidityProfile?.status ?? v.status) === 'low_liquidity',
  }));
}

/** What this wallet currently holds in a vault */
export async function getPosition(vaultAddress: string): Promise<EarnPosition | null> {
  const position = await (await kit()).earn.getPosition({
    from: { adapter: await adapter(), chain: EARN_CHAIN },
    vaultAddress,
  });
  // currentBalance is the withdrawable value (deposit + earnings), already decimal
  const amount = position.currentBalance;
  return Number(amount) > 0 ? { balance: amount, asset: position.asset } : null;
}

/** Deposit whole tokens (e.g. "10.5"). The wallet signs; App Kit handles approval. */
export async function depositToVault(vaultAddress: string, amount: string) {
  return (await kit()).earn.deposit({
    from: { adapter: await adapter(), chain: EARN_CHAIN },
    vaultAddress,
    amount,
  });
}

/** Redeem whole tokens back out of the vault */
export async function withdrawFromVault(vaultAddress: string, amount: string) {
  return (await kit()).earn.withdraw({
    from: { adapter: await adapter(), chain: EARN_CHAIN },
    vaultAddress,
    amount,
  });
}

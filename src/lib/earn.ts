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
import { appKit, ARC_CHAIN, walletAdapter } from '@/lib/appkit';

/** App Kit's identifier for the active network */
const EARN_CHAIN = ARC_CHAIN;

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

/** Vaults on the active chain, highest rate first */
export async function exploreVaults(): Promise<EarnVault[]> {
  const { vaults } = await (await appKit()).earn.exploreVaults({ chain: EARN_CHAIN, sortBy: 'apy' });
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
  const position = await (await appKit()).earn.getPosition({
    from: { adapter: await walletAdapter(), chain: EARN_CHAIN },
    vaultAddress,
  });
  // currentBalance is the withdrawable value (deposit + earnings), already decimal
  const amount = position.currentBalance;
  return Number(amount) > 0 ? { balance: amount, asset: position.asset } : null;
}

/** Deposit whole tokens (e.g. "10.5"). The wallet signs; App Kit handles approval. */
export async function depositToVault(vaultAddress: string, amount: string) {
  return (await appKit()).earn.deposit({
    from: { adapter: await walletAdapter(), chain: EARN_CHAIN },
    vaultAddress,
    amount,
  });
}

/** Redeem whole tokens back out of the vault */
export async function withdrawFromVault(vaultAddress: string, amount: string) {
  return (await appKit()).earn.withdraw({
    from: { adapter: await walletAdapter(), chain: EARN_CHAIN },
    vaultAddress,
    amount,
  });
}

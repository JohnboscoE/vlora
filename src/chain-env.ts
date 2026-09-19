/**
 * Testnet vs mainnet, chosen at build time by the VITE_ARC_NETWORK env var:
 *   VITE_ARC_NETWORK=mainnet  → Arc mainnet (set this on the production deploy)
 *   unset / anything else     → Arc Testnet (local dev, previews)
 * Every chain id, RPC, explorer and USDC address in the app derives from this.
 */
import { requireChain } from '@/onchain-facts';

export const IS_MAINNET = import.meta.env.VITE_ARC_NETWORK === 'mainnet';

export const ARC_TESTNET_ID = 5042002;
export const ARC_MAINNET_ID = 5042;

export const ACTIVE_CHAIN_ID = IS_MAINNET ? ARC_MAINNET_ID : ARC_TESTNET_ID;

export const ACTIVE_CHAIN = requireChain(ACTIVE_CHAIN_ID);

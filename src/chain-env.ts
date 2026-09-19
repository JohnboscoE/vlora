/**
 * Single switch for testnet vs mainnet.
 *
 * Test everything with IS_MAINNET = false (free-ish testnet gas). Flip this one
 * line to true before a real mainnet run — nothing else in the app needs editing,
 * since every other file reads chain id / RPC / explorer / USDC address from
 * onchain-facts.ts via ACTIVE_CHAIN_ID.
 */
import { requireChain } from '@/onchain-facts';

export const IS_MAINNET = false;

export const ARC_TESTNET_ID = 5042002;
export const ARC_MAINNET_ID = 5042;

export const ACTIVE_CHAIN_ID = IS_MAINNET ? ARC_MAINNET_ID : ARC_TESTNET_ID;

export const ACTIVE_CHAIN = requireChain(ACTIVE_CHAIN_ID);

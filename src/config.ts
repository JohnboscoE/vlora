/**
 * wagmi configuration
 * Built with Arc Studio — https://studio.arc.io
 */

import { http, fallback, createConfig } from 'wagmi'
import { createConfig as createPrivyConfig } from '@privy-io/wagmi'
import { mainnet } from 'wagmi/chains'
import { defineChain } from 'viem'
import { injected } from 'wagmi/connectors'
import { registerChain } from './tracing'
import { ACTIVE_CHAIN, ARC_MAINNET_ID, ARC_TESTNET_ID } from './chain-env'

// Extra public endpoints for the same chain. If one host is slow or blocked
// (ad blockers, VPNs, corporate filters), reads fall through to the next.
const EXTRA_RPC_URLS: Record<number, string[]> = {
  [ARC_TESTNET_ID]: ['https://rpc.testnet.arc.network'],
  // Verified: all return chain id 5042
  [ARC_MAINNET_ID]: [
    'https://rpc.blockdaemon.mainnet.arc.io',
    'https://rpc.drpc.mainnet.arc.io',
    'https://rpc.quicknode.mainnet.arc.io',
  ],
}

// Build the active Arc chain (testnet or mainnet, per chain-env.ts) from the
// onchain-facts registry instead of importing a fixed chain from viem/chains —
// that keeps this file correct no matter which network is active.
export const arc = defineChain({
  id: ACTIVE_CHAIN.chainId,
  name: ACTIVE_CHAIN.name,
  nativeCurrency: {
    name: ACTIVE_CHAIN.nativeCurrency.symbol,
    symbol: ACTIVE_CHAIN.nativeCurrency.symbol,
    decimals: ACTIVE_CHAIN.nativeCurrency.decimals,
  },
  rpcUrls: {
    default: { http: ACTIVE_CHAIN.rpcUrls },
  },
  blockExplorers: {
    default: { name: ACTIVE_CHAIN.name, url: ACTIVE_CHAIN.explorerBase },
  },
  testnet: ACTIVE_CHAIN.isTestnet,
})

// Pre-register chain RPC URLs so trace events show correct chain names immediately
registerChain(arc.id, arc.rpcUrls.default.http[0])

// Proxied through this site's own domain (vercel.json rewrites / Vite dev proxy).
// Many ad blockers block every *.arc.io host — on mainnet that is every public RPC —
// but they don't block the app's own origin. Direct hosts remain as fallbacks.
const SAME_ORIGIN_RPC = `${window.location.origin}/rpc/${ACTIVE_CHAIN.isTestnet ? 'testnet' : 'mainnet'}`

/**
 * Set VITE_PRIVY_APP_ID to offer email / Google sign-in with an embedded wallet
 * (src/providers.tsx). Unset, the app keeps the plain browser-wallet flow.
 */
export const PRIVY_APP_ID = (import.meta.env.VITE_PRIVY_APP_ID ?? '').trim()

const chains = [arc, mainnet] as const // mainnet needed for ENS resolution
const transports = {
  [arc.id]: fallback(
    [SAME_ORIGIN_RPC, ...ACTIVE_CHAIN.rpcUrls, ...(EXTRA_RPC_URLS[ACTIVE_CHAIN.chainId] ?? [])].map((url) =>
      http(url, { retryCount: 2, timeout: 12_000 }),
    ),
  ),
  [mainnet.id]: http(), // ENS resolution uses mainnet
}

// With Privy, connections are owned by Privy (embedded wallet or an external one it
// connected), so its createConfig takes no connectors of our own.
export const config = PRIVY_APP_ID
  ? createPrivyConfig({ chains, transports })
  : createConfig({ chains, connectors: [injected()], transports })

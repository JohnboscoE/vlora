/**
 * wagmi configuration
 * Built with Arc Studio — https://studio.arc.io
 */

import { http, fallback, createConfig } from 'wagmi'
import { mainnet } from 'wagmi/chains'
import { defineChain } from 'viem'
import { injected } from 'wagmi/connectors'
import { registerChain } from './tracing'
import { ACTIVE_CHAIN, ARC_TESTNET_ID } from './chain-env'

// Extra public endpoints for the same chain. If one host is slow or blocked
// (ad blockers, VPNs, corporate filters), reads fall through to the next.
const EXTRA_RPC_URLS: Record<number, string[]> = {
  [ARC_TESTNET_ID]: ['https://rpc.testnet.arc.network'],
}

// Build the active Arc chain (testnet or mainnet, per chain-env.ts) from the
// onchain-facts registry instead of importing a fixed chain from viem/chains —
// that keeps this file correct no matter which network is active.
const arc = defineChain({
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

export const config = createConfig({
  chains: [arc, mainnet], // mainnet needed for ENS resolution
  connectors: [injected()],
  transports: {
    [arc.id]: fallback(
      [...ACTIVE_CHAIN.rpcUrls, ...(EXTRA_RPC_URLS[ACTIVE_CHAIN.chainId] ?? [])].map((url) =>
        http(url, { retryCount: 2, timeout: 12_000 }),
      ),
    ),
    [mainnet.id]: http(), // ENS resolution uses mainnet
  },
})

/**
 * Bridge USDC off Arc with Circle's App Kit, which wraps CCTP
 * (https://docs.arc.io/app-kit/bridge).
 *
 * Vlora needs this because the services that turn USDC into local currency or a
 * paid electricity bill don't run on Arc yet. Two details make it painless:
 *
 * - `useForwarder` lets Circle's relayer submit the mint on the destination
 *   chain, so the user signs once, on Arc, and pays gas in USDC. They never need
 *   ETH on Base.
 * - `feePayment: 'source'` takes the CCTP and forwarding fees out of the Arc
 *   wallet instead of the minted amount, so **exactly** `amount` arrives. That
 *   matters when a payout provider is waiting for an exact figure.
 *
 * Everything is signed by the user's own wallet; Vlora never holds the funds.
 */
import { appKit, ARC_CHAIN, walletAdapter } from '@/lib/appkit';
import { IS_MAINNET } from '@/chain-env';

/** Where bridged USDC lands. Paycrest and Bitrefill both settle on Base. */
export const BRIDGE_CHAIN: 'Base' | 'Base_Sepolia' = IS_MAINNET ? 'Base' : 'Base_Sepolia';
export const BRIDGE_CHAIN_LABEL = IS_MAINNET ? 'Base' : 'Base Sepolia';

export interface BridgeEstimate {
  /** What arrives at the recipient, in whole USDC */
  amount: string;
  /** CCTP + forwarding fees, in whole USDC, charged on Arc on top of `amount` */
  fees: string;
  /** Gas for the burn on Arc, in whole USDC (Arc charges gas in USDC) */
  gas: string | null;
  /** amount + fees, i.e. what leaves the Arc wallet before gas */
  total: string;
}

export interface BridgeStepInfo {
  name: string;
  state: string;
  txHash?: string;
  explorerUrl?: string;
}

export interface BridgeOutcome {
  state: 'pending' | 'success' | 'error';
  steps: BridgeStepInfo[];
  /** The burn transaction on Arc, when one was submitted */
  sourceTxHash?: string;
}

function params(recipientAddress: string, amount: string, adapter: Awaited<ReturnType<typeof walletAdapter>>) {
  return {
    from: { adapter, chain: ARC_CHAIN },
    // No adapter for the destination: Circle's forwarder submits the mint, so the
    // user needs neither a second signature nor gas on the destination chain.
    to: { recipientAddress, chain: BRIDGE_CHAIN, useForwarder: true as const },
    amount,
    // Pay fees on Arc so the recipient is credited the exact amount
    config: { feePayment: 'source' as const },
  };
}

const sum = (values: (string | null | undefined)[]) =>
  values.reduce((total, value) => total + (value ? Number(value) : 0), 0);

/** What a bridge would cost, before the user commits to anything */
export async function estimateBridgeOut(recipientAddress: string, amount: string): Promise<BridgeEstimate> {
  const kit = await appKit();
  const estimate = await kit.estimateBridge(params(recipientAddress, amount, await walletAdapter()));
  const fees = sum(estimate.fees.map((f) => f.amount));
  const gas = estimate.gasFees.find((g) => g.fees != null);
  // EstimatedGas carries the fee in the chain's own units; Arc's are USDC
  const gasAmount = gas?.fees ? String((gas.fees as { total?: string; amount?: string }).total ?? (gas.fees as { amount?: string }).amount ?? '') : '';
  return {
    amount,
    fees: fees.toFixed(6).replace(/\.?0+$/, ''),
    gas: gasAmount || null,
    total: (Number(amount) + fees).toFixed(6).replace(/\.?0+$/, ''),
  };
}

/**
 * Move `amount` USDC from the connected Arc wallet to `recipientAddress` on the
 * destination chain. One signature on Arc; the mint is relayed.
 */
export async function bridgeOut(recipientAddress: string, amount: string): Promise<BridgeOutcome> {
  const kit = await appKit();
  const result = await kit.bridge(params(recipientAddress, amount, await walletAdapter()));
  const steps: BridgeStepInfo[] = result.steps.map((s) => ({
    name: s.name,
    state: s.state,
    txHash: s.txHash,
    explorerUrl: s.explorerUrl,
  }));
  return {
    state: result.state,
    steps,
    sourceTxHash: steps.find((s) => /burn|deposit|transfer/i.test(s.name) && s.txHash)?.txHash ?? steps.find((s) => s.txHash)?.txHash,
  };
}

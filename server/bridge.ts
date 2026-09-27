// Moving USDC off Arc from the server, with the agent's own key.
//
// The app does this in the browser with the owner's wallet (src/lib/bridge.ts).
// The agent can't: it has a private key, not a wallet provider. App Kit takes an
// adapter built straight from a key, so the same CCTP path works here.
//
// Why the agent needs it at all: Bitrefill prices bills in USDC on Base and
// doesn't accept Arc yet, so paying one means bridging. `useForwarder` lets
// Circle relay the mint (the agent holds no gas on Base) and `feePayment:
// 'source'` charges the CCTP fees on Arc, so the exact invoice amount lands.
import { IS_MAINNET } from './chain';

const SOURCE_CHAIN: 'Arc' | 'Arc_Testnet' = IS_MAINNET ? 'Arc' : 'Arc_Testnet';
export const DESTINATION_CHAIN: 'Base' | 'Base_Sepolia' = IS_MAINNET ? 'Base' : 'Base_Sepolia';
export const DESTINATION_LABEL = IS_MAINNET ? 'Base' : 'Base Sepolia';

export interface BridgeOutcome {
  state: 'pending' | 'success' | 'error';
  /** The burn on Arc, when one was submitted */
  sourceTxHash?: string;
  /** Why it failed, if it did */
  reason?: string;
}

/**
 * Send `amount` USDC from the agent's key on Arc to `recipient` on Base.
 *
 * Fees and gas come from the agent's own balance, not from `amount`: the owner's
 * money pays the bill and nothing else. `amount` is what the invoice must
 * receive; the relayer's fee is added on top before sending.
 */
export async function bridgeFromAgent(privateKey: string, recipient: string, amount: string): Promise<BridgeOutcome> {
  // `amount` is what must arrive; the fee is added on top, from the agent's balance
  try {
    const [{ AppKit }, { createViemAdapterFromPrivateKey }] = await Promise.all([
      import('@circle-fin/app-kit'),
      import('@circle-fin/adapter-viem-v2'),
    ]);
    const adapter = createViemAdapterFromPrivateKey({ privateKey });
    const kit = new AppKit();
    const bridgeParams = {
      from: { adapter, chain: SOURCE_CHAIN },
      // No adapter for the destination: Circle's forwarder submits the mint, so
      // the agent needs neither a second key nor gas on Base
      to: { recipientAddress: recipient, chain: DESTINATION_CHAIN, useForwarder: true as const },
    };
    // The relayer's fee comes out of what is minted (Arc doesn't allow source-paid
    // fees), so it goes on top here and the invoice receives the exact amount
    const estimate = await kit.estimateBridge({ ...bridgeParams, amount });
    const fee = estimate.fees.reduce((total, f) => total + (f.amount ? Number(f.amount) : 0), 0);
    const send = (Math.ceil((Number(amount) + fee) * 1e6) / 1e6).toFixed(6).replace(/\.?0+$/, '');
    const result = await kit.bridge({ ...bridgeParams, amount: send });
    const burn = result.steps.find((s) => /burn|deposit|transfer/i.test(s.name) && s.txHash) ?? result.steps.find((s) => s.txHash);
    return {
      state: result.state,
      ...(burn?.txHash ? { sourceTxHash: burn.txHash } : {}),
      ...(result.state === 'error'
        ? {
            // Name the step and its error: "Mint failed: …" says far more than
            // "the transfer did not complete"
            reason:
              result.steps
                .filter((s) => s.state === 'error')
                .map((s) => `${s.name}: ${s.errorMessage ?? 'failed'}`)
                .join('; ') || 'the transfer did not complete',
          }
        : {}),
    };
  } catch (err) {
    const reason = err instanceof Error ? ((err as { shortMessage?: string }).shortMessage ?? err.message) : String(err);
    // The whole error goes to the logs; the caller gets enough to act on
    console.error('[bridge] agent bridge failed', err);
    return { state: 'error', reason: reason.slice(0, 300) };
  }
}

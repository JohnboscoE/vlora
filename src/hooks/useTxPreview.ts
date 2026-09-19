import { useEffect, useState } from 'react';
import { BaseError, ContractFunctionRevertedError, erc20Abi, formatUnits } from 'viem';
import { getPublicClient } from 'wagmi/actions';
import { config } from '@/config';
import { ACTIVE_CHAIN_ID } from '@/chain-env';
import { getUsdc } from '@/onchain-facts';
import { gasTokenDecimalsFor, isGasTokenUsdc, usdcDecimalsFor } from '@/onchain-money';
import { batchSenderAbi } from '@/batch-config';
import { arcNamesAbi, ARC_NAME_REGISTER_GAS } from '@/arcnames-config';
import { swapRouter02Abi, SWAP_GAS_ESTIMATE } from '@/swap-config';

/** A transaction the preview should dry-run before the wallet is asked to sign */
export type PlannedTx =
  /** spendsGasToken: the token is USDC, which also pays Arc's network fee */
  | { kind: 'send'; token: `0x${string}`; spendsGasToken: boolean; recipient: `0x${string}`; amountRaw: bigint }
  | {
      kind: 'swap';
      router: `0x${string}`;
      tokenIn: `0x${string}`;
      tokenOut: `0x${string}`;
      fee: number;
      amountIn: bigint;
      minOut: bigint;
      spendsGasToken: boolean;
    }
  | { kind: 'batch'; batchSender: `0x${string}`; recipients: `0x${string}`[]; amounts: bigint[]; totalRaw: bigint }
  | { kind: 'arcname'; op: 'register' | 'renew'; contract: `0x${string}`; label: string; years: number; feeRaw: bigint }
  | { kind: 'primary'; contract: `0x${string}`; label: string };

export type TxPreview =
  | { status: 'idle' }
  | { status: 'checking' }
  /** needsApproval: batch will first ask for a USDC approval (2 signatures) */
  | { status: 'ok'; feeLabel: string; feeIsEstimate: boolean; needsApproval: boolean }
  /** The chain says this transaction would revert — block signing */
  | { status: 'fail'; reason: string }
  /** Couldn't reach the RPC etc. — don't block, but say we couldn't check */
  | { status: 'unknown' };

// Rough gas for a batch we can't estimate yet because the approval hasn't happened.
// Per-recipient cost measured in contracts/test/BatchSender.t.sol (~27.5k), padded.
const BATCH_BASE_GAS = 50_000n;
const BATCH_PER_RECIPIENT_GAS = 32_000n;
const RENEW_GAS = 100_000n;

/** USDC (6-decimal units) this transaction moves out of the wallet */
function spendOf(tx: PlannedTx): bigint {
  switch (tx.kind) {
    case 'send':
      return tx.spendsGasToken ? tx.amountRaw : 0n;
    case 'swap':
      return tx.spendsGasToken ? tx.amountIn : 0n;
    case 'batch':
      return tx.totalRaw;
    case 'arcname':
      return tx.feeRaw;
    case 'primary':
      return 0n;
  }
}

function formatFee(wei: bigint): string {
  const n = Number(formatUnits(wei, gasTokenDecimalsFor(ACTIVE_CHAIN_ID)));
  if (n === 0) return '0 USDC';
  if (n < 0.0001) return '< 0.0001 USDC';
  return `${n.toPrecision(2)} USDC`;
}

// Pull a human-readable reason out of a viem revert
function revertReason(err: unknown): string | null {
  if (!(err instanceof BaseError)) return null;
  const reverted = err.walk((e) => e instanceof ContractFunctionRevertedError);
  if (!(reverted instanceof ContractFunctionRevertedError)) return null;
  const name = reverted.data?.errorName;
  if (name === 'ERC20InsufficientBalance') return 'Not enough USDC to cover this payment.';
  if (name === 'ERC20InsufficientAllowance') return 'The batch contract isn\'t approved for this amount.';
  if (name === 'ZeroAmount') return 'One of the amounts is 0.';
  if (name === 'ZeroRecipient') return 'One of the recipients is the zero address.';
  if (reverted.reason === 'Too little received') return 'The price moved more than 0.5% since the quote. Close and try again for a fresh quote.';
  if (reverted.reason === 'STF') return 'The token transfer failed — check your balance.';
  return reverted.reason ?? reverted.shortMessage ?? 'The transaction would fail on-chain.';
}

/**
 * Simulates the exact call against the live chain (eth_call) and estimates its
 * fee. Re-runs whenever the planned transaction changes.
 */
export function useTxPreview(tx: PlannedTx | null, account: `0x${string}` | undefined): TxPreview {
  const [preview, setPreview] = useState<TxPreview>({ status: 'idle' });

  // Stable dependency for the effect: bigint arrays don't compare by value
  const key = tx && account ? JSON.stringify(tx, (_, v) => (typeof v === 'bigint' ? v.toString() : v)) + account : null;

  useEffect(() => {
    if (!tx || !account) {
      setPreview({ status: 'idle' });
      return;
    }
    const client = getPublicClient(config, { chainId: ACTIVE_CHAIN_ID });
    const usdc = getUsdc(ACTIVE_CHAIN_ID)?.address as `0x${string}` | undefined;
    if (!client || !usdc) {
      setPreview({ status: 'unknown' });
      return;
    }

    let cancelled = false;
    setPreview({ status: 'checking' });

    (async () => {
      try {
        const gasPrice = await client.getGasPrice();

        // On Arc the network fee comes out of the same USDC being spent, so a
        // payment that passes the dry run can still fail if nothing is left for gas
        const finish = async (feeWei: bigint, feeIsEstimate: boolean, needsApproval: boolean) => {
          let shortfall: string | null = null;
          if (isGasTokenUsdc(ACTIVE_CHAIN_ID)) {
            const native = await client.getBalance({ address: account });
            const scale = 10n ** BigInt(gasTokenDecimalsFor(ACTIVE_CHAIN_ID) - usdcDecimalsFor(ACTIVE_CHAIN_ID));
            if (spendOf(tx) * scale + feeWei > native) {
              shortfall = `Not enough USDC left for the network fee (~${formatFee(feeWei)}). Send a little less.`;
            }
          }
          if (cancelled) return;
          setPreview(shortfall ? { status: 'fail', reason: shortfall } : { status: 'ok', feeLabel: formatFee(feeWei), feeIsEstimate, needsApproval });
        };

        if (tx.kind === 'primary') {
          const call = {
            account,
            address: tx.contract,
            abi: arcNamesAbi,
            functionName: 'setPrimaryName',
            args: [tx.label],
          } as const;
          await client.simulateContract(call);
          const gas = await client.estimateContractGas(call);
          await finish(gas * gasPrice, false, false);
          return;
        }

        if (tx.kind === 'arcname') {
          const name = `${tx.label}.arc`;
          // Clear reasons up front instead of a generic revert
          if (tx.op === 'register') {
            const available = await client.readContract({ address: tx.contract, abi: arcNamesAbi, functionName: 'isAvailable', args: [tx.label] });
            if (!available) {
              if (!cancelled) setPreview({ status: 'fail', reason: `${name} is already taken.` });
              return;
            }
          } else {
            const [owner, expiry] = await client.readContract({ address: tx.contract, abi: arcNamesAbi, functionName: 'nameInfo', args: [tx.label] });
            if (owner.toLowerCase() !== account.toLowerCase()) {
              if (!cancelled) setPreview({ status: 'fail', reason: `You don't own ${name}.` });
              return;
            }
            if (expiry < BigInt(Math.floor(Date.now() / 1000))) {
              if (!cancelled) setPreview({ status: 'fail', reason: `${name} has expired — register it again instead of renewing.` });
              return;
            }
          }

          const allowance = await client.readContract({ address: usdc, abi: erc20Abi, functionName: 'allowance', args: [account, tx.contract] });
          if (allowance >= tx.feeRaw) {
            const call = {
              account,
              address: tx.contract,
              abi: arcNamesAbi,
              functionName: tx.op,
              args: [tx.label, BigInt(tx.years)],
            } as const;
            await client.simulateContract(call);
            const gas = await client.estimateContractGas(call);
            await finish(gas * gasPrice, false, false);
            return;
          }

          const balance = await client.readContract({ address: usdc, abi: erc20Abi, functionName: 'balanceOf', args: [account] });
          if (balance < tx.feeRaw) {
            if (!cancelled) setPreview({ status: 'fail', reason: `Not enough USDC for the ${name} fee.` });
            return;
          }
          const approveCall = {
            account,
            address: usdc,
            abi: erc20Abi,
            functionName: 'approve',
            args: [tx.contract, tx.feeRaw],
          } as const;
          await client.simulateContract(approveCall);
          const approveGas = await client.estimateContractGas(approveCall);
          const mainGas = tx.op === 'register' ? ARC_NAME_REGISTER_GAS : RENEW_GAS;
          await finish((approveGas + mainGas) * gasPrice, true, true);
          return;
        }

        if (tx.kind === 'swap') {
          const swapCall = {
            account,
            address: tx.router,
            abi: swapRouter02Abi,
            functionName: 'exactInputSingle',
            args: [
              {
                tokenIn: tx.tokenIn,
                tokenOut: tx.tokenOut,
                fee: tx.fee,
                recipient: account,
                amountIn: tx.amountIn,
                amountOutMinimum: tx.minOut,
                sqrtPriceLimitX96: 0n,
              },
            ],
          } as const;
          const allowance = await client.readContract({ address: tx.tokenIn, abi: erc20Abi, functionName: 'allowance', args: [account, tx.router] });
          if (allowance >= tx.amountIn) {
            await client.simulateContract(swapCall);
            const gas = await client.estimateContractGas(swapCall);
            await finish(gas * gasPrice, false, false);
            return;
          }
          const approveCall = {
            account,
            address: tx.tokenIn,
            abi: erc20Abi,
            functionName: 'approve',
            args: [tx.router, tx.amountIn],
          } as const;
          await client.simulateContract(approveCall);
          const approveGas = await client.estimateContractGas(approveCall);
          await finish((approveGas + SWAP_GAS_ESTIMATE) * gasPrice, true, true);
          return;
        }

        if (tx.kind === 'send') {
          const call = {
            account,
            address: tx.token,
            abi: erc20Abi,
            functionName: 'transfer',
            args: [tx.recipient, tx.amountRaw],
          } as const;
          await client.simulateContract(call);
          const gas = await client.estimateContractGas(call);
          await finish(gas * gasPrice, false, false);
          return;
        }

        const allowance = await client.readContract({
          address: usdc,
          abi: erc20Abi,
          functionName: 'allowance',
          args: [account, tx.batchSender],
        });

        if (allowance >= tx.totalRaw) {
          // Already approved: simulate the real batch call
          const call = {
            account,
            address: tx.batchSender,
            abi: batchSenderAbi,
            functionName: 'batchTransfer',
            args: [usdc, tx.recipients, tx.amounts],
          } as const;
          await client.simulateContract(call);
          const gas = await client.estimateContractGas(call);
          await finish(gas * gasPrice, false, false);
          return;
        }

        // Approval first: simulate the approval, check the balance ourselves, and
        // estimate the batch (it can't be simulated until the approval exists)
        const balance = await client.readContract({ address: usdc, abi: erc20Abi, functionName: 'balanceOf', args: [account] });
        if (balance < tx.totalRaw) {
          if (!cancelled) setPreview({ status: 'fail', reason: 'Not enough USDC to cover this batch.' });
          return;
        }
        const approveCall = {
          account,
          address: usdc,
          abi: erc20Abi,
          functionName: 'approve',
          args: [tx.batchSender, tx.totalRaw],
        } as const;
        await client.simulateContract(approveCall);
        const approveGas = await client.estimateContractGas(approveCall);
        const batchGas = BATCH_BASE_GAS + BATCH_PER_RECIPIENT_GAS * BigInt(tx.recipients.length);
        await finish((approveGas + batchGas) * gasPrice, true, true);
      } catch (err) {
        if (cancelled) return;
        const reason = revertReason(err);
        if (!reason) console.error('[vlora] dry run failed (could not reach Arc)', err);
        setPreview(reason ? { status: 'fail', reason } : { status: 'unknown' });
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` captures tx + account by value
  }, [key]);

  return preview;
}

import { useEffect, useState } from 'react';
import { formatUnits } from 'viem';
import { readContract } from 'wagmi/actions';
import { config } from '@/config';
import { ACTIVE_CHAIN_ID } from '@/chain-env';
import { arcNamesAbi, getArcNamesAddress } from '@/arcnames-config';
import { formatTokenAmount } from '@/tokens';

// The yearly .arc fee is read from the deployed contract (YEARLY_FEE), never
// hard-coded, so the app is right on any deployment and after fee changes.
let cached: bigint | undefined;
let inflight: Promise<bigint | undefined> | null = null;

export function fetchArcNameFee(): Promise<bigint | undefined> {
  if (cached !== undefined) return Promise.resolve(cached);
  const contract = getArcNamesAddress(ACTIVE_CHAIN_ID);
  if (!contract) return Promise.resolve(undefined);
  inflight ??= readContract(config, { address: contract, abi: arcNamesAbi, functionName: 'YEARLY_FEE', chainId: ACTIVE_CHAIN_ID })
    .then((fee) => {
      cached = fee;
      return fee;
    })
    .catch((err) => {
      console.error('[vlora] could not read the .arc name fee', err);
      return undefined;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Yearly fee in USDC base units (6 decimals); undefined while loading or if unreadable */
export function useArcNameFee(): bigint | undefined {
  const [fee, setFee] = useState<bigint | undefined>(cached);
  useEffect(() => {
    let alive = true;
    void fetchArcNameFee().then((f) => alive && setFee(f));
    return () => {
      alive = false;
    };
  }, []);
  return fee;
}

/** "0.01 USDC" */
export function formatUsdcFee(raw: bigint): string {
  return `${formatTokenAmount(Number(formatUnits(raw, 6)), 6)} USDC`;
}

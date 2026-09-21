import { useEffect, useState } from 'react';
import { readContract } from 'wagmi/actions';
import { config } from '@/config';
import { ACTIVE_CHAIN_ID } from '@/chain-env';
import { arcNamesAbi, getArcNamesAddress } from '@/arcnames-config';
import { findArcNames, replaceArcNames } from './arcNamesCore';

export * from './arcNamesCore';

export interface ArcResolution {
  /** Text with every resolvable name.arc swapped for its address */
  text: string;
  /** address (lowercase) → "label.arc", for showing names next to addresses */
  labels: Record<string, string>;
  /** Names that aren't registered, have expired, or couldn't be looked up */
  missing: string[];
}

/** Look up one label on-chain. Returns null if it isn't registered or has expired. */
export async function resolveArcName(label: string): Promise<`0x${string}` | null> {
  const contract = getArcNamesAddress(ACTIVE_CHAIN_ID);
  if (!contract) return null;
  try {
    // resolve() reverts for unregistered and expired names
    return await readContract(config, {
      address: contract,
      abi: arcNamesAbi,
      functionName: 'resolve',
      args: [label],
      chainId: ACTIVE_CHAIN_ID,
    });
  } catch {
    return null;
  }
}

export async function resolveArcNamesInText(text: string): Promise<ArcResolution> {
  const names = findArcNames(text);
  if (names.length === 0) return { text, labels: {}, missing: [] };

  const results = await Promise.all(names.map(async (label) => [label, await resolveArcName(label)] as const));
  const resolved: Record<string, string> = {};
  const labels: Record<string, string> = {};
  const missing: string[] = [];
  for (const [label, address] of results) {
    if (address) {
      resolved[label] = address;
      labels[address.toLowerCase()] = `${label}.arc`;
    } else {
      missing.push(`${label}.arc`);
    }
  }
  return { text: replaceArcNames(text, resolved), labels, missing };
}

/**
 * The wallet's primary .arc name, verified both ways: reverseLookup gives the
 * name, and resolve(name) must point back at the wallet. That guards against a
 * stale reverse record on older ArcNames deployments.
 */
export function useMyArcName(address: `0x${string}` | undefined, refreshKey = 0): string | null {
  // Tagged with the address it was looked up for, so a stale name never shows for a new wallet
  const [found, setFound] = useState<{ address: string; name: string | null } | null>(null);
  const contract = getArcNamesAddress(ACTIVE_CHAIN_ID);

  useEffect(() => {
    if (!address || !contract) return;
    let cancelled = false;
    const setName = (name: string | null) => setFound({ address, name });
    void (async () => {
      try {
        const label = await readContract(config, {
          address: contract,
          abi: arcNamesAbi,
          functionName: 'reverseLookup',
          args: [address],
          chainId: ACTIVE_CHAIN_ID,
        });
        if (!label) {
          if (!cancelled) setName(null);
          return;
        }
        const owner = await resolveArcName(label);
        if (!cancelled) setName(owner?.toLowerCase() === address.toLowerCase() ? `${label}.arc` : null);
      } catch {
        if (!cancelled) setName(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [address, contract, refreshKey]);

  return address && contract && found?.address === address ? found.name : null;
}

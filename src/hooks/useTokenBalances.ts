import { useReadContracts } from 'wagmi';
import { erc20Abi } from 'viem';
import { ACTIVE_CHAIN_ID } from '@/chain-env';
import { getTokens, type TokenSymbol } from '@/tokens';

export type TokenBalances = Partial<Record<TokenSymbol, bigint>>;

/** Balances of every registry token for the account; missing = couldn't read */
export function useTokenBalances(account: `0x${string}` | undefined) {
  const tokens = getTokens(ACTIVE_CHAIN_ID);
  const { data, refetch, isError } = useReadContracts({
    contracts: tokens.map((t) => ({
      address: t.address,
      abi: erc20Abi,
      functionName: 'balanceOf' as const,
      args: account ? ([account] as const) : undefined,
      chainId: ACTIVE_CHAIN_ID,
    })),
    query: { enabled: !!account },
  });

  const balances: TokenBalances = {};
  tokens.forEach((t, i) => {
    const r = data?.[i];
    if (r?.status === 'success') balances[t.symbol] = r.result as bigint;
  });
  return { balances, refetch, isError };
}

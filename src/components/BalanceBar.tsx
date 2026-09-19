import { useAccount, useReadContract } from 'wagmi';
import { erc20Abi } from 'viem';
import { getUsdc } from '@/onchain-facts';
import { Amount, usdcDecimalsFor } from '@/onchain-money';
import { TokenUSDC } from '@web3icons/react';
import { ACTIVE_CHAIN_ID, ACTIVE_CHAIN } from '@/chain-env';
import { ShaderBackground } from '@/components/ui/shader-background';
import { cn } from '@/lib/utils';
import { useTokenBalances } from '@/hooks/useTokenBalances';
import { formatTokenAmount, getTokens } from '@/tokens';
import { formatUnits } from 'viem';

function shortAddr(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

// Always-dark card with the brand shader behind it, in both themes
export function BalanceCard({ compact = false, arcName = null }: { compact?: boolean; arcName?: string | null }) {
  const { address, chainId, isConnected } = useAccount();
  const usdcFact = getUsdc(ACTIVE_CHAIN_ID);

  const { data: balance, isLoading, isError } = useReadContract({
    address: usdcFact?.address as `0x${string}`,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: ACTIVE_CHAIN_ID,
    query: { enabled: !!address && !!usdcFact },
  });

  const formatted = balance != null ? Amount.fromRaw(balance, usdcDecimalsFor(ACTIVE_CHAIN_ID)).toFixed(2) : null;
  const wrongChain = isConnected && chainId !== ACTIVE_CHAIN_ID;
  // Other stablecoins (EURC…) shown as a secondary line under the USDC balance
  const { balances } = useTokenBalances(isConnected ? address : undefined);
  const others = getTokens(ACTIVE_CHAIN_ID).filter((t) => t.symbol !== 'USDC');

  return (
    <div className={cn('relative isolate overflow-hidden rounded-3xl bg-[#050b1a] text-white', compact ? 'p-4' : 'p-5')}>
      <ShaderBackground className="absolute inset-0 -z-20 opacity-80" />
      <div className="absolute inset-0 -z-10 bg-gradient-to-br from-[#050b1a]/80 via-[#050b1a]/50 to-[#050b1a]/20" />

      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-[0.16em] text-white/65">USDC balance</span>
        <span
          className={cn(
            'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium backdrop-blur',
            wrongChain ? 'bg-[#ff708e]/20 text-[#ffb3c3]' : 'bg-white/10 text-white/80',
          )}
        >
          <span className={cn('size-1.5 rounded-full', wrongChain ? 'bg-[#ff708e]' : 'bg-[#7ef1b3]')} />
          {wrongChain ? 'Wrong network' : ACTIVE_CHAIN.name}
        </span>
      </div>

      <div className={cn('flex items-end gap-2', compact ? 'mt-3' : 'mt-6')}>
        <TokenUSDC size={compact ? 22 : 28} variant="branded" className="mb-1" />
        <span className={cn('display font-bold tabular-nums leading-none', compact ? 'text-3xl' : 'text-4xl')}>
          {!isConnected ? '—' : formatted != null ? formatted : isError ? '—' : isLoading ? '…' : '—'}
        </span>
        <span className="mb-0.5 text-sm font-medium text-white/60">USDC</span>
      </div>
      {isConnected && others.length > 0 && (
        <p className="mt-2 flex gap-3 text-xs text-white/70">
          {others.map((t) => (
            <span key={t.symbol} className="tabular-nums">
              {balances[t.symbol] != null ? formatTokenAmount(Number(formatUnits(balances[t.symbol]!, t.decimals)), t.decimals) : '—'} {t.symbol}
            </span>
          ))}
        </p>
      )}

      <p className={cn('text-xs text-white/60', compact ? 'mt-2' : 'mt-4')}>
        {isConnected && address ? (
          arcName ? (
            <span className="flex items-center gap-2">
              <span className="display text-sm font-semibold text-white">{arcName}</span>
              <span className="mono">{shortAddr(address)}</span>
            </span>
          ) : (
            <span className="mono">{shortAddr(address)}</span>
          )
        ) : (
          'Connect a wallet to see your balance'
        )}
        {isConnected && isError && balance == null && (
          <span className="mt-1 block text-[#ffb3c3]">Couldn't reach Arc — check any blocker or VPN</span>
        )}
      </p>
    </div>
  );
}

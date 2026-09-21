import { useEffect, useState } from 'react';
import { useAccount, useReadContract, useReadContracts, useWriteContract } from 'wagmi';
import { erc20Abi, formatUnits, parseUnits, type ContractFunctionParameters } from 'viem';
import { toast } from 'sonner';
import { Bot, ChevronDown, Loader2, Pause, Play, ShieldOff, TimerReset, X } from 'lucide-react';
import { ACTIVE_CHAIN_ID, ACTIVE_CHAIN } from '@/chain-env';
import {
  agentFactoryAbi,
  agentVaultAbi,
  DEFAULT_EXPIRY_DAYS,
  DEFAULT_PER_DAY,
  DEFAULT_PER_TX,
  getAgentFactory,
  getAgentTokens,
} from '@/agent-config';
import { getAgentInfo } from '@/lib/agentApi';
import { watchTx } from '@/lib/watchTx';
import { cn } from '@/lib/utils';

export interface AgentVaultState {
  vault: `0x${string}`;
  active: boolean;
}

interface AgentPanelProps {
  onVaultChange: (state: AgentVaultState | null) => void;
  collapsible?: boolean;
}

const DAY = 24 * 60 * 60;

/**
 * Create, fund and control an agent wallet. Everything here is signed by the
 * owner; only the agent's own actions (in agent mode) skip the owner's signature.
 */
export function AgentPanel({ onVaultChange, collapsible = false }: AgentPanelProps) {
  const { address } = useAccount();
  const factory = getAgentFactory(ACTIVE_CHAIN_ID);
  const tokens = getAgentTokens(ACTIVE_CHAIN_ID);
  const { writeContractAsync } = useWriteContract();
  const [open, setOpen] = useState(!collapsible);
  const [agentAddress, setAgentAddress] = useState<`0x${string}` | null | undefined>(undefined);
  const [busy, setBusy] = useState<string | null>(null);

  // Create form
  const [perTx, setPerTx] = useState(DEFAULT_PER_TX);
  const [perDay, setPerDay] = useState(DEFAULT_PER_DAY);
  const [days, setDays] = useState(DEFAULT_EXPIRY_DAYS);
  // Fund form
  const [fundAmount, setFundAmount] = useState('');
  const [fundToken, setFundToken] = useState(tokens[0]?.symbol ?? 'USDC');

  useEffect(() => {
    void getAgentInfo().then((info) => setAgentAddress(info?.agent ?? null));
  }, []);

  const { data: vaults, refetch: refetchVaults } = useReadContract({
    address: factory,
    abi: agentFactoryAbi,
    functionName: 'vaultsOf',
    args: address ? [address] : undefined,
    chainId: ACTIVE_CHAIN_ID,
    query: { enabled: !!factory && !!address },
  });
  const vault = vaults && vaults.length > 0 ? vaults[vaults.length - 1] : undefined;

  // Mixed ABIs in one multicall; results are read back through the typed read() helper
  const { data: state, refetch: refetchState } = useReadContracts({
    contracts: (vault
      ? [
          { address: vault, abi: agentVaultAbi, functionName: 'agentActive', chainId: ACTIVE_CHAIN_ID },
          { address: vault, abi: agentVaultAbi, functionName: 'paused', chainId: ACTIVE_CHAIN_ID },
          { address: vault, abi: agentVaultAbi, functionName: 'agentExpiresAt', chainId: ACTIVE_CHAIN_ID },
          { address: vault, abi: agentVaultAbi, functionName: 'agent', chainId: ACTIVE_CHAIN_ID },
          ...tokens.map((t) => ({ address: t.address, abi: erc20Abi, functionName: 'balanceOf' as const, args: [vault] as const, chainId: ACTIVE_CHAIN_ID })),
          ...tokens.map((t) => ({ address: vault, abi: agentVaultAbi, functionName: 'remainingToday' as const, args: [t.address] as const, chainId: ACTIVE_CHAIN_ID })),
        ]
      : []) as unknown as readonly ContractFunctionParameters[],
    query: { enabled: !!vault, refetchInterval: 15_000 },
  });

  const read = <T,>(i: number) => (state?.[i]?.status === 'success' ? (state[i]!.result as T) : undefined);
  const active = read<boolean>(0) ?? false;
  const paused = read<boolean>(1) ?? false;
  const expiresAt = Number(read<bigint>(2) ?? 0n);
  const currentAgent = read<string>(3);
  const revoked = currentAgent === '0x0000000000000000000000000000000000000000';
  const expired = !revoked && expiresAt > 0 && expiresAt * 1000 < Date.now();
  const balanceOf = (i: number) => read<bigint>(4 + i);
  const remainingOf = (i: number) => read<bigint>(4 + tokens.length + i);

  useEffect(() => {
    onVaultChange(vault ? { vault, active } : null);
  }, [vault, active, onVaultChange]);

  const run = async (label: string, send: () => Promise<`0x${string}`>) => {
    setBusy(label);
    try {
      const hash = await send();
      const result = await watchTx(hash);
      if (result.outcome === 'success') toast.success(`${label}: done`);
      else toast.error(`${label}: ${result.outcome === 'reverted' ? 'reverted on-chain' : result.outcome === 'dropped' ? 'never reached the network' : 'not confirmed yet — check the explorer'}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(/user rejected|denied/i.test(msg) ? 'Cancelled.' : `${label} failed.`);
    } finally {
      setBusy(null);
      void refetchVaults();
      void refetchState();
    }
  };

  if (!factory) {
    return null; // agent wallets not deployed on this network
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-between gap-2 rounded-2xl border border-line/15 bg-surface/80 px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2.5 text-sm font-medium text-ink">
          <Bot className="size-4 text-brand" /> Agent wallet {vault ? (active ? '· active' : '· off') : ''}
        </span>
        <ChevronDown className="size-4 text-muted" />
      </button>
    );
  }

  const header = (
    <div className="flex items-start justify-between gap-2">
      <div>
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
          <Bot className="size-4 text-brand" /> Agent wallet
          <span className="rounded-full bg-brand/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand">
            {ACTIVE_CHAIN.isTestnet ? 'Testnet beta' : 'Beta'}
          </span>
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          A sub-account the AI can spend from without asking you each time — only within the limits you set here, enforced on-chain.
        </p>
      </div>
      {collapsible && (
        <button onClick={() => setOpen(false)} aria-label="Hide" className="text-subtle hover:text-ink">
          <X className="size-4" />
        </button>
      )}
    </div>
  );

  // ── No vault yet: create one ──
  if (!vault) {
    const canCreate = !!agentAddress && !!address && Number(perTx) > 0 && Number(perDay) >= Number(perTx);
    return (
      <section className="rounded-3xl border border-line/10 bg-surface/80 p-5 backdrop-blur">
        {header}
        {agentAddress === null && (
          <p className="mt-3 rounded-xl bg-danger/10 px-3 py-2 text-xs text-danger">
            The agent server isn't reachable. Locally, start it with <span className="mono">npm run agent</span>; on Vercel, set
            its environment variables (see README).
          </p>
        )}
        <div className="mt-4 grid grid-cols-2 gap-2">
          <label className="text-xs text-muted">
            Max per transaction
            <input
              value={perTx}
              onChange={(e) => setPerTx(e.target.value.replace(/[^\d.]/g, ''))}
              inputMode="decimal"
              className="mt-1 w-full rounded-xl border border-line/15 bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand/50"
            />
          </label>
          <label className="text-xs text-muted">
            Max per day
            <input
              value={perDay}
              onChange={(e) => setPerDay(e.target.value.replace(/[^\d.]/g, ''))}
              inputMode="decimal"
              className="mt-1 w-full rounded-xl border border-line/15 bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand/50"
            />
          </label>
        </div>
        <p className="mt-1.5 text-[11px] text-subtle">Applies to each token ({tokens.map((t) => t.symbol).join(', ')}), in whole tokens.</p>
        <label className="mt-3 block text-xs text-muted">
          Agent access expires after
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="mt-1 w-full rounded-xl border border-line/15 bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand/50"
          >
            {[1, 7, 30].map((d) => (
              <option key={d} value={d}>
                {d} day{d === 1 ? '' : 's'}
              </option>
            ))}
          </select>
        </label>
        <button
          disabled={!canCreate || busy != null}
          onClick={() =>
            void run('Create agent wallet', () =>
              writeContractAsync({
                address: factory,
                abi: agentFactoryAbi,
                functionName: 'createVault',
                args: [
                  agentAddress!,
                  BigInt(Math.floor(Date.now() / 1000) + days * DAY),
                  tokens.map((t) => t.address),
                  tokens.map((t) => parseUnits(perTx, t.decimals)),
                  tokens.map((t) => parseUnits(perDay, t.decimals)),
                ],
                chainId: ACTIVE_CHAIN_ID,
              }),
            )
          }
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-ink disabled:opacity-40"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : null} Create agent wallet
        </button>
      </section>
    );
  }

  // ── Existing vault ──
  const status = revoked ? 'Revoked' : paused ? 'Paused' : expired ? 'Expired' : active ? 'Active' : 'Off';
  const fundTokenInfo = tokens.find((t) => t.symbol === fundToken);

  return (
    <section className="rounded-3xl border border-line/10 bg-surface/80 p-5 backdrop-blur">
      {header}
      <div className="mt-4 flex items-center justify-between">
        <span className="mono text-xs text-subtle">
          {vault.slice(0, 8)}…{vault.slice(-6)}
        </span>
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-[11px] font-semibold',
            status === 'Active' ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger',
          )}
        >
          {status}
        </span>
      </div>

      <ul className="mt-3 space-y-1.5">
        {tokens.map((t, i) => (
          <li key={t.symbol} className="flex items-center justify-between text-sm">
            <span className="font-medium text-ink">
              {balanceOf(i) != null ? Number(formatUnits(balanceOf(i)!, t.decimals)).toFixed(2) : '—'} {t.symbol}
            </span>
            <span className="text-xs text-muted">
              {remainingOf(i) != null ? Number(formatUnits(remainingOf(i)!, t.decimals)).toFixed(2) : '—'} left today
            </span>
          </li>
        ))}
      </ul>
      {expiresAt > 0 && !revoked && (
        <p className="mt-2 text-[11px] text-subtle">
          Agent access {expired ? 'expired' : 'until'} {new Date(expiresAt * 1000).toLocaleDateString()}
        </p>
      )}

      {agentAddress === null && (
        <p className="mt-3 rounded-xl bg-danger/10 px-3 py-2 text-xs text-danger">
          The agent server isn't reachable, so the agent can't act and Extend / Re-enable are unavailable. Locally, run{' '}
          <span className="mono">npm run agent</span>; on Vercel, deploy the agent functions and set their environment variables (see README).
        </p>
      )}
      {agentAddress && currentAgent && !revoked && currentAgent.toLowerCase() !== agentAddress.toLowerCase() && (
        <p className="mt-3 rounded-xl bg-danger/10 px-3 py-2 text-xs text-danger">
          This wallet trusts a different agent key than the server is using. Click <strong>Extend {DEFAULT_EXPIRY_DAYS}d</strong> to point it at
          the server's current agent.
        </p>
      )}
      {revoked && agentAddress && (
        <p className="mt-3 rounded-xl bg-surface-2 px-3 py-2 text-xs text-muted">
          The agent is revoked — it can't act. Click <strong>Re-enable</strong> to trust the server's agent again for {DEFAULT_EXPIRY_DAYS} days.
        </p>
      )}

      {/* Fund */}
      <div className="mt-4 flex gap-2">
        <input
          value={fundAmount}
          onChange={(e) => setFundAmount(e.target.value.replace(/[^\d.]/g, ''))}
          placeholder="Amount"
          inputMode="decimal"
          aria-label="Amount to add"
          className="min-w-0 flex-1 rounded-xl border border-line/15 bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand/50"
        />
        <select
          value={fundToken}
          onChange={(e) => setFundToken(e.target.value as typeof fundToken)}
          aria-label="Token"
          className="rounded-xl border border-line/15 bg-surface px-2 text-sm text-ink outline-none"
        >
          {tokens.map((t) => (
            <option key={t.symbol}>{t.symbol}</option>
          ))}
        </select>
        <button
          disabled={!fundTokenInfo || !(Number(fundAmount) > 0) || busy != null}
          onClick={() =>
            void run(`Add ${fundAmount} ${fundToken}`, () =>
              writeContractAsync({
                address: fundTokenInfo!.address,
                abi: erc20Abi,
                functionName: 'transfer',
                args: [vault, parseUnits(fundAmount, fundTokenInfo!.decimals)],
                chainId: ACTIVE_CHAIN_ID,
              }),
            ).then(() => setFundAmount(''))
          }
          className="rounded-xl bg-primary px-3 text-sm font-semibold text-primary-ink disabled:opacity-40"
        >
          Add
        </button>
      </div>

      {/* Controls */}
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        {!revoked && (
          <button
            disabled={busy != null}
            onClick={() =>
              void run(paused ? 'Resume agent' : 'Pause agent', () =>
                writeContractAsync({ address: vault, abi: agentVaultAbi, functionName: 'setPaused', args: [!paused], chainId: ACTIVE_CHAIN_ID }),
              )
            }
            className="flex items-center justify-center gap-1.5 rounded-xl border border-line/15 py-2 font-medium text-ink hover:bg-surface-2 disabled:opacity-40"
          >
            {paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />} {paused ? 'Resume' : 'Pause'}
          </button>
        )}
        {(
          <button
            disabled={busy != null || !agentAddress}
            title={agentAddress ? undefined : 'The agent server is not reachable, so its address is unknown'}
            onClick={() =>
              void run(revoked ? 'Re-enable agent' : 'Extend agent access', () =>
                writeContractAsync({
                  address: vault,
                  abi: agentVaultAbi,
                  functionName: 'setAgent',
                  args: [agentAddress!, BigInt(Math.floor(Date.now() / 1000) + DEFAULT_EXPIRY_DAYS * DAY)],
                  chainId: ACTIVE_CHAIN_ID,
                }),
              )
            }
            className="flex items-center justify-center gap-1.5 rounded-xl border border-line/15 py-2 font-medium text-ink hover:bg-surface-2 disabled:opacity-40"
          >
            <TimerReset className="size-3.5" /> {revoked ? 'Re-enable' : `Extend ${DEFAULT_EXPIRY_DAYS}d`}
          </button>
        )}
        <button
          disabled={busy != null || !address}
          onClick={() =>
            void (async () => {
              for (const [i, t] of tokens.entries()) {
                const bal = balanceOf(i);
                if (bal && bal > 0n) {
                  await run(`Withdraw ${t.symbol}`, () =>
                    writeContractAsync({ address: vault, abi: agentVaultAbi, functionName: 'withdraw', args: [t.address, address!, bal], chainId: ACTIVE_CHAIN_ID }),
                  );
                }
              }
            })()
          }
          className="rounded-xl border border-line/15 py-2 font-medium text-ink hover:bg-surface-2 disabled:opacity-40"
        >
          Withdraw all
        </button>
        {!revoked && (
          <button
            disabled={busy != null}
            onClick={() =>
              void run('Revoke agent', () =>
                writeContractAsync({ address: vault, abi: agentVaultAbi, functionName: 'revokeAgent', chainId: ACTIVE_CHAIN_ID }),
              )
            }
            className="flex items-center justify-center gap-1.5 rounded-xl border border-danger/30 py-2 font-medium text-danger hover:bg-danger/10 disabled:opacity-40"
          >
            <ShieldOff className="size-3.5" /> Revoke
          </button>
        )}
      </div>
      {busy && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted">
          <Loader2 className="size-3 animate-spin" /> {busy}… confirm in your wallet
        </p>
      )}
      <p className="mt-3 text-[11px] leading-relaxed text-subtle">
        Only the balance you add here is at risk, and at most the daily limit per token. Runs on {ACTIVE_CHAIN.name}
        {ACTIVE_CHAIN.isTestnet ? '.' : ' — real funds: start with small limits.'}
      </p>
    </section>
  );
}

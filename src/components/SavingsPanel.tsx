import { useEffect, useState, useSyncExternalStore } from 'react';
import { useAccount } from 'wagmi';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2, Plus, Target, Trash2 } from 'lucide-react';
import { ACTIVE_CHAIN } from '@/chain-env';
import { addGoal, adjustGoal, goalProblem, loadGoals, progressOf, removeGoal, subscribeGoals, type SavingsGoal } from '@/lib/savings';
import { depositToVault, exploreVaults, withdrawFromVault, type EarnVault } from '@/lib/earn';
import { recordActivity } from '@/lib/activity';
import { usdc } from '@/lib/insights';
import { describeWalletError } from '@/lib/walletError';
import { cn } from '@/lib/utils';

/**
 * Savings targets.
 *
 * The money goes into the same Arc lending vault Earn uses, so it earns while it
 * waits; the target is a label over it. Nothing is locked — which the panel says,
 * because a savings feature that implies a commitment it can't enforce is a lie
 * told with a progress bar.
 */
export function SavingsPanel() {
  const { address } = useAccount();
  const queryClient = useQueryClient();
  const goals = useSyncExternalStore(
    subscribeGoals,
    () => loadGoals(address),
    () => loadGoals(undefined),
  );

  const [vault, setVault] = useState<EarnVault | null>(null);
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [due, setDue] = useState('');
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  // Removing a target that still holds money asks first: the money stays in the
  // vault either way, and someone deleting a row does not expect to go hunting
  // for it in Earn afterwards
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void exploreVaults().then(
      (list) => alive && setVault(list[0] ?? null),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, []);

  const create = () => {
    const problem = goalProblem(name, target, goals);
    if (problem) {
      toast.error(problem);
      return;
    }
    addGoal(address, name, Number(target), due ? new Date(`${due}T12:00:00`).getTime() : undefined);
    setName('');
    setTarget('');
    setDue('');
  };

  /** Put money in, or take it back out; both move it through the Earn vault */
  const move = async (goal: SavingsGoal, direction: 'in' | 'out') => {
    const amount = (amounts[goal.id] ?? '').trim();
    if (!amount || Number(amount) <= 0) {
      toast.error('How much?');
      return;
    }
    if (!vault) {
      toast.error(`No savings vault is available on ${ACTIVE_CHAIN.name} right now.`);
      return;
    }
    if (direction === 'out' && Number(amount) > goal.saved) {
      toast.error(`"${goal.name}" only has ${usdc(goal.saved)} USDC in it.`);
      return;
    }
    setBusy(goal.id);
    try {
      if (direction === 'in') await depositToVault(vault.address, amount);
      else await withdrawFromVault(vault.address, amount);
      adjustGoal(address, goal.id, direction === 'in' ? Number(amount) : -Number(amount));
      recordActivity(address, {
        kind: 'earn',
        status: 'success',
        title: direction === 'in' ? `Saved ${amount} USDC toward ${goal.name}` : `Took ${amount} USDC out of ${goal.name}`,
        amount,
        token: 'USDC',
        detail: `${goal.name} · ${vault.name}`,
      });
      setAmounts((prev) => ({ ...prev, [goal.id]: '' }));
      toast.success(direction === 'in' ? `Added to ${goal.name}.` : `Taken out of ${goal.name}.`);
      void queryClient.invalidateQueries();
    } catch (err) {
      toast.error(describeWalletError(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="rounded-3xl border border-line/10 bg-surface/80 p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
        <Target className="size-4 text-brand" /> Savings targets
      </h2>
      <p className="mt-1 text-xs leading-relaxed text-muted">
        Money you put aside sits in the same Arc vault as Earn{vault ? ` (${vault.name}, ${(vault.apy * 100).toFixed(2)}% APY)` : ''}, so it
        earns while it waits. Nothing is locked — take it out whenever you like.
      </p>

      <div className="mt-4 space-y-2 rounded-2xl bg-surface-2 p-3">
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="What for? e.g. Rent"
            aria-label="What the target is for"
            className="w-full rounded-xl border border-line/15 bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand/50"
          />
          <input
            value={target}
            onChange={(e) => setTarget(e.target.value.replace(/[^\d.]/g, ''))}
            inputMode="decimal"
            placeholder="USDC"
            aria-label="Amount to save"
            className="w-24 rounded-xl border border-line/15 bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand/50"
          />
        </div>
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <input
            type="date"
            value={due}
            onChange={(e) => setDue(e.target.value)}
            aria-label="Date to reach it by (optional)"
            className="w-full rounded-xl border border-line/15 bg-surface px-3 py-2 text-xs text-ink outline-none focus:border-brand/50"
          />
          <button
            onClick={create}
            className="flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-primary-ink"
          >
            <Plus className="size-3.5" /> Add target
          </button>
        </div>
      </div>

      {goals.length === 0 ? (
        <p className="mt-3 text-[11px] leading-relaxed text-subtle">
          No targets yet. A date is optional — add one and the panel works out what a day needs to look like to make it.
        </p>
      ) : (
        <ul className="mt-3 space-y-3">
          {goals.map((goal) => {
            const progress = progressOf(goal);
            return (
              <li key={goal.id} className="rounded-2xl border border-line/10 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-ink">{goal.name}</p>
                    <p className="mt-0.5 text-[11px] text-muted">
                      {usdc(goal.saved)} of {usdc(goal.target)} USDC
                      {progress.done && <span className="text-success"> · reached</span>}
                      {!progress.done && progress.perDay != null && (
                        <span>
                          {' '}
                          · {usdc(progress.perDay)} a day for {progress.daysLeft} {progress.daysLeft === 1 ? 'day' : 'days'}
                        </span>
                      )}
                    </p>
                  </div>
                  <button
                    onClick={() => (goal.saved > 0 ? setConfirmRemove(goal.id) : removeGoal(address, goal.id))}
                    aria-label={`Remove ${goal.name}`}
                    className="rounded-lg p-1.5 text-subtle hover:text-danger"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>

                {confirmRemove === goal.id && (
                  <div className="mt-2 rounded-xl border border-danger/30 bg-danger/5 p-2.5">
                    <p className="text-[11px] leading-relaxed text-ink">
                      This target still holds {usdc(goal.saved)} USDC. The money is in the Earn vault and stays there — removing the
                      target only removes the label, and you would take the money out from Earn instead.
                    </p>
                    <div className="mt-2 grid grid-cols-3 gap-1.5">
                      <button
                        onClick={() => {
                          setAmounts((prev) => ({ ...prev, [goal.id]: String(goal.saved) }));
                          setConfirmRemove(null);
                          void move(goal, 'out');
                        }}
                        className="rounded-lg bg-primary px-2 py-1.5 text-[11px] font-semibold text-primary-ink"
                      >
                        Take it out
                      </button>
                      <button
                        onClick={() => {
                          removeGoal(address, goal.id);
                          setConfirmRemove(null);
                        }}
                        className="rounded-lg border border-danger/30 px-2 py-1.5 text-[11px] font-semibold text-danger"
                      >
                        Remove anyway
                      </button>
                      <button
                        onClick={() => setConfirmRemove(null)}
                        className="rounded-lg border border-line/15 px-2 py-1.5 text-[11px] font-semibold text-ink"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {/* A meter, not a chart: one ratio against one limit */}
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-2">
                  <div
                    className={cn('h-full rounded-full', progress.done ? 'bg-success' : 'bg-brand')}
                    style={{ width: `${Math.round(progress.fraction * 100)}%` }}
                  />
                </div>

                <div className="mt-2 grid grid-cols-[1fr_auto_auto] gap-2">
                  <input
                    value={amounts[goal.id] ?? ''}
                    onChange={(e) => setAmounts((prev) => ({ ...prev, [goal.id]: e.target.value.replace(/[^\d.]/g, '') }))}
                    inputMode="decimal"
                    placeholder="USDC"
                    aria-label={`Amount for ${goal.name}`}
                    className="w-full rounded-xl border border-line/15 bg-surface px-3 py-1.5 text-xs text-ink outline-none focus:border-brand/50"
                  />
                  <button
                    onClick={() => void move(goal, 'in')}
                    disabled={busy === goal.id}
                    className="flex items-center gap-1.5 rounded-xl bg-primary px-3 py-1.5 text-[11px] font-semibold text-primary-ink disabled:opacity-40"
                  >
                    {busy === goal.id && <Loader2 className="size-3 animate-spin" />} Add
                  </button>
                  <button
                    onClick={() => void move(goal, 'out')}
                    disabled={busy === goal.id || goal.saved <= 0}
                    className="rounded-xl border border-line/15 px-3 py-1.5 text-[11px] font-semibold text-ink disabled:opacity-40"
                  >
                    Take out
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-3 text-[11px] leading-relaxed text-subtle">
        Targets are kept in this browser; the money is in the vault on {ACTIVE_CHAIN.name}. Removing a target never moves money — if a
        target disappears with a balance, the USDC is still yours in Earn, where you can withdraw it.
      </p>
    </section>
  );
}

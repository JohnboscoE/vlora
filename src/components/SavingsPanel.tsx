import { useEffect, useState, useSyncExternalStore } from 'react';
import { useAccount } from 'wagmi';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2, Plus, Target, Trash2 } from 'lucide-react';
import { ACTIVE_CHAIN } from '@/chain-env';
import {
  addGoal,
  adjustGoal,
  goalProblem,
  loadGoals,
  progressOf,
  reconcileGoals,
  removeGoal,
  subscribeGoals,
  type SavingsGoal,
} from '@/lib/savings';
import { depositToVault, exploreVaults, getPosition, withdrawFromVault, type EarnVault } from '@/lib/earn';
import { recordActivity } from '@/lib/activity';
import { usdc } from '@/lib/insights';
import { describeWalletError } from '@/lib/walletError';
import { cn } from '@/lib/utils';
import { EmptyState } from '@/components/ui';

/**
 * Savings targets.
 *
 * The money goes into the same Arc lending vault Earn uses, so it earns while it
 * waits; the target is a label over it. Nothing is locked — which the panel says,
 * because a savings feature that implies a commitment it can't enforce is a lie
 * told with a progress bar.
 *
 * Because it is one shared vault, the panel reads the real position and trims the
 * targets to fit before showing anything: money taken out in Earn or from the chat
 * must not still be sitting in a target here.
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
  // How much the last reconcile had to take off, so the panel can say why a target
  // shrank on its own instead of letting it look like a bug
  const [trimmed, setTrimmed] = useState(0);
  const [refresh, setRefresh] = useState(0);
  // Removing a target that still holds money asks first — not to block it, but so
  // nobody deletes the row thinking the money went with it
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

  // The vault is one pot: Earn takes from it, the chat takes from it, and so does
  // every target. Read what it actually holds and bring the targets down to fit.
  useEffect(() => {
    if (!vault || !address) return;
    let alive = true;
    void getPosition(vault.address).then(
      (position) => {
        if (!alive) return;
        const off = reconcileGoals(address, Number(position?.balance ?? 0));
        if (off > 0) setTrimmed(off);
      },
      // A failed read says nothing about the balance; leave the targets alone
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [vault, address, refresh]);

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

  /**
   * Put money in, or take it back out; both move it through the Earn vault.
   *
   * `override` carries an amount that isn't in the input box — the remove flow takes
   * the whole balance out, and a setState wouldn't have landed by the time this read
   * it. `thenRemove` drops the target once its money is back out.
   */
  const move = async (goal: SavingsGoal, direction: 'in' | 'out', override?: string, thenRemove = false) => {
    const amount = (override ?? amounts[goal.id] ?? '').trim();
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
      if (thenRemove) removeGoal(address, goal.id);
      toast.success(
        thenRemove
          ? `Took ${amount} USDC out and removed ${goal.name}.`
          : direction === 'in'
            ? `Added to ${goal.name}.`
            : `Taken out of ${goal.name}.`,
      );
      setRefresh((n) => n + 1);
      void queryClient.invalidateQueries();
    } catch (err) {
      toast.error(describeWalletError(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="rounded-card border border-line/10 bg-surface/80 p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
        <Target className="size-4 text-brand" /> Savings targets
      </h2>
      <p className="mt-1 text-xs leading-relaxed text-muted">
        Money you put aside sits in the same Arc vault as Earn{vault ? ` (${vault.name}, ${(vault.apy * 100).toFixed(2)}% APY)` : ''}, so it
        earns while it waits. Nothing is locked — take it out whenever you like.
      </p>

      {trimmed > 0 && (
        <div className="mt-3 flex items-start justify-between gap-2 rounded-card-sm border border-line/15 bg-surface-2 p-3">
          <p className="text-xs leading-relaxed text-muted">
            {usdc(trimmed)} USDC left the vault somewhere else — in Earn, or from the chat. Targets follow the vault, so they have been
            brought down to what it actually holds.
          </p>
          <button onClick={() => setTrimmed(0)} className="shrink-0 text-xs font-semibold text-brand">
            Got it
          </button>
        </div>
      )}

      <div className="mt-4 space-y-2 rounded-card-sm bg-surface-2 p-3">
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="What for? e.g. Rent"
            aria-label="What the target is for"
            className="w-full rounded-control border border-line/15 bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand/50"
          />
          <input
            value={target}
            onChange={(e) => setTarget(e.target.value.replace(/[^\d.]/g, ''))}
            inputMode="decimal"
            placeholder="USDC"
            aria-label="Amount to save"
            className="w-24 rounded-control border border-line/15 bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand/50"
          />
        </div>
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <input
            type="date"
            value={due}
            onChange={(e) => setDue(e.target.value)}
            aria-label="Date to reach it by (optional)"
            className="w-full rounded-control border border-line/15 bg-surface px-3 py-2 text-xs text-ink outline-none focus:border-brand/50"
          />
          <button
            onClick={create}
            className="flex items-center gap-1.5 rounded-control bg-primary px-3 py-2 text-xs font-semibold text-primary-ink"
          >
            <Plus className="size-3.5" /> Add target
          </button>
        </div>
      </div>

      {goals.length === 0 ? (
        <EmptyState
          icon={Target}
          title="No targets yet"
          body="Name something you are saving for and how much it needs. A date is optional — add one and the panel works out what a day has to look like to make it."
        />
      ) : (
        <ul className="mt-3 space-y-3">
          {goals.map((goal) => {
            const progress = progressOf(goal);
            const empty = goal.saved <= 0;
            return (
              <li key={goal.id} className="rounded-card-sm border border-line/10 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-ink">{goal.name}</p>
                    <p className="mt-0.5 text-xs text-muted">
                      {usdc(goal.saved)} of {usdc(goal.target)} USDC{empty ? ' · nothing in it yet' : ' · held in the Earn vault'}
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
                    onClick={() => (empty ? removeGoal(address, goal.id) : setConfirmRemove(goal.id))}
                    aria-label={`Remove ${goal.name}`}
                    className="rounded-control p-1.5 text-subtle hover:text-danger"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>

                {confirmRemove === goal.id && (
                  <div className="mt-2 rounded-control border border-danger/30 bg-danger/5 p-2.5">
                    <p className="text-xs leading-relaxed text-ink">
                      {goal.name} has {usdc(goal.saved)} USDC against it, and that money is in the Earn vault. Take it out and remove the
                      target, or just remove the target — either way the USDC stays yours, and Earn can withdraw it later.
                    </p>
                    <div className="mt-2 grid grid-cols-3 gap-1.5">
                      <button
                        onClick={() => {
                          setConfirmRemove(null);
                          void move(goal, 'out', String(goal.saved), true);
                        }}
                        className="rounded-control bg-primary px-2 py-1.5 text-xs font-semibold text-primary-ink"
                      >
                        Take it out
                      </button>
                      <button
                        onClick={() => {
                          setConfirmRemove(null);
                          removeGoal(address, goal.id);
                        }}
                        className="rounded-control border border-danger/40 px-2 py-1.5 text-xs font-semibold text-danger"
                      >
                        Just remove
                      </button>
                      <button
                        onClick={() => setConfirmRemove(null)}
                        className="rounded-control border border-line/15 px-2 py-1.5 text-xs font-semibold text-ink"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {/* A meter, not a chart: one ratio against one limit */}
                <div className="mt-2 h-2 overflow-hidden rounded-pill bg-surface-2">
                  <div
                    className={cn('h-full rounded-pill', progress.done ? 'bg-success' : 'bg-brand')}
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
                    className="w-full rounded-control border border-line/15 bg-surface px-3 py-1.5 text-xs text-ink outline-none focus:border-brand/50"
                  />
                  <button
                    onClick={() => void move(goal, 'in')}
                    disabled={busy === goal.id}
                    className="flex items-center gap-1.5 rounded-control bg-primary px-3 py-1.5 text-xs font-semibold text-primary-ink disabled:opacity-40"
                  >
                    {busy === goal.id && <Loader2 className="size-3 animate-spin" />} Add
                  </button>
                  <button
                    onClick={() => void move(goal, 'out')}
                    disabled={busy === goal.id || empty}
                    title={empty ? 'Nothing in this target to take out' : undefined}
                    className="rounded-control border border-line/15 px-3 py-1.5 text-xs font-semibold text-ink disabled:opacity-40"
                  >
                    Take out
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-3 text-xs leading-relaxed text-subtle">
        Targets are kept in this browser; the money is in the vault on {ACTIVE_CHAIN.name}. Removing a target never moves money — if a
        target disappears with a balance, the USDC is still yours in Earn, where you can withdraw it.
      </p>
    </section>
  );
}

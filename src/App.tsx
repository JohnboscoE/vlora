import { useCallback, useEffect, useRef, useState } from 'react';
import { useAccount, useWriteContract, useSwitchChain, useSignMessage } from 'wagmi';
import { AgentPanel, type AgentVaultState } from './components/AgentPanel';
import { agentChat, clearSession, ensureSession } from './lib/agentApi';
import { readContract } from 'wagmi/actions';
import { watchTx } from './lib/watchTx';
import { erc20Abi } from 'viem';
import { useQueryClient } from '@tanstack/react-query';
import { WalletButton } from './components/WalletButton';
import { toast } from 'sonner';
import { AnimatePresence } from 'framer-motion';

import { ChatMessage, TypingBubble, type ChatMessageData, type StepState } from './components/ChatMessage';
import { ChatInput, type SlashCommand } from './components/ChatInput';
import { IntentPreview } from './components/IntentPreview';
import { BalanceCard } from './components/BalanceBar';
import { LogoMark } from './components/Logo';
import { ThemeToggle } from './components/ThemeToggle';
import { ArrowRight, Wallet, ArrowUpDown, HelpCircle, Users, FileSpreadsheet, Link2, UserPlus, BookUser, Trash2, AtSign } from 'lucide-react';
import { isAddress } from 'viem';
import { batchToCommand, contactNameProblem, resolveContacts, useContacts, useSavedBatches } from './lib/contacts';
import { buildPaymentLink, clearPaymentRequest, readPaymentRequest } from './lib/paymentLink';
import {
  parseIntent,
  parseArcNameCommand,
  parseCsvBatch,
  describeIntent,
  type ArcNameIntent,
  type ParsedIntent,
  type QuestionTopic,
} from './utils/intentParser';
import { resolveArcName, resolveArcNamesInText, useMyArcName } from './lib/arcNames';
import { arcNamesAbi, getArcNamesAddress } from './arcnames-config';
import { ClaimNameCard } from './components/ClaimNameCard';
import { getUsdc, buildTxExplorerUrl } from '@/onchain-facts';
import { Amount, parseAmount, usdcDecimalsFor } from '@/onchain-money';
import {
  validateArcName,
  validateBatch,
  validateSend,
  validateSwap,
  type ArcNameCheck,
  type BatchCheck,
  type SwapCheck,
} from './utils/validateSend';
import { useTokenBalances } from './hooks/useTokenBalances';
import { formatTokenAmount, getTokens, getToken, type TokenInfo } from './tokens';
import { getSwapVenue, swapRouter02Abi } from './swap-config';
import { getBestQuote, type SwapQuote } from './lib/swapQuote';
import { formatUnits } from 'viem';
import { batchSenderAbi, getBatchSenderAddress } from './batch-config';
import { ACTIVE_CHAIN_ID, ACTIVE_CHAIN } from './chain-env';
import { config } from './config';

// Minimum time the typing bubble shows before a reply
const THINK_MS = 650;

const BATCH_LIVE = getBatchSenderAddress(ACTIVE_CHAIN_ID) != null;
const ARC_NAMES_LIVE = getArcNamesAddress(ACTIVE_CHAIN_ID) != null;
const SWAP_VENUE = getSwapVenue(ACTIVE_CHAIN_ID);
const SWAPS_LIVE = SWAP_VENUE != null;

function friendlyWriteError(err: unknown): string {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  if (msg.includes('user rejected') || msg.includes('user denied')) return 'Transaction cancelled.';
  if (msg.includes('insufficient')) {
    return ACTIVE_CHAIN.isTestnet
      ? 'Insufficient balance. Get test USDC from the Circle faucet (faucet.circle.com).'
      : 'Insufficient USDC balance (remember gas on Arc is also paid in USDC).';
  }
  return 'Transaction failed. Please try again.';
}

function mkId() {
  return Math.random().toString(36).slice(2);
}

function agentMsg(text: string, status?: ChatMessageData['status'], extra?: Partial<ChatMessageData>): ChatMessageData {
  return { id: mkId(), role: 'agent', text, status, timestamp: Date.now(), ...extra };
}

function userMsg(text: string): ChatMessageData {
  return { id: mkId(), role: 'user', text, timestamp: Date.now() };
}

const CHAT_REPLIES = {
  greeting: `Hi! 👋 I'm Vlora. I can send USDC and check your balance on ${ACTIVE_CHAIN.name}. Try "send 5 USDC to 0x…" or "what's my balance?".`,
  help:
    'Here\'s what I can do:\n' +
    '• Send USDC — "send 10 USDC to 0x…"\n' +
    '• Pay several people at once — "send 10 USDC to 0x…, 25 to 0x…" or one "0x… amount" per line\n' +
    '• Check your balance — "what\'s my balance?"\n' +
    (SWAPS_LIVE
      ? '• Swap USDC, EURC and cirBTC — "swap 10 USDC for EURC" (live quote, 0.5% max slippage)\n'
      : '• Preview a swap — "swap 50 USDC for EURC" (not executable on this network yet)\n') +
    '• Send EURC too — "send 5 EURC to james.arc"\n' +
    '• Save contacts — "save 0x… as alice", then "send 10 USDC to alice"' + '\n' +
    '• Request money — "request 25 USDC" gives you a link to share' + '\n' +
    '• Pay .arc names — "send 10 USDC to james.arc"; claim yours with "register yourname.arc"' + '\n' +
    '• Import a CSV of payments with the 📎 button' + '\n' +
    'Type / for quick actions. Every transaction is simulated and shown for confirmation before your wallet signs anything.',
  thanks: 'You\'re welcome! Anything else you\'d like to send or check?',
} as const;

const QUESTION_REPLIES: Record<QuestionTopic, string> = {
  swap: SWAPS_LIVE
    ? `I swap between USDC, EURC and cirBTC through ${SWAP_VENUE?.name}, a Uniswap-style exchange on Arc. Just say "swap 10 USDC for EURC" (or "convert 5 EURC to USDC").\n\n` +
      'You\'ll see the live price, the minimum you\'ll receive, and the fee before your wallet signs. If the price moves more than 0.5%, the swap reverts and nothing changes. I can\'t route through Uniswap or other exchanges.'
    : 'Swaps aren\'t available on this network yet — there\'s no USDC/EURC market I can route to here, so nothing will be swapped.',
  liquidity:
    'Adding liquidity isn\'t available in Vlora yet — there\'s no pool integration, so I can\'t deposit into Uniswap or any other protocol.\n\n' +
    'Right now I can send USDC and check your balance.',
  send:
    'To send USDC, type the amount and a full wallet address, for example:\n"send 10 USDC to 0x…"\n\n' +
    'I\'ll show you a confirmation with the amount, recipient and network. Nothing moves until you approve it in your wallet. ' +
    `Gas on ${ACTIVE_CHAIN.name} is paid in USDC, so that\'s the only token you need.`,
  arc:
    `Vlora runs on ${ACTIVE_CHAIN.name}. On Arc, network fees are paid in USDC rather than a separate gas token, ` +
    'so a wallet holding USDC is all you need to send payments.',
  general:
    'I\'m a payments assistant, so I can help with sending USDC and checking your balance. ' +
    'Try "send 10 USDC to 0x…" or "what\'s my balance?", or type "help" to see everything I can do.',
};

// Example commands prefill the composer (they never submit on their own)
const EXAMPLES = [
  { label: 'Send USDC', prompt: 'Send 1 USDC to 0x', icon: ArrowRight },
  { label: 'Pay several people', prompt: 'Send 10 USDC to 0x…, 25 USDC to 0x…', icon: Users },
  { label: 'Check balance', prompt: "What's my balance?", icon: Wallet },
  { label: SWAPS_LIVE ? 'Swap to EURC' : 'Preview a swap', prompt: 'Swap 10 USDC for EURC', icon: ArrowUpDown },
  { label: 'What can you do?', prompt: 'help', icon: HelpCircle },
];

const CAPABILITIES = [
  { label: 'Send USDC', live: true },
  { label: 'Check balance', live: true },
  { label: 'Batch payments', live: BATCH_LIVE },
  { label: 'Contacts', live: true },
  { label: 'Payment links', live: true },
  { label: '.arc names', live: ARC_NAMES_LIVE },
  { label: 'Swaps (USDC · EURC · cirBTC)', live: SWAPS_LIVE },
  { label: 'Add liquidity', live: false },
];

// "/" menu in the composer
const SLASH_COMMANDS: SlashCommand[] = [
  { id: 'send', label: 'Send USDC', hint: 'Pay one address or contact', icon: ArrowRight, action: 'insert', template: 'Send | USDC to ' },
  { id: 'batch', label: 'Pay several people', hint: 'One "address amount" (or "name amount") per line', icon: Users, action: 'insert', template: 'Pay these people:\n|' },
  { id: 'csv', label: 'Import CSV', hint: 'Batch from a file with address, amount rows', icon: FileSpreadsheet, action: 'csv' },
  { id: 'swap', label: 'Swap', hint: 'USDC, EURC, cirBTC at a live quote', icon: ArrowUpDown, action: 'insert', template: 'Swap | USDC for EURC' },
  { id: 'balance', label: 'Check balance', hint: 'Your USDC on Arc', icon: Wallet, action: 'submit', template: "What's my balance?" },
  { id: 'request', label: 'Request payment', hint: 'Create a link someone can pay', icon: Link2, action: 'insert', template: 'Request | USDC' },
  { id: 'contact', label: 'Save a contact', hint: 'add contact alice 0x…', icon: UserPlus, action: 'insert', template: 'Add contact |' },
  { id: 'contacts', label: 'My contacts', hint: 'List saved contacts', icon: BookUser, action: 'submit', template: 'my contacts' },
  { id: 'register', label: 'Register a .arc name', hint: 'Get paid at yourname.arc · 5 USDC/yr', icon: AtSign, action: 'insert', template: 'Register |.arc for 1 year' },
  { id: 'help', label: 'Help', hint: 'Everything Vlora can do', icon: HelpCircle, action: 'submit', template: 'help' },
];

const MAX_CSV_BYTES = 200_000;

function shortAddr(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

// Sidebar layout from the lg breakpoint; below that the balance card sits in the chat panel
function useIsDesktop() {
  const query = '(min-width: 1024px)';
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return matches;
}

const WELCOME: ChatMessageData = agentMsg(
  'Hello! I can send USDC and check your USDC balance on Arc. Swap and liquidity commands are preview-only for now — they show what would happen but don\'t execute yet.',
  'info',
);

export default function App() {
  const { address, chainId, isConnected } = useAccount();
  const { switchChain } = useSwitchChain();
  const [messages, setMessages] = useState<ChatMessageData[]>([WELCOME]);
  const [pendingIntent, setPendingIntent] = useState<ParsedIntent | null>(null);
  // Agent wallet (testnet beta): when agent mode is on, messages go to the agent server
  const [agentVault, setAgentVault] = useState<AgentVaultState | null>(null);
  const [agentMode, setAgentMode] = useState(false);
  const onAgentVaultChange = useCallback((v: AgentVaultState | null) => {
    setAgentVault(v);
    if (!v?.active) setAgentMode(false);
  }, []);
  const { signMessageAsync } = useSignMessage();
  const [draft, setDraft] = useState('');
  const queryClient = useQueryClient();
  const isDesktop = useIsDesktop();
  const { contacts, saveContact, removeContact } = useContacts();
  const { batches, saveBatch, removeBatch } = useSavedBatches();
  // address (lowercase) → "name.arc" for recipients the user typed as .arc names
  const [arcLabels, setArcLabels] = useState<Record<string, string>>({});
  const [nameRefresh, setNameRefresh] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const wrongChain = isConnected && chainId !== ACTIVE_CHAIN_ID;
  const myArcName = useMyArcName(isConnected ? address : undefined, nameRefresh);
  const showClaimName = ARC_NAMES_LIVE && isConnected && !wrongChain && !myArcName;
  const usdcFact = getUsdc(ACTIVE_CHAIN_ID);

  // Keep a stable ref for addMessage so effects can call it without listing it as a dependency
  const addMessageRef = useRef((msg: ChatMessageData) => {
    setMessages((prev) => [...prev, msg]);
  });

  const addMessage = (msg: ChatMessageData) => addMessageRef.current(msg);

  // Step trackers are updated in place as a transaction progresses
  function setStep(messageId: string, index: number, state: StepState) {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === messageId ? { ...m, steps: m.steps?.map((st, i) => (i === index ? { ...st, state } : st)) } : m,
      ),
    );
  }

  function addTracker(text: string, labels: string[]): string {
    const msg = agentMsg(text, 'info', {
      steps: labels.map((label, i) => ({ label, state: i === 0 ? 'active' : 'pending' })),
    });
    addMessage(msg);
    return msg.id;
  }

  // Opening a payment link prefills the send; the payer still reviews and signs
  useEffect(() => {
    const apply = () => {
      const req = readPaymentRequest();
      if (!req) return;
      clearPaymentRequest();
      setDraft(`Send ${req.amount} USDC to ${req.to}`);
      addMessageRef.current(
        agentMsg(
          `Payment request: ${req.amount} USDC to ${shortAddr(req.to)}. I've filled in the command below — press send to review it. Nothing moves until you confirm in your wallet.`,
          'info',
        ),
      );
    };
    apply();
    window.addEventListener('hashchange', apply);
    return () => window.removeEventListener('hashchange', apply);
  }, []);

  // Balances of every supported stablecoin (checks + preview)
  const { balances, refetch: refetchBalances } = useTokenBalances(address);

  // Transactions: wallet signature (isPending), then our own receipt wait (isConfirming)
  const { writeContractAsync, isPending } = useWriteContract();
  const [isConfirming, setIsConfirming] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const thinkingRef = useRef(false);

  // Scroll the message list (only the list) to the bottom on new messages. Not
  // scrollIntoView: that also scrolls the overflow-hidden app shell, which shoved
  // the composer up over the chat history.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages, isThinking]);

  /**
   * Waits for a submitted tx and reports the outcome in chat. Never leaves the UI
   * spinning: a timeout still ends with an explorer link. Returns true only on success.
   */
  type ConfirmOutcome = 'success' | 'reverted' | 'dropped' | 'timeout';

  /**
   * Waits for a submitted tx and reports the outcome in chat. Always settles, so
   * no step is left spinning: a revert, a tx the network never saw, and a slow
   * confirmation each get their own message.
   */
  async function confirmTx(hash: `0x${string}`, successText: string, silentSuccess = false): Promise<ConfirmOutcome> {
    const explorerUrl = buildTxExplorerUrl(ACTIVE_CHAIN_ID, hash);
    setIsConfirming(true);
    try {
      const result = await watchTx(hash);
      switch (result.outcome) {
        case 'success':
          if (!silentSuccess) addMessage(agentMsg(successText, 'success', { txHash: hash, explorerUrl }));
          break;
        case 'reverted':
          addMessage(
            agentMsg(
              result.outOfGas
                ? 'The transaction ran out of gas and reverted — no USDC moved. On Arc, gas is paid from your USDC, so make sure some is left over for fees, then try again.'
                : 'The transaction reverted on-chain — no USDC moved. Open it in the explorer for details.',
              'error',
              { txHash: hash, explorerUrl },
            ),
          );
          break;
        case 'dropped':
          addMessage(
            agentMsg(
              `${ACTIVE_CHAIN.name} never received this transaction, so nothing was sent. Your wallet most likely failed to broadcast it — check its activity tab for the error, then try again.`,
              'error',
            ),
          );
          break;
        case 'timeout':
          addMessage(
            agentMsg('Transaction submitted, but I couldn\'t confirm it in time. Check the explorer for its status.', 'info', {
              txHash: hash,
              explorerUrl,
            }),
          );
          break;
      }
      return result.outcome;
    } finally {
      setIsConfirming(false);
      // Refresh every on-chain read (balance card + balance intent)
      void queryClient.invalidateQueries();
    }
  }

  const outcomeState = (o: ConfirmOutcome): StepState => (o === 'success' ? 'done' : o === 'timeout' ? 'pending' : 'error');

  async function executeSend(token: TokenInfo, recipient: `0x${string}`, amountRaw: bigint, amountLabel: string) {
    const tracker = addTracker(`Sending ${amountLabel} ${token.symbol} to ${shortAddr(recipient)}`, [
      'Sign in your wallet',
      `Confirm on ${ACTIVE_CHAIN.name}`,
    ]);

    let hash: `0x${string}`;
    try {
      hash = await writeContractAsync({
        address: token.address,
        abi: erc20Abi,
        functionName: 'transfer',
        args: [recipient, amountRaw],
        chainId: ACTIVE_CHAIN_ID,
      });
    } catch (err) {
      setStep(tracker, 0, 'error');
      addMessage(agentMsg(friendlyWriteError(err), 'error'));
      return;
    }

    setStep(tracker, 0, 'done');
    setStep(tracker, 1, 'active');
    const outcome = await confirmTx(hash, `Sent ${amountLabel} ${token.symbol}. Transaction confirmed on ${ACTIVE_CHAIN.name}.`);
    setStep(tracker, 1, outcomeState(outcome));
  }

  // Batch: (1) approve BatchSender for exactly the total, only if the current
  // allowance is short; (2) one batchTransfer call. Atomic on-chain.
  async function executeBatch(check: Extract<BatchCheck, { ok: true }>) {
    if (!usdcFact || !address) return;
    const usdc = usdcFact.address as `0x${string}`;
    const count = check.recipients.length;
    const totalLabel = check.total.toFixed(2);

    let allowance: bigint;
    try {
      allowance = await readContract(config, {
        address: usdc,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [address, check.batchSender],
        chainId: ACTIVE_CHAIN_ID,
      });
    } catch {
      addMessage(agentMsg(`Couldn't read your USDC allowance from ${ACTIVE_CHAIN.name}. Please try again.`, 'error'));
      return;
    }

    const needsApproval = allowance < check.total.raw;
    const labels = [
      ...(needsApproval ? [`Approve exactly ${totalLabel} USDC for the batch contract`] : []),
      `Sign the batch to ${count} recipients`,
      `Confirm on ${ACTIVE_CHAIN.name}`,
    ];
    const tracker = addTracker(`Paying ${count} recipients · ${totalLabel} USDC`, labels);
    let step = 0;

    if (needsApproval) {
      let approveHash: `0x${string}`;
      try {
        approveHash = await writeContractAsync({
          address: usdc,
          abi: erc20Abi,
          functionName: 'approve',
          args: [check.batchSender, check.total.raw],
          chainId: ACTIVE_CHAIN_ID,
        });
      } catch (err) {
        setStep(tracker, 0, 'error');
        addMessage(agentMsg(friendlyWriteError(err), 'error'));
        return;
      }
      const approved = await confirmTx(approveHash, '', true);
      if (approved !== 'success') {
        setStep(tracker, 0, outcomeState(approved));
        return;
      }
      setStep(tracker, 0, 'done');
      step = 1;
      setStep(tracker, step, 'active');
    }

    let hash: `0x${string}`;
    try {
      hash = await writeContractAsync({
        address: check.batchSender,
        abi: batchSenderAbi,
        functionName: 'batchTransfer',
        args: [usdc, check.recipients, check.amounts],
        chainId: ACTIVE_CHAIN_ID,
      });
    } catch (err) {
      setStep(tracker, step, 'error');
      addMessage(agentMsg(friendlyWriteError(err), 'error'));
      return;
    }

    setStep(tracker, step, 'done');
    setStep(tracker, step + 1, 'active');
    const outcome = await confirmTx(hash, `Sent ${totalLabel} USDC to ${count} recipients in one transaction on ${ACTIVE_CHAIN.name}.`);
    setStep(tracker, step + 1, outcomeState(outcome));
  }

  async function describeArcName(label: string, contract: `0x${string}`): Promise<ChatMessageData> {
    try {
      const [owner, expiry, , available] = await readContract(config, {
        address: contract,
        abi: arcNamesAbi,
        functionName: 'nameInfo',
        args: [label],
        chainId: ACTIVE_CHAIN_ID,
      });
      if (available) {
        return agentMsg(`${label}.arc is available. Claim it with "register ${label}.arc" — 5 USDC per year.`, 'info');
      }
      const until = new Date(Number(expiry) * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
      return agentMsg(`${label}.arc → ${owner}\nRegistered until ${until}. You can pay it with "send 10 USDC to ${label}.arc".`, 'success');
    } catch (err) {
      console.error('[vlora] name lookup failed', err);
      return agentMsg(`Couldn't look up ${label}.arc right now. Please try again.`, 'error');
    }
  }

  // Register/renew: approve exactly the fee if needed, then the call. Primary: one call.
  async function executeArcName(intent: ArcNameIntent, check: Extract<ArcNameCheck, { ok: true }>) {
    if (!usdcFact || !address) return;
    const usdc = usdcFact.address as `0x${string}`;
    const name = `${intent.label}.arc`;
    const paid = intent.op === 'register' || intent.op === 'renew';
    const feeLabel = `${intent.years * 5} USDC`;

    let needsApproval = false;
    if (paid) {
      try {
        const allowance = await readContract(config, {
          address: usdc,
          abi: erc20Abi,
          functionName: 'allowance',
          args: [address, check.contract],
          chainId: ACTIVE_CHAIN_ID,
        });
        needsApproval = allowance < check.feeRaw;
      } catch {
        addMessage(agentMsg(`Couldn't read your USDC allowance from ${ACTIVE_CHAIN.name}. Please try again.`, 'error'));
        return;
      }
    }

    const action = intent.op === 'register' ? `Register ${name}` : intent.op === 'renew' ? `Renew ${name}` : `Set ${name} as your name`;
    const tracker = addTracker(action, [
      ...(needsApproval ? [`Approve the ${feeLabel} name fee`] : []),
      `Sign ${intent.op === 'primary' ? 'the change' : 'the registration'}`,
      `Confirm on ${ACTIVE_CHAIN.name}`,
    ]);
    let step = 0;

    if (needsApproval) {
      let approveHash: `0x${string}`;
      try {
        approveHash = await writeContractAsync({
          address: usdc,
          abi: erc20Abi,
          functionName: 'approve',
          args: [check.contract, check.feeRaw],
          chainId: ACTIVE_CHAIN_ID,
        });
      } catch (err) {
        setStep(tracker, 0, 'error');
        addMessage(agentMsg(friendlyWriteError(err), 'error'));
        return;
      }
      const approved = await confirmTx(approveHash, '', true);
      if (approved !== 'success') {
        setStep(tracker, 0, outcomeState(approved));
        return;
      }
      setStep(tracker, 0, 'done');
      step = 1;
      setStep(tracker, step, 'active');
    }

    let hash: `0x${string}`;
    try {
      hash =
        intent.op === 'primary'
          ? await writeContractAsync({
              address: check.contract,
              abi: arcNamesAbi,
              functionName: 'setPrimaryName',
              args: [intent.label],
              chainId: ACTIVE_CHAIN_ID,
            })
          : await writeContractAsync({
              address: check.contract,
              abi: arcNamesAbi,
              functionName: intent.op === 'register' ? 'register' : 'renew',
              args: [intent.label, BigInt(intent.years)],
              chainId: ACTIVE_CHAIN_ID,
            });
    } catch (err) {
      setStep(tracker, step, 'error');
      addMessage(agentMsg(friendlyWriteError(err), 'error'));
      return;
    }

    setStep(tracker, step, 'done');
    setStep(tracker, step + 1, 'active');
    const successText =
      intent.op === 'register'
        ? `${name} is yours for ${intent.years} year${intent.years === 1 ? '' : 's'}. Anyone can now pay you at ${name}.`
        : intent.op === 'renew'
          ? `${name} renewed for ${intent.years} more year${intent.years === 1 ? '' : 's'}.`
          : `${name} is now your primary name.`;
    const outcome = await confirmTx(hash, successText);
    setStep(tracker, step + 1, outcomeState(outcome));
    if (outcome === 'success') setNameRefresh((n) => n + 1);
  }

  /**
   * Right before signing, re-resolve every .arc recipient. If a name changed
   * hands since the preview, stop — the user reviewed a different address.
   */
  async function namesStillMatch(recipients: string[]): Promise<boolean> {
    const named = recipients.filter((r) => arcLabels[r.toLowerCase()]);
    for (const address of named) {
      const label = arcLabels[address.toLowerCase()]!.replace(/\.arc$/, '');
      const current = await resolveArcName(label);
      if (current?.toLowerCase() !== address.toLowerCase()) {
        addMessage(
          agentMsg(`${label}.arc now points to a different address than the one you reviewed, so I stopped. Send the command again to review the new address.`, 'error'),
        );
        return false;
      }
    }
    return true;
  }

  // Swap: re-quote first (stop if the price fell below what was reviewed), approve
  // exactly amountIn if needed, then exactInputSingle with the reviewed minimum.
  async function executeSwap(check: Extract<SwapCheck, { ok: true }>, reviewed: SwapQuote) {
    if (!address) return;
    const { tokenIn, tokenOut, amountIn, venue } = check;
    const inLabel = `${amountIn.toString()} ${tokenIn.symbol}`;
    const minLabel = `${formatTokenAmount(Number(formatUnits(reviewed.minOut, tokenOut.decimals)), tokenOut.decimals)} ${tokenOut.symbol}`;

    let fresh: SwapQuote | null;
    try {
      fresh = await getBestQuote(tokenIn.address, tokenOut.address, amountIn.raw);
    } catch {
      fresh = null;
    }
    if (!fresh || fresh.amountOut < reviewed.minOut) {
      addMessage(agentMsg(`The ${tokenIn.symbol} → ${tokenOut.symbol} price moved since you reviewed it, so I stopped. Send the command again for a fresh quote.`, 'error'));
      return;
    }

    let allowance: bigint;
    try {
      allowance = await readContract(config, {
        address: tokenIn.address,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [address, venue.router],
        chainId: ACTIVE_CHAIN_ID,
      });
    } catch {
      addMessage(agentMsg(`Couldn't read your ${tokenIn.symbol} allowance from ${ACTIVE_CHAIN.name}. Please try again.`, 'error'));
      return;
    }
    const needsApproval = allowance < amountIn.raw;
    const tracker = addTracker(`Swapping ${inLabel} → ${tokenOut.symbol} on ${venue.name}`, [
      ...(needsApproval ? [`Approve exactly ${inLabel}`] : []),
      'Sign the swap',
      `Confirm on ${ACTIVE_CHAIN.name}`,
    ]);
    let step = 0;

    if (needsApproval) {
      let approveHash: `0x${string}`;
      try {
        approveHash = await writeContractAsync({
          address: tokenIn.address,
          abi: erc20Abi,
          functionName: 'approve',
          args: [venue.router, amountIn.raw],
          chainId: ACTIVE_CHAIN_ID,
        });
      } catch (err) {
        setStep(tracker, 0, 'error');
        addMessage(agentMsg(friendlyWriteError(err), 'error'));
        return;
      }
      const approved = await confirmTx(approveHash, '', true);
      if (approved !== 'success') {
        setStep(tracker, 0, outcomeState(approved));
        return;
      }
      setStep(tracker, 0, 'done');
      step = 1;
      setStep(tracker, step, 'active');
    }

    let hash: `0x${string}`;
    try {
      hash = await writeContractAsync({
        address: venue.router,
        abi: swapRouter02Abi,
        functionName: 'exactInputSingle',
        args: [
          {
            tokenIn: tokenIn.address,
            tokenOut: tokenOut.address,
            fee: fresh.fee,
            recipient: address,
            amountIn: amountIn.raw,
            // The reviewed minimum: never accept less than what the user saw
            amountOutMinimum: reviewed.minOut,
            sqrtPriceLimitX96: 0n,
          },
        ],
        chainId: ACTIVE_CHAIN_ID,
      });
    } catch (err) {
      setStep(tracker, step, 'error');
      addMessage(agentMsg(friendlyWriteError(err), 'error'));
      return;
    }

    setStep(tracker, step, 'done');
    setStep(tracker, step + 1, 'active');
    const outcome = await confirmTx(hash, `Swapped ${inLabel} for at least ${minLabel} on ${venue.name}.`);
    setStep(tracker, step + 1, outcomeState(outcome));
  }

  async function handleImportCsv(file: File) {
    if (file.size > MAX_CSV_BYTES) {
      addMessage(agentMsg(`That file is too large (max ${MAX_CSV_BYTES / 1000} KB).`, 'error'));
      return;
    }
    let text: string;
    try {
      text = await file.text();
    } catch {
      addMessage(agentMsg(`Couldn't read ${file.name}.`, 'error'));
      return;
    }
    addMessage(userMsg(`📎 ${file.name}`));
    const batch = parseCsvBatch(resolveContacts(text, contacts));
    if (batch.items.length === 0) {
      addMessage(agentMsg('No payments found in that file. Each row needs an address (or contact name) and an amount, e.g. "0x…, 10".', 'error'));
      return;
    }
    addMessage(
      agentMsg(
        `Imported ${batch.items.length} payments from ${file.name}` +
          (batch.problems.length ? `, but ${batch.problems.length} row(s) need fixing first.` : '. Review and edit them below.'),
        batch.problems.length ? 'error' : 'info',
      ),
    );
    setPendingIntent(batch);
  }

  async function handleAgentMessage(text: string) {
    if (!address || !agentVault) return;
    addMessage(userMsg(text));
    thinkingRef.current = true;
    setIsThinking(true);
    const history = messages
      .filter((m) => m.text && !m.steps)
      .slice(-8)
      .map((m) => ({ role: m.role === 'user' ? ('user' as const) : ('assistant' as const), text: m.text }));
    const sign = (message: string) => signMessageAsync({ message });
    try {
      let result;
      try {
        const token = await ensureSession(address, sign);
        result = await agentChat(token, agentVault.vault, text, history);
      } catch (err) {
        // Expired session: sign in again once, then retry
        if (err instanceof Error && /sign in/i.test(err.message)) {
          clearSession(address);
          const token = await ensureSession(address, sign);
          result = await agentChat(token, agentVault.vault, text, history);
        } else {
          throw err;
        }
      }
      thinkingRef.current = false;
      setIsThinking(false);
      addMessage(agentMsg(result.reply, 'info'));
      for (const a of result.actions) {
        addMessage(
          agentMsg(
            a.status === 'success' ? `Agent: ${a.summary}.` : `Agent couldn't complete: ${a.summary}.`,
            a.status === 'success' ? 'success' : 'error',
            a.txHash ? { txHash: a.txHash, explorerUrl: a.explorerUrl } : undefined,
          ),
        );
      }
      void queryClient.invalidateQueries();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addMessage(
        agentMsg(
          /user rejected|denied/i.test(msg)
            ? 'Sign-in cancelled — the agent needs a (free) signature once to know it\'s you.'
            : /fetch|network|Failed to/i.test(msg)
              ? 'Couldn\'t reach the agent server. Is it running (npm run agent)?'
              : msg,
          'error',
        ),
      );
    } finally {
      thinkingRef.current = false;
      setIsThinking(false);
    }
  }

  async function handleUserMessage(text: string) {
    if (thinkingRef.current) return;
    if (agentMode && agentVault?.active) return handleAgentMessage(text);
    addMessage(userMsg(text));

    // Show the typing bubble for at least THINK_MS so replies don't feel instant/robotic
    thinkingRef.current = true;
    setIsThinking(true);
    const started = performance.now();
    const reply = async (msg: ChatMessageData) => {
      const wait = THINK_MS - (performance.now() - started);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      thinkingRef.current = false;
      setIsThinking(false);
      addMessage(msg);
    };

    try {
      // .arc management commands are read from the raw text; everything else
      // gets contact names and .arc names swapped for addresses first
      let intent: ParsedIntent;
      const arcCommand = parseArcNameCommand(text);
      if (arcCommand) {
        intent = arcCommand;
      } else {
        const withContacts = resolveContacts(text, contacts);
        const arc = await resolveArcNamesInText(withContacts);
        if (Object.keys(arc.labels).length) setArcLabels((prev) => ({ ...prev, ...arc.labels }));
        intent = parseIntent(arc.text);
        if (arc.missing.length && (intent.type === 'send' || intent.type === 'batch')) {
          await reply(
            agentMsg(
              `${arc.missing.join(', ')} ${arc.missing.length === 1 ? 'isn\'t' : 'aren\'t'} registered (or expired), so I can't send to ${arc.missing.length === 1 ? 'it' : 'them'}. Check the spelling, or use a 0x address.`,
              'error',
            ),
          );
          return;
        }
      }

      if (intent.type === 'arcname') {
        const check = validateArcName(intent);
        if (!check.ok) {
          await reply(agentMsg(check.reason, 'error'));
          return;
        }
        if (intent.op === 'lookup') {
          await reply(await describeArcName(intent.label, check.contract));
          return;
        }
        if (!isConnected || !address) {
          await reply(agentMsg('Connect your wallet first — the name will belong to your wallet.', 'info'));
          return;
        }
        await reply(agentMsg(`Preparing: ${describeIntent(intent)}`, 'info'));
        setPendingIntent(intent);
        return;
      }

      // Balance intent — answer in chat, no sheet
      if (intent.type === 'balance') {
        if (!isConnected || !address || !usdcFact) {
          await reply(agentMsg('Connect your wallet first, then I can check your balance.', 'info'));
          return;
        }
        // "EURC balance" → just EURC; a plain "balance" → every stablecoin
        const asked = intent.token && intent.token !== 'USDC' ? getToken(ACTIVE_CHAIN_ID, intent.token) : undefined;
        if (intent.token && intent.token !== 'USDC' && !asked) {
          await reply(agentMsg(`I don't track ${intent.token} — I can show ${getTokens(ACTIVE_CHAIN_ID).map((t) => t.symbol).join(' and ')}.`, 'info'));
          return;
        }
        const tokens = asked ? [asked] : getTokens(ACTIVE_CHAIN_ID);
        let lines: string[];
        try {
          // Read straight from the chain (not the cached query) so the answer is current
          const raw = await Promise.all(
            tokens.map((t) =>
              readContract(config, {
                address: t.address,
                abi: erc20Abi,
                functionName: 'balanceOf',
                args: [address as `0x${string}`],
                chainId: ACTIVE_CHAIN_ID,
              }),
            ),
          );
          lines = tokens.map((t, i) => `${formatTokenAmount(Number(formatUnits(raw[i]!, t.decimals)), t.decimals)} ${t.symbol}`);
        } catch (err) {
          console.error('[vlora] balance read failed', err);
          await reply(agentMsg(`Couldn't read your balance from ${ACTIVE_CHAIN.name}. Please try again.`, 'error'));
          return;
        }
        void refetchBalances(); // keep the balance card in sync
        await reply(
          agentMsg(
            lines.length === 1
              ? `Your balance on ${ACTIVE_CHAIN.name}: ${lines[0]}`
              : `Your balances on ${ACTIVE_CHAIN.name}:\n${lines.map((l) => `• ${l}`).join('\n')}`,
            'success',
          ),
        );
        return;
      }

      if (intent.type === 'contact_add') {
        const problem = contactNameProblem(intent.name);
        if (problem || !isAddress(intent.address)) {
          await reply(agentMsg(problem ?? 'That address isn\'t valid.', 'error'));
          return;
        }
        saveContact(intent.name, intent.address);
        await reply(
          agentMsg(`Saved ${intent.name} → ${shortAddr(intent.address)}. You can now say "send 10 USDC to ${intent.name}".`, 'success'),
        );
        return;
      }

      if (intent.type === 'contacts_list') {
        await reply(
          agentMsg(
            contacts.length
              ? `Your contacts:\n${contacts.map((c) => `• ${c.name} — ${shortAddr(c.address)}`).join('\n')}`
              : 'No contacts yet. Save one with "save 0x… as alice".',
            'info',
          ),
        );
        return;
      }

      if (intent.type === 'request') {
        if (!isConnected || !address) {
          await reply(agentMsg('Connect your wallet first — the payment link sends money to your address.', 'info'));
          return;
        }
        if (intent.token !== 'USDC') {
          await reply(agentMsg(`Payment links are USDC only right now (you asked for ${intent.token}).`, 'info'));
          return;
        }
        let valid = false;
        try {
          valid = parseAmount(ACTIVE_CHAIN_ID, intent.amount).raw > 0n;
        } catch {
          valid = false;
        }
        if (!valid) {
          await reply(agentMsg('How much should I request? Try "request 25 USDC".', 'info'));
          return;
        }
        const link = buildPaymentLink(address, intent.amount);
        await reply(
          agentMsg(
            `Here's your payment link for ${intent.amount} USDC to ${shortAddr(address)}:\n${link}\n\nWhoever opens it gets the payment filled in and still reviews and signs it themselves.${myArcName ? `

Or just tell them to pay you at ${myArcName}.` : ''}`,
            'success',
            { copyText: link },
          ),
        );
        return;
      }

      // Questions about features — answer them, never open a transaction sheet
      if (intent.type === 'question') {
        await reply(agentMsg(QUESTION_REPLIES[intent.topic], 'info'));
        return;
      }

      // Conversation — reply in chat, no sheet
      if (intent.type === 'chat') {
        await reply(agentMsg(CHAT_REPLIES[intent.kind], 'info'));
        return;
      }

      // Unknown intent — a nudge, not an error
      if (intent.type === 'unknown') {
        await reply(
          agentMsg(
            'I\'m not sure what you mean. I understand payment commands like "send 10 USDC to 0x…" or "what\'s my balance?". Type "help" to see everything I can do.',
            'info',
          ),
        );
        return;
      }

      // Show preview sheet for actionable intents
      await reply(agentMsg(`Preparing: ${describeIntent(intent)}`, 'info'));
      setPendingIntent(intent);
    } finally {
      thinkingRef.current = false;
      setIsThinking(false);
    }
  }

  async function handleConfirm(quote?: SwapQuote) {
    if (!pendingIntent || !address || !usdcFact) return;

    if (pendingIntent.type === 'send') {
      const check = validateSend(pendingIntent, balances);
      if (!check.ok) {
        toast.error(check.reason);
        return;
      }
      const intent = pendingIntent;
      setPendingIntent(null);
      if (!(await namesStillMatch([intent.recipient]))) return;
      void executeSend(check.token, intent.recipient as `0x${string}`, check.amount.raw, intent.amount);
    } else if (pendingIntent.type === 'batch') {
      const check = validateBatch(pendingIntent, balances.USDC);
      if (!check.ok) {
        toast.error(check.reason);
        return;
      }
      setPendingIntent(null);
      if (!(await namesStillMatch(check.recipients))) return;
      void executeBatch(check);
    } else if (pendingIntent.type === 'arcname') {
      const check = validateArcName(pendingIntent);
      if (!check.ok) {
        toast.error(check.reason);
        return;
      }
      const intent = pendingIntent;
      setPendingIntent(null);
      void executeArcName(intent, check);
    } else if (pendingIntent.type === 'swap' && SWAPS_LIVE) {
      const check = validateSwap(pendingIntent, balances);
      if (!check.ok) {
        toast.error(check.reason);
        return;
      }
      if (!quote) {
        toast.error('No price yet — wait for the quote, then try again.');
        return;
      }
      setPendingIntent(null);
      void executeSwap(check, quote);
    } else if (pendingIntent.type === 'swap') {
      setPendingIntent(null);
      addMessage(
        agentMsg(
          `Swap preview: ${pendingIntent.amountIn} ${pendingIntent.tokenIn} to ${pendingIntent.tokenOut}. ` +
            `Swaps aren\'t available on ${ACTIVE_CHAIN.name} yet — nothing was sent.`,
          'info',
        ),
      );
    } else if (pendingIntent.type === 'add_lp') {
      setPendingIntent(null);
      addMessage(
        agentMsg(
          `LP intent: ${pendingIntent.amount} ${pendingIntent.token}` +
            `${pendingIntent.pair ? ` in the ${pendingIntent.pair} pool` : ''}` +
            `${pendingIntent.protocol ? ` on ${pendingIntent.protocol}` : ''}. ` +
            'Liquidity execution isn\'t built yet — nothing was sent. It needs a pool contract integration on Arc.',
          'info',
        ),
      );
    }
  }

  function handleCancel() {
    setPendingIntent(null);
    addMessage(agentMsg('Action cancelled.', 'info'));
  }

  function handleSwitchChain() {
    switchChain({ chainId: ACTIVE_CHAIN_ID });
  }

  return (
    <div className="relative flex h-dvh flex-col overflow-clip bg-bg text-ink">
      {/* Ambient brand glow */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden="true">
        <div className="absolute -left-32 -top-40 size-[520px] rounded-full bg-brand/15 blur-[120px] dark:bg-brand/20" />
        <div className="absolute -bottom-48 -right-24 size-[480px] rounded-full bg-brand-2/10 blur-[120px] dark:bg-brand-2/10" />
      </div>

      {/* Top bar */}
      <header className="relative z-20 border-b border-line/10 bg-bg/70 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-3 px-4 py-3 md:px-6">
          <a href="#/" className="flex items-center gap-2.5" title="Back to home">
            <LogoMark />
            <span className="display text-lg font-bold">Vlora</span>
          </a>
          <div className="flex items-center gap-2">
            {wrongChain ? (
              <button
                onClick={handleSwitchChain}
                className="hidden items-center gap-1.5 rounded-full bg-danger/10 px-3 py-2 text-xs font-semibold text-danger sm:flex"
              >
                <span className="size-1.5 rounded-full bg-danger" /> Switch to {ACTIVE_CHAIN.name}
              </button>
            ) : (
              <span className="hidden items-center gap-1.5 rounded-full border border-line/10 bg-surface px-3 py-2 text-xs font-medium text-muted sm:flex">
                <span className="size-1.5 rounded-full bg-success" /> {ACTIVE_CHAIN.name}
              </span>
            )}
            <ThemeToggle />
            <WalletButton />
          </div>
        </div>
      </header>

      {/* Body */}
      <div className="relative z-10 mx-auto flex min-h-0 w-full max-w-7xl flex-1 gap-6 px-3 py-3 md:px-6 md:py-6">
        {/* Sidebar (desktop) */}
        {isDesktop && (
          <aside className="flex w-80 shrink-0 flex-col gap-4 overflow-y-auto">
            <BalanceCard arcName={myArcName} />

            {showClaimName && (
              <ClaimNameCard
                onClaim={(label, years) => setPendingIntent({ type: 'arcname', op: 'register', label, years })}
              />
            )}

            {isConnected && !wrongChain && <AgentPanel onVaultChange={onAgentVaultChange} />}

            <section className="rounded-3xl border border-line/10 bg-surface/80 p-5 backdrop-blur">
              <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-subtle">Try saying</h2>
              <ul className="mt-3 space-y-1.5">
                {EXAMPLES.map(({ label, prompt, icon: Icon }) => (
                  <li key={label}>
                    <button
                      onClick={() => setDraft(prompt)}
                      className="group flex w-full items-center gap-3 rounded-2xl px-2.5 py-2 text-left transition-colors hover:bg-surface-2"
                    >
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
                        <Icon className="size-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-ink">{label}</span>
                        <span className="block truncate text-xs text-muted">"{prompt}"</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>

            <section className="rounded-3xl border border-line/10 bg-surface/80 p-5 backdrop-blur">
              <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-subtle">Contacts</h2>
              {contacts.length === 0 ? (
                <p className="mt-3 text-xs leading-relaxed text-muted">
                  Say <span className="mono text-ink-2">save 0x… as alice</span>, then pay by name.
                </p>
              ) : (
                <ul className="mt-2 space-y-0.5">
                  {contacts.map((c) => (
                    <li key={c.name} className="group flex items-center gap-1">
                      <button
                        onClick={() => setDraft(`Send 1 USDC to ${c.name}`)}
                        title={`Pay ${c.name}`}
                        className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-surface-2"
                      >
                        <span className="truncate text-sm font-medium text-ink">{c.name}</span>
                        <span className="mono shrink-0 text-xs text-subtle">{shortAddr(c.address)}</span>
                      </button>
                      <button
                        onClick={() => removeContact(c.name)}
                        aria-label={`Remove ${c.name}`}
                        className="flex size-8 shrink-0 items-center justify-center rounded-lg text-subtle opacity-0 transition hover:bg-danger/10 hover:text-danger focus:opacity-100 group-hover:opacity-100"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {batches.length > 0 && (
              <section className="rounded-3xl border border-line/10 bg-surface/80 p-5 backdrop-blur">
                <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-subtle">Saved batches</h2>
                <ul className="mt-2 space-y-0.5">
                  {batches.map((b) => (
                    <li key={b.name} className="group flex items-center gap-1">
                      <button
                        onClick={() => setDraft(batchToCommand(b, contacts))}
                        title="Load into the composer"
                        className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-surface-2"
                      >
                        <span className="truncate text-sm font-medium text-ink">{b.name}</span>
                        <span className="shrink-0 text-xs text-subtle">{b.items.length} people</span>
                      </button>
                      <button
                        onClick={() => removeBatch(b.name)}
                        aria-label={`Delete ${b.name}`}
                        className="flex size-8 shrink-0 items-center justify-center rounded-lg text-subtle opacity-0 transition hover:bg-danger/10 hover:text-danger focus:opacity-100 group-hover:opacity-100"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className="rounded-3xl border border-line/10 bg-surface/80 p-5 backdrop-blur">
              <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-subtle">What works today</h2>
              <ul className="mt-3 space-y-2.5">
                {CAPABILITIES.map(({ label, live }) => (
                  <li key={label} className="flex items-center justify-between text-sm">
                    <span className={live ? 'text-ink' : 'text-muted'}>{label}</span>
                    <span
                      className={
                        live
                          ? 'rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-semibold text-success'
                          : 'rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-subtle'
                      }
                    >
                      {live ? 'Live' : 'Preview'}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          </aside>
        )}

        {/* Chat panel */}
        <main className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl border border-line/10 bg-surface/80 shadow-[0_8px_40px_rgba(6,11,24,0.06)] backdrop-blur-xl">
          {!isDesktop && (
            <div className="p-3 pb-0">
              <BalanceCard compact arcName={myArcName} />
              {showClaimName && (
                <div className="mt-3">
                  <ClaimNameCard
                    collapsible
                    onClaim={(label, years) => setPendingIntent({ type: 'arcname', op: 'register', label, years })}
                  />
                </div>
              )}
              {isConnected && !wrongChain && (
                <div className="mt-3">
                  <AgentPanel collapsible onVaultChange={onAgentVaultChange} />
                </div>
              )}
            </div>
          )}

          <div className="flex items-center justify-between border-b border-line/10 px-5 py-3.5 md:px-6">
            <div>
              <h1 className="text-sm font-semibold text-ink">{agentMode ? 'Agent mode' : 'Payments assistant'}</h1>
              <p className={agentMode ? 'text-xs text-brand' : 'text-xs text-muted'}>
                {agentMode
                  ? 'Acts from your agent wallet without asking you to sign — within your limits'
                  : 'Every action is confirmed before your wallet signs'}
              </p>
            </div>
            {agentVault?.active && (
              <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-ink-2">
                Agent
                <button
                  type="button"
                  role="switch"
                  aria-checked={agentMode}
                  onClick={() => setAgentMode((m) => !m)}
                  className={agentMode ? 'relative h-6 w-11 rounded-full bg-brand transition-colors' : 'relative h-6 w-11 rounded-full bg-line/20 transition-colors'}
                >
                  <span
                    className={
                      agentMode
                        ? 'absolute left-0.5 top-0.5 size-5 translate-x-5 rounded-full bg-white shadow transition-transform'
                        : 'absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow transition-transform'
                    }
                  />
                </button>
              </label>
            )}
          </div>

          {/* Messages */}
          <div ref={listRef} className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-5 md:px-6">
            {messages.map((msg) => (
              <ChatMessage key={msg.id} msg={msg} />
            ))}
            <AnimatePresence>{isThinking && <TypingBubble key="typing" />}</AnimatePresence>
          </div>

          {/* Composer */}
          <div className="border-t border-line/10 p-3 md:p-4">
            {!isDesktop && messages.length === 1 && (
              <div className="-mx-1 mb-3 flex gap-2 overflow-x-auto px-1 pb-1">
                {EXAMPLES.map(({ label, prompt }) => (
                  <button
                    key={label}
                    onClick={() => setDraft(prompt)}
                    className="shrink-0 rounded-full border border-line/15 bg-surface px-3 py-1.5 text-xs font-medium text-ink-2 transition-colors hover:bg-surface-2"
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}

            <ChatInput
              value={draft}
              onChange={setDraft}
              onSubmit={(text) => void handleUserMessage(text)}
              onImportCsv={(file) => void handleImportCsv(file)}
              commands={SLASH_COMMANDS}
              disabled={isPending || isConfirming}
              placeholder={agentMode ? 'Tell your agent what to do, e.g. "pay 5 USDC to james.arc"' : 'Try "send 5 USDC to alice", or type / for quick actions'}
            />
            <p className="mt-2 text-center text-[11px] text-subtle">
              Type / for quick actions · Gas paid in USDC · {ACTIVE_CHAIN.name}
            </p>
          </div>
        </main>
      </div>

      {/* Intent confirmation sheet */}
      <AnimatePresence>
        {pendingIntent && (
          <IntentPreview
            intent={pendingIntent}
            onConfirm={(quote) => void handleConfirm(quote)}
            onCancel={handleCancel}
            isPending={isPending}
            isConfirming={isConfirming}
            isConnected={isConnected}
            account={address}
            balances={balances}
            wrongChain={wrongChain}
            onSwitchChain={handleSwitchChain}
            contacts={contacts}
            arcLabels={arcLabels}
            onEditIntent={(next) => setPendingIntent(next)}
            onSaveTemplate={(name, batch) => {
              saveBatch(name, batch.items);
              toast.success(`Saved "${name}"`);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAccount, useWriteContract, useSwitchChain, useSignMessage, useSignTypedData, useSendTransaction } from 'wagmi';
import { AgentPanel, type AgentVaultState } from './components/AgentPanel';
import { agentChat, clearSession, ensureSession } from './lib/agentApi';
import { getPublicClient, readContract } from 'wagmi/actions';
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
import { DepositPanel } from './components/DepositPanel';
import { EarnPanel } from './components/EarnPanel';
import { OfframpPanel } from './components/OfframpPanel';
import { HistoryPanel } from './components/HistoryPanel';
import { BillsPanel } from './components/BillsPanel';
import type { BillCategory } from './lib/bills';
import { MoneyConfirm, type MoneyPlan } from './components/MoneyConfirm';
import { parseBill, parseCashOut, parseEarn, parseSavingsGoal, parseSavingsMove, parseSweep } from './utils/moneyIntent';
import { depositToVault, exploreVaults, getPosition, withdrawFromVault } from './lib/earn';
import { addGoal, adjustGoal, goalProblem, loadGoals } from './lib/savings';
import { SweepConfirm, type SweepPlan } from './components/SweepConfirm';
import { TabStrip, type TabItem } from './components/TabStrip';
import { ComingSoon } from './components/ComingSoon';
import { InsightsPanel } from './components/InsightsPanel';
import { SavingsPanel } from './components/SavingsPanel';
import { resolveBill, resolveCashOut } from './lib/resolveMoneyIntent';
import { runBillPayment, runCashOut } from './lib/runMoney';
import { recordActivity, type NewActivity } from './lib/activity';
import { watchPendingActivity } from './lib/watchPending';
import { LogoMark } from './components/Logo';
import { ThemeToggle } from './components/ThemeToggle';
import { ArrowRight, Wallet, ArrowUpDown, HelpCircle, Users, FileSpreadsheet, Link2, UserPlus, BookUser, Trash2, AtSign, Bot, LogOut, ArrowDownToLine, PiggyBank, Banknote, History, Receipt, MessageSquare, Clock3, TrendingUp, Target } from 'lucide-react';
import { getAgentFactory } from './agent-config';
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
import { fetchArcNameFee, formatUsdcFee, useArcNameFee } from './lib/arcNameFee';
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
import {
  AUTH_VALIDITY_S,
  authorizationUsed,
  buildAuthorization,
  disableGaslessForSession,
  settleGasless,
  TRANSFER_WITH_AUTHORIZATION_TYPES,
  usdcDomain,
  type TransferAuthorization,
} from './lib/gasless';
import { formatUnits, parseUnits } from 'viem';
import { describeWalletError } from './lib/walletError';
import { batchSenderAbi, getBatchSenderAddress } from './batch-config';
import { ACTIVE_CHAIN_ID, ACTIVE_CHAIN } from './chain-env';
import { config } from './config';

// Minimum time the typing bubble shows before a reply
/** Left behind on a sweep so the sweep itself can pay Arc's fees, in USDC */
const SWEEP_GAS_RESERVE = '0.05';

const THINK_MS = 650;

const BATCH_LIVE = getBatchSenderAddress(ACTIVE_CHAIN_ID) != null;
const ARC_NAMES_LIVE = getArcNamesAddress(ACTIVE_CHAIN_ID) != null;
const SWAP_VENUE = getSwapVenue(ACTIVE_CHAIN_ID);
const SWAPS_LIVE = SWAP_VENUE != null;
// The reviewed LI.FI route is signed as-is (its calldata enforces the reviewed minimum
// on-chain) when no better fresh one is available, but only while it's this young.
// Replays on mainnet showed Fly routes still executing at 2 minutes old.
const LIFI_QUOTE_MAX_AGE_MS = 90_000;

// The real reason, not a generic "failed" (src/lib/walletError.ts)
const friendlyWriteError = describeWalletError;

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
    '• Add funds — "/deposit" shows your address, a QR code, and card top-ups where available\n' +
    '• Earn on idle USDC — "/earn" deposits into a lending vault on Arc; withdraw any time\n' +
    '• Save toward something — "/save" sets a target and fills it from the same vault\n' +
    '• Cash out to a bank — "cash out 20 USDC to gtbank 0123456789" (or "/cashout" to browse)\n' +
    '• Move everything — "send everything to 0x…" empties this wallet, after you confirm the address by hand\n' +
    '• Airtime, data and bills — "buy 500 airtime for 08012345678", "pay 5000 electricity for meter 04123456789"\n' +
    '• History and receipts — "/history" lists what you\'ve done and makes a receipt for any of it\n' +
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
    ? (SWAP_VENUE?.kind === 'lifi'
        ? 'I swap between USDC, EURC and cirBTC through LI.FI, the aggregator behind the Arc Portal\'s swap — it finds the best price across Arc\'s exchanges. Just say "swap 10 USDC for EURC" (or "convert 5 EURC to USDC").\n\n'
        : `I swap between USDC, EURC and cirBTC through ${SWAP_VENUE?.name}, a Uniswap-style exchange on Arc. Just say "swap 10 USDC for EURC" (or "convert 5 EURC to USDC").\n\n`) +
      'You\'ll see the live price, the minimum you\'ll receive, and the fee before your wallet signs. If the price moves more than 0.5%, the swap reverts and nothing changes. I can\'t route through Uniswap or other exchanges.'
    : 'Swaps aren\'t available on this network yet — there\'s no USDC/EURC market I can route to here, so nothing will be swapped.',
  liquidity:
    'Vlora doesn\'t do liquidity pools — it\'s a payments app. I can send and swap stablecoins, pay several people at once, and handle .arc names.',
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
];

// "/" menu in the composer
const SLASH_COMMANDS: SlashCommand[] = [
  { id: 'send', label: 'Send USDC', hint: 'Pay one address or contact', icon: ArrowRight, action: 'insert', template: 'Send | USDC to ' },
  { id: 'batch', label: 'Pay several people', hint: 'One "address amount" (or "name amount") per line', icon: Users, action: 'insert', template: 'Pay these people:\n|' },
  { id: 'csv', label: 'Import CSV', hint: 'Batch from a file with address, amount rows', icon: FileSpreadsheet, action: 'csv' },
  { id: 'swap', label: 'Swap', hint: 'USDC, EURC, cirBTC at a live quote', icon: ArrowUpDown, action: 'insert', template: 'Swap | USDC for EURC' },
  { id: 'balance', label: 'Check balance', hint: 'Your USDC on Arc', icon: Wallet, action: 'submit', template: "What's my balance?" },
  { id: 'deposit', label: 'Add funds', hint: 'Your deposit address, QR code, or buy with a card', icon: ArrowDownToLine, action: 'submit', template: '/deposit' },
  { id: 'earn', label: 'Earn on idle USDC', hint: 'Deposit into a lending vault on Arc, withdraw any time', icon: PiggyBank, action: 'submit', template: '/earn' },
  { id: 'savings', label: 'Savings targets', hint: 'Save toward something; it earns in the vault while it waits', icon: Target, action: 'submit', template: '/savings' },
  { id: 'cashout', label: 'Cash out to a bank', hint: 'USDC to naira, shillings and more, paid to a bank account', icon: Banknote, action: 'submit', template: '/cashout' },
  { id: 'airtime', label: 'Airtime, data & bills', hint: 'Top up a phone or pay electricity with USDC', icon: Receipt, action: 'submit', template: '/airtime' },
  { id: 'history', label: 'History & receipts', hint: 'Everything you have done here, with a receipt to download', icon: History, action: 'submit', template: '/history' },
  { id: 'activity', label: 'Spending & statements', hint: 'What you spent by day, week or month, and a statement to take away', icon: TrendingUp, action: 'submit', template: '/spending' },
  { id: 'wallet', label: 'Agent wallet', hint: 'Create, fund or limit the wallet the AI spends from', icon: Bot, action: 'submit', template: '/wallet' },
  { id: 'request', label: 'Request payment', hint: 'Create a link someone can pay', icon: Link2, action: 'insert', template: 'Request | USDC' },
  { id: 'contact', label: 'Save a contact', hint: 'add contact alice 0x…', icon: UserPlus, action: 'insert', template: 'Add contact |' },
  { id: 'contacts', label: 'My contacts', hint: 'List saved contacts', icon: BookUser, action: 'submit', template: 'my contacts' },
  { id: 'register', label: 'Register a .arc name', hint: 'Get paid at yourname.arc instead of a 0x address', icon: AtSign, action: 'insert', template: 'Register |.arc for 1 year' },
  { id: 'agent', label: 'Agent mode', hint: 'Let your agent wallet act without asking you to sign', icon: Bot, action: 'submit', template: '/agent' },
  { id: 'exit', label: 'Exit agent mode', hint: 'Back to normal: you sign every transaction', icon: LogOut, action: 'submit', template: '/exit' },
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
  `Hello! On ${ACTIVE_CHAIN.name} I can send ${getTokens(ACTIVE_CHAIN_ID)
    .map((t) => t.symbol)
    .join(', ')}, pay several people at once, check your balance and handle .arc names.${
    SWAPS_LIVE ? ' I can also swap between those tokens at a live quote.' : ' Swaps aren\'t available on this network yet.'
  } Every action is checked and shown for confirmation before your wallet signs.`,
  'info',
);

export default function App() {
  const { address, chainId, isConnected } = useAccount();
  const { switchChain, switchChainAsync } = useSwitchChain();
  const [messages, setMessages] = useState<ChatMessageData[]>([WELCOME]);
  const [pendingIntent, setPendingIntent] = useState<ParsedIntent | null>(null);
  // Agent wallet (testnet beta): when agent mode is on, messages go to the agent server
  const [agentVault, setAgentVault] = useState<AgentVaultState | null>(null);
  const [agentMode, setAgentMode] = useState(false);
  const onAgentVaultChange = useCallback((v: AgentVaultState | null) => {
    setAgentVault(v);
    if (!v?.active) setAgentMode(false);
  }, []);
  const agentModeRef = useRef(agentMode);
  useEffect(() => {
    if (agentModeRef.current && !agentMode && agentVault && !agentVault.active) {
      setMessages((prev) => [
        ...prev,
        agentMsg('Agent mode turned off because your agent wallet was paused, revoked or expired.', 'info'),
      ]);
    }
    agentModeRef.current = agentMode;
  }, [agentMode, agentVault]);
  const { signMessageAsync } = useSignMessage();
  const { signTypedDataAsync } = useSignTypedData();
  const { sendTransactionAsync } = useSendTransaction();
  const [draft, setDraft] = useState('');
  const queryClient = useQueryClient();
  const isDesktop = useIsDesktop();
  const { contacts, saveContact, removeContact } = useContacts();
  const { batches, saveBatch, removeBatch } = useSavedBatches();
  // address (lowercase) → "name.arc" for recipients the user typed as .arc names
  const [arcLabels, setArcLabels] = useState<Record<string, string>>({});
  const [nameRefresh, setNameRefresh] = useState(0);
  // "/deposit" opens the Add funds panel (it starts collapsed on mobile)
  const [depositOpen, setDepositOpen] = useState(false);
  // "/earn" opens the Earn panel
  const [earnOpen, setEarnOpen] = useState(false);
  // "/cashout" and "/history" open their panels
  const [offrampOpen, setOfframpOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [agentPanelOpen, setAgentPanelOpen] = useState(false);
  /**
   * Which section is on screen. The chat is one of them rather than the thing
   * everything else is stuffed inside — six collapsed panels above the messages
   * left no messages on a phone. Slash commands still work: they switch tab.
   */
  const [tab, setTabState] = useState('chat');
  const setTab = (next: string) => {
    tabRef.current = next;
    setTabState(next);
  };
  // "/airtime", "/data", "/electricity", "/tv" and "/bills" open the same panel on different tabs
  const [billsOpen, setBillsOpen] = useState(false);
  const [billsCategory, setBillsCategory] = useState<BillCategory>('airtime');
  // A cash-out or bill typed into the chat, resolved and waiting for one press
  const [pendingMoney, setPendingMoney] = useState<MoneyPlan | null>(null);
  const [moneyBusy, setMoneyBusy] = useState(false);
  const [moneyStep, setMoneyStep] = useState('');
  // "send everything to 0x…" — held until the address is confirmed by hand
  const [pendingSweep, setPendingSweep] = useState<SweepPlan | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const wrongChain = isConnected && chainId !== ACTIVE_CHAIN_ID;

  // Bills and cash-outs settle at the provider after the money moves, so
  // anything still "in progress" — including from an earlier visit — is followed
  // until it finishes (src/lib/watchPending.ts)
  useEffect(() => watchPendingActivity(address), [address]);

  const arcNameFee = useArcNameFee();
  const myArcName = useMyArcName(isConnected ? address : undefined, nameRefresh);
  const showClaimName = ARC_NAMES_LIVE && isConnected && !wrongChain && !myArcName;
  const usdcFact = getUsdc(ACTIVE_CHAIN_ID);

  // What was said on the tab being shown. The Chat tab keeps the whole record,
  // so a conversation held on Airtime is still there in one place afterwards.
  const tabMessages = messages.filter((m) => m.tab === tab);

  /** The app's sections. The chat is one of them, not the container for the rest. */
  const TABS: TabItem[] = [
    { id: 'chat', label: 'Chat', icon: MessageSquare },
    { id: 'bills', label: 'Airtime & bills', icon: Receipt },
    { id: 'cashout', label: 'Cash out', icon: Banknote },
    { id: 'earn', label: 'Earn', icon: PiggyBank },
    { id: 'savings', label: 'Targets', icon: Target },
    { id: 'deposit', label: 'Add funds', icon: ArrowDownToLine },
    { id: 'activity', label: 'Activity', icon: TrendingUp },
    { id: 'history', label: 'History', icon: History },
    { id: 'wallet', label: 'Agent wallet', icon: Bot },
    { id: 'next', label: "What's next", icon: Clock3 },
  ];



  // Keep a stable ref for addMessage so effects can call it without listing it as a dependency
  const addMessageRef = useRef((msg: ChatMessageData) => {
    setMessages((prev) => [...prev, msg]);
  });

  // The tab a message belongs to, read at the moment it is added rather than
  // from state a callback captured earlier
  const tabRef = useRef('chat');
  const addMessage = (msg: ChatMessageData) => addMessageRef.current({ tab: tabRef.current, ...msg });

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
  async function confirmTx(
    hash: `0x${string}`,
    successText: string,
    silentSuccess = false,
    log?: Omit<NewActivity, 'status' | 'txHash'>,
  ): Promise<ConfirmOutcome> {
    const explorerUrl = buildTxExplorerUrl(ACTIVE_CHAIN_ID, hash);
    setIsConfirming(true);
    try {
      const result = await watchTx(hash);
      // What "/history" and its receipts read (src/lib/activity.ts)
      if (log) {
        recordActivity(address, {
          ...log,
          txHash: hash,
          status: result.outcome === 'success' ? 'success' : result.outcome === 'timeout' ? 'pending' : 'failed',
        });
      }
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
    const outcome = await confirmTx(hash, `Sent ${amountLabel} ${token.symbol}. Transaction confirmed on ${ACTIVE_CHAIN.name}.`, false, {
      kind: 'payment',
      title: `Sent ${amountLabel} ${token.symbol} to ${shortAddr(recipient)}`,
      amount: amountLabel,
      token: token.symbol,
      counterparty: recipient,
    });
    setStep(tracker, 1, outcomeState(outcome));
  }

  /**
   * Gasless USDC send: sign an EIP-3009 authorization (no transaction), then
   * Circle's facilitator submits it and pays the fee. Never falls back to a
   * second send automatically: if the outcome is unclear, the first can still land.
   */
  async function executeGaslessSend(recipient: `0x${string}`, amountRaw: bigint, amountLabel: string) {
    const domain = usdcDomain();
    if (!address || !domain) return;
    const tracker = addTracker(`Sending ${amountLabel} USDC to ${shortAddr(recipient)} · gasless`, [
      'Sign the authorization (no gas)',
      'Circle submits it and pays the fee',
      `Confirm on ${ACTIVE_CHAIN.name}`,
    ]);

    const auth = buildAuthorization(address, recipient, amountRaw);
    let signature: `0x${string}`;
    try {
      signature = await signTypedDataAsync({
        domain,
        types: TRANSFER_WITH_AUTHORIZATION_TYPES,
        primaryType: 'TransferWithAuthorization',
        message: auth,
      });
    } catch (err) {
      setStep(tracker, 0, 'error');
      addMessage(agentMsg(friendlyWriteError(err), 'error'));
      return;
    }
    setStep(tracker, 0, 'done');
    setStep(tracker, 1, 'active');

    setIsConfirming(true);
    let result: Awaited<ReturnType<typeof settleGasless>>;
    try {
      result = await settleGasless(auth, signature);
    } finally {
      setIsConfirming(false);
    }

    const successText = `Sent ${amountLabel} USDC — Circle paid the network fee. Confirmed on ${ACTIVE_CHAIN.name}.`;
    if (result.status === 'success') {
      setStep(tracker, 1, 'done');
      setStep(tracker, 2, 'active');
      const outcome = await confirmTx(result.transaction, successText, false, {
        kind: 'payment',
        title: `Sent ${amountLabel} USDC to ${shortAddr(recipient)}`,
        amount: amountLabel,
        token: 'USDC',
        counterparty: recipient,
        detail: 'Gasless — Circle paid the network fee',
        fee: '0',
      });
      setStep(tracker, 2, outcomeState(outcome));
      return;
    }

    if (result.status === 'rejected') {
      setStep(tracker, 1, 'error');
      if (result.disable) disableGaslessForSession();
      addMessage(
        agentMsg(
          result.disable
            ? `Circle couldn't sponsor this send: ${result.reason}. Nothing moved. Gasless is off for now — send it again and you'll pay the network fee (about a cent) yourself.`
            : `Circle couldn't sponsor this send (${result.reason}). Nothing moved. To pay the fee yourself, send it again and untick "Gasless".`,
          'error',
        ),
      );
      return;
    }

    // Outcome unknown: watch the chain for the authorization being used
    const landed = await waitForAuthorization(auth);
    void queryClient.invalidateQueries();
    if (landed) {
      setStep(tracker, 1, 'done');
      setStep(tracker, 2, 'done');
      recordActivity(address, {
        kind: 'payment',
        status: 'success',
        title: `Sent ${amountLabel} USDC to ${shortAddr(recipient)}`,
        amount: amountLabel,
        token: 'USDC',
        counterparty: recipient,
        detail: 'Gasless — Circle paid the network fee',
        fee: '0',
      });
      addMessage(agentMsg(successText, 'success'));
      return;
    }
    setStep(tracker, 1, 'pending');
    const until = new Date(Number(auth.validBefore) * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    addMessage(
      agentMsg(
        `Circle hasn't settled this yet (${result.reason}). It can still go through until ${until}, so don't send it again before then. Check your balance after that time.`,
        'info',
      ),
    );
  }

  // Polls USDC's authorizationState for up to ~60s
  async function waitForAuthorization(auth: TransferAuthorization): Promise<boolean> {
    const deadline = Date.now() + Math.min(60_000, AUTH_VALIDITY_S * 1000);
    while (Date.now() < deadline) {
      if (await authorizationUsed(auth)) return true;
      await new Promise((r) => setTimeout(r, 3_000));
    }
    return (await authorizationUsed(auth)) === true;
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
    const outcome = await confirmTx(
      hash,
      `Sent ${totalLabel} USDC to ${count} recipients in one transaction on ${ACTIVE_CHAIN.name}.`,
      false,
      {
        kind: 'payment',
        title: `Sent ${totalLabel} USDC to ${count} recipients`,
        amount: totalLabel,
        token: 'USDC',
        detail: `${count} recipients in one transaction`,
      },
    );
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
        const fee = await fetchArcNameFee();
        return agentMsg(`${label}.arc is available. Claim it with "register ${label}.arc"${fee != null ? ` — ${formatUsdcFee(fee)} per year` : ''}.`, 'info');
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
    const feeLabel = formatUsdcFee(check.feeRaw);

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
    const outcome = await confirmTx(hash, successText, false, {
      kind: 'payment',
      title: intent.op === 'register' ? `Registered ${name}` : intent.op === 'renew' ? `Renewed ${name}` : `Set ${name} as your primary name`,
      ...(paid ? { amount: feeLabel, token: 'USDC' } : {}),
      counterparty: name,
    });
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
      const label = arcLabels[address.toLowerCase()].replace(/\.arc$/, '');
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
    if (check.venue.kind === 'lifi') return executeLifiSwap(check, reviewed);
    const { tokenIn, tokenOut, amountIn, venue } = check;
    const inLabel = `${amountIn.toString()} ${tokenIn.symbol}`;
    const minLabel = `${formatTokenAmount(Number(formatUnits(reviewed.minOut, tokenOut.decimals)), tokenOut.decimals)} ${tokenOut.symbol}`;

    let fresh: SwapQuote | null;
    try {
      fresh = await getBestQuote(tokenIn.address, tokenOut.address, amountIn.raw, address);
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
    const outcome = await confirmTx(hash, `Swapped ${inLabel} for at least ${minLabel} on ${venue.name}.`, false, {
      kind: 'swap',
      title: `Swapped ${inLabel} for ${tokenOut.symbol}`,
      amount: amountIn.toString(),
      token: tokenIn.symbol,
      detail: `At least ${minLabel} via ${venue.name}`,
    });
    setStep(tracker, step + 1, outcomeState(outcome));
  }

  /**
   * LI.FI swap: approve exactly amountIn for the pinned LI.FI router if needed,
   * then sign LI.FI's verified transaction (src/lib/lifi.ts). Its calldata enforces
   * the minimum on-chain; we only ever sign a route whose minimum is at least the
   * one the user reviewed.
   */
  async function executeLifiSwap(check: Extract<SwapCheck, { ok: true }>, reviewed: SwapQuote) {
    if (!address || !reviewed.lifi) return;
    const { tokenIn, tokenOut, amountIn, venue } = check;
    const inLabel = `${amountIn.toString()} ${tokenIn.symbol}`;

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
    const tracker = addTracker(`Swapping ${inLabel} → ${tokenOut.symbol} via LI.FI`, [
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

    // Prefer a fresh route (DEX calldata can go stale), but never a worse minimum
    let fresh: SwapQuote | null = null;
    try {
      fresh = await getBestQuote(tokenIn.address, tokenOut.address, amountIn.raw, address);
    } catch {
      fresh = null;
    }
    let route: SwapQuote;
    if (fresh?.lifi && fresh.minOut >= reviewed.minOut) {
      route = fresh;
    } else if (Date.now() - reviewed.quotedAt < LIFI_QUOTE_MAX_AGE_MS) {
      route = reviewed;
    } else {
      setStep(tracker, step, 'error');
      addMessage(agentMsg(`The ${tokenIn.symbol} → ${tokenOut.symbol} price moved since you reviewed it, so I stopped. Send the command again for a fresh quote.`, 'error'));
      return;
    }
    const lifi = route.lifi!;
    const minLabel = `${formatTokenAmount(Number(formatUnits(route.minOut, tokenOut.decimals)), tokenOut.decimals)} ${tokenOut.symbol}`;

    // Set the gas limit ourselves: an aggregator route's gas use swings between blocks
    // (542k–609k for the same USDC→EURC route), so a wallet's own tight estimate can run
    // out mid-swap. Use LI.FI's padded limit, or 1.5× our estimate if that's higher.
    let gas: bigint | undefined = lifi.gasLimit;
    try {
      const estimate = await getPublicClient(config, { chainId: ACTIVE_CHAIN_ID })?.estimateGas({ account: address, to: lifi.to, data: lifi.data });
      if (estimate != null) {
        const padded = (estimate * 3n) / 2n;
        gas = gas == null || padded > gas ? padded : gas;
      }
    } catch {
      setStep(tracker, step, 'error');
      addMessage(agentMsg(`This swap would fail right now (the route no longer fills). Nothing was sent — send the command again for a fresh quote.`, 'error'));
      return;
    }

    let hash: `0x${string}`;
    try {
      hash = await sendTransactionAsync({ to: lifi.to, data: lifi.data, value: 0n, gas, chainId: ACTIVE_CHAIN_ID });
    } catch (err) {
      setStep(tracker, step, 'error');
      addMessage(agentMsg(friendlyWriteError(err), 'error'));
      return;
    }

    setStep(tracker, step, 'done');
    setStep(tracker, step + 1, 'active');
    const outcome = await confirmTx(hash, `Swapped ${inLabel} for at least ${minLabel} (${lifi.tool} via LI.FI).`, false, {
      kind: 'swap',
      title: `Swapped ${inLabel} for ${tokenOut.symbol}`,
      amount: amountIn.toString(),
      token: tokenIn.symbol,
      detail: `At least ${minLabel} via ${lifi.tool} (LI.FI)`,
    });
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

  // /agent and /exit switch modes; they are handled here, never sent to the agent
  function handleModeCommand(command: string): boolean {
    const cmd = command.trim().toLowerCase();
    if (['/save', '/savings', '/target', '/targets', '/goal', '/goals'].includes(cmd)) {
      addMessage(userMsg(command.trim()));
      setTab('savings');
      addMessage(
        agentMsg(
          isConnected
            ? 'Targets are open. Name what you are saving for and how much — the money sits in the same Arc vault as Earn, so it earns while it waits, and nothing is locked.'
            : 'Connect your wallet or sign in first, then open Targets again.',
          'info',
        ),
      );
      return true;
    }
    if (['/earn', '/invest', '/investments', '/yield'].includes(cmd)) {
      addMessage(userMsg(command.trim()));
      setTab('earn');
      addMessage(
        agentMsg(
          isConnected
            ? `Earn is open in the panel. It puts idle USDC into a lending vault on ${ACTIVE_CHAIN.name} — the vault holds it, not Vlora, and you can withdraw any time. Rates vary and aren't guaranteed.`
            : 'Connect your wallet or sign in first, then open Earn again.',
          'info',
        ),
      );
      return true;
    }
    const billsCommands: Record<string, BillCategory> = {
      '/airtime': 'airtime',
      '/topup': 'airtime',
      '/recharge': 'airtime',
      '/data': 'data',
      '/electricity': 'electricity',
      '/nepa': 'electricity',
      '/light': 'electricity',
      '/tv': 'tv',
      '/bills': 'electricity',
      '/bill': 'electricity',
      '/utilities': 'electricity',
    };
    if (cmd in billsCommands) {
      addMessage(userMsg(command.trim()));
      setBillsCategory(billsCommands[cmd] ?? 'airtime');
      setTab('bills');
      addMessage(
        agentMsg(
          isConnected
            ? 'Airtime and bills are open in the panel. Pick a provider and an amount, enter the phone or meter number, and it is paid with your USDC — Bitrefill delivers it.'
            : 'Connect your wallet or sign in first, then open Airtime & bills again.',
          'info',
        ),
      );
      return true;
    }
    if (['/cashout', '/cash-out', '/offramp', '/withdraw', '/bank'].includes(cmd)) {
      addMessage(userMsg(command.trim()));
      setTab('cashout');
      addMessage(
        agentMsg(
          isConnected
            ? 'Cash out is open in the panel. Pick an amount and a bank account, and the payout lands in local currency. Paycrest pays the bank; Vlora never holds your money.'
            : 'Connect your wallet or sign in first, then open Cash out again.',
          'info',
        ),
      );
      return true;
    }
    if (['/wallet', '/agent-wallet', '/agentwallet', '/vault'].includes(cmd)) {
      addMessage(userMsg(command.trim()));
      setTab('wallet');
      addMessage(
        agentMsg(
          isConnected
            ? 'Agent wallet is open in the panel — create one, fund it, set its limits, or pause it. You sign all of that yourself.'
            : 'Connect your wallet or sign in first, then open the agent wallet again.',
          'info',
        ),
      );
      return true;
    }
    if (['/spending', '/insights', '/chart', '/statement'].includes(cmd)) {
      addMessage(userMsg(command.trim()));
      setTab('activity');
      addMessage(
        agentMsg(
          'Activity is open — what you spent by day, week, month or year. Tap a point to see what that period went on, and there are statement downloads at the bottom.',
          'info',
        ),
      );
      return true;
    }
    if (['/history', '/activity', '/receipts', '/transactions'].includes(cmd)) {
      addMessage(userMsg(command.trim()));
      setTab('history');
      addMessage(
        agentMsg(
          'History is open in the panel — payments, swaps, bridges, cash-outs and bills, each with a receipt you can download or share.',
          'info',
        ),
      );
      return true;
    }
    if (['/stocks', '/stock', '/shares', '/equities', '/crypto', '/trade'].includes(cmd)) {
      addMessage(userMsg(command.trim()));
      addMessage(
        agentMsg(
          `Vlora doesn't do tokenized stocks or general crypto trading — there's no equities market on ${ACTIVE_CHAIN.name}, and that would need a licensed broker. What it does do: swap between USDC, EURC and cirBTC at a live quote ("swap 10 USDC for EURC"), Earn, which lends idle USDC in a vault (/earn), and cashing out to a bank account (/cashout).`,
          'info',
        ),
      );
      return true;
    }
    if (['/deposit', '/add', '/fund', '/add funds'].includes(cmd)) {
      addMessage(userMsg(command.trim()));
      setTab('deposit');
      addMessage(
        agentMsg(
          isConnected
            ? `Add funds is open — copy your address or scan the QR code, and send ${getTokens(ACTIVE_CHAIN_ID)[0]?.symbol ?? 'USDC'} on ${ACTIVE_CHAIN.name}. Remember gas is paid in USDC too.`
            : 'Connect your wallet or sign in first, then open Add funds again to see your deposit address.',
          'info',
        ),
      );
      return true;
    }
    const enter = cmd === '/agent';
    const exit = ['/exit', '/cancel', '/normal', '/cancel agent', '/exit agent'].includes(cmd);
    if (!enter && !exit) return false;

    addMessage(userMsg(command.trim()));
    if (exit) {
      if (!agentMode) {
        addMessage(agentMsg('You\'re already in normal mode — every transaction asks your wallet to sign.', 'info'));
      } else {
        setAgentMode(false);
        addMessage(agentMsg('Back to normal mode. Every transaction will ask your wallet to sign again.', 'success'));
      }
      return true;
    }

    // Entering agent mode: explain exactly what's missing if it can't start
    if (!getAgentFactory(ACTIVE_CHAIN_ID)) {
      addMessage(agentMsg(`Agent wallets aren't available on ${ACTIVE_CHAIN.name}.`, 'info'));
    } else if (!isConnected) {
      addMessage(agentMsg('Connect your wallet first — the agent wallet belongs to it.', 'info'));
    } else if (!agentVault) {
      addMessage(
        agentMsg(
          'You don\'t have an agent wallet yet. Create one in the Agent wallet panel (set your limits), add a few USDC to it, then type /agent again.',
          'info',
        ),
      );
    } else if (!agentVault.active) {
      addMessage(
        agentMsg('Your agent wallet is paused, expired or revoked. Resume or extend it in the Agent wallet panel, then type /agent again.', 'info'),
      );
    } else if (agentMode) {
      addMessage(agentMsg('Agent mode is already on. Type /exit to go back to normal mode.', 'info'));
    } else {
      setAgentMode(true);
      addMessage(
        agentMsg(
          'Agent mode on. I\'ll act from your agent wallet without asking you to sign — only within its limits.\n' +
            'Try: "what\'s in my agent wallet?", "send 1 USDC to 0x…" or "swap 2 USDC for EURC".\n' +
            'Type /exit to go back to normal mode.',
          'success',
        ),
      );
    }
    return true;
  }

  /**
   * "cash out 20 USDC to gtbank 0123456789" and "buy 500 airtime for 0801…".
   * Vlora is meant to be typed at, so these resolve the bank or the operator
   * against the live APIs and put one confirmation in front of the user,
   * instead of sending them to a form.
   */
  /**
   * "Send everything to 0x…".
   *
   * On Arc the gas token is USDC, so sweeping literally everything would leave
   * nothing to pay for the sweep — a reserve stays behind, and the confirmation
   * says so rather than silently sending less than "everything".
   */
  function planSweep(to: `0x${string}`): SweepPlan | null {
    const tokens = getTokens(ACTIVE_CHAIN_ID);
    const lines: SweepPlan['lines'] = [];
    for (const token of tokens) {
      const held = balances[token.symbol] ?? 0n;
      if (held <= 0n) continue;
      const isGasToken = token.address.toLowerCase() === (usdcFact?.address ?? '').toLowerCase();
      // Enough for this sweep's transfers several times over, at Arc's fees
      const reserve = isGasToken ? parseUnits(SWEEP_GAS_RESERVE, token.decimals) : 0n;
      const sending = held > reserve ? held - reserve : 0n;
      if (sending <= 0n) continue;
      lines.push({
        symbol: token.symbol,
        amount: formatUnits(sending, token.decimals),
        ...(reserve > 0n ? { reserved: formatUnits(reserve, token.decimals) } : {}),
      });
    }
    return lines.length > 0 ? { to, lines } : null;
  }

  async function runSweep() {
    if (!pendingSweep || !address) return;
    const tokens = getTokens(ACTIVE_CHAIN_ID);
    setMoneyBusy(true);
    try {
      for (const line of pendingSweep.lines) {
        const token = tokens.find((t) => t.symbol === line.symbol);
        if (!token) continue;
        setMoneyStep(`Sending ${line.amount} ${line.symbol}…`);
        // One signature per token: a partial failure leaves the rest untouched
        await executeSend(token, pendingSweep.to, parseUnits(line.amount, token.decimals), line.amount);
      }
      setPendingSweep(null);
      addMessage(agentMsg(`Sent everything to ${shortAddr(pendingSweep.to)}. "/history" has a receipt for each token.`, 'success'));
    } catch (err) {
      console.error('[vlora] sweep failed', err);
      addMessage(agentMsg(describeWalletError(err), 'error'));
    } finally {
      setMoneyBusy(false);
      setMoneyStep('');
    }
  }

  async function handleMoneyMessage(text: string): Promise<boolean> {
    const sweep = parseSweep(text);
    if (sweep) {
      addMessage(userMsg(text));
      if (!isConnected || !address) {
        addMessage(agentMsg('Connect your wallet or sign in first.', 'info'));
        return true;
      }
      const plan = planSweep(sweep.to as `0x${string}`);
      if (!plan) {
        addMessage(agentMsg('There is nothing to send — this wallet is empty.', 'info'));
        return true;
      }
      setPendingSweep(plan);
      addMessage(
        agentMsg(
          `That would send ${plan.lines.map((l) => `${l.amount} ${l.symbol}`).join(', ')} to ${sweep.to}, and it can't be undone. Check the address below and confirm.`,
          'info',
        ),
      );
      return true;
    }

    const newGoal = parseSavingsGoal(text);
    if (newGoal) {
      addMessage(userMsg(text));
      if (!isConnected || !address) {
        addMessage(agentMsg('Connect your wallet or sign in first.', 'info'));
        return true;
      }
      const problem = goalProblem(newGoal.name, newGoal.amount, loadGoals(address));
      if (problem) {
        addMessage(agentMsg(problem, 'error'));
        return true;
      }
      addGoal(address, newGoal.name, Number(newGoal.amount), newGoal.due ?? undefined);
      setTab('savings');
      addMessage(
        agentMsg(
          `Target set: ${newGoal.name}, ${newGoal.amount} USDC${
            newGoal.due ? ` by ${new Date(newGoal.due).toLocaleDateString()}` : ''
          }. Add to it whenever you like — say "add 1 to ${newGoal.name}" or use the panel.`,
          'success',
        ),
      );
      return true;
    }

    // Moving money in or out of a target the person named
    const goalMove = address ? parseSavingsMove(text) : null;
    const namedGoal = goalMove
      ? loadGoals(address).find((g) => g.name.toLowerCase() === goalMove.goal.toLowerCase().trim())
      : undefined;
    if (goalMove && namedGoal && address) {
      addMessage(userMsg(text));
      thinkingRef.current = true;
      setIsThinking(true);
      try {
        const vaults = await exploreVaults();
        const vault = vaults[0];
        if (!vault) throw new Error(`No savings vault is available on ${ACTIVE_CHAIN.name} right now.`);
        if (goalMove.action === 'take' && Number(goalMove.amount) > namedGoal.saved) {
          throw new Error(`"${namedGoal.name}" only has ${namedGoal.saved} USDC in it.`);
        }
        setMoneyBusy(true);
        setMoneyStep(
          goalMove.action === 'add' ? `Adding ${goalMove.amount} USDC to ${namedGoal.name}\u2026` : `Taking ${goalMove.amount} USDC out of ${namedGoal.name}\u2026`,
        );
        if (goalMove.action === 'add') await depositToVault(vault.address, goalMove.amount);
        else await withdrawFromVault(vault.address, goalMove.amount);
        adjustGoal(address, namedGoal.id, goalMove.action === 'add' ? Number(goalMove.amount) : -Number(goalMove.amount));
        recordActivity(address, {
          kind: 'earn',
          status: 'success',
          title:
            goalMove.action === 'add'
              ? `Saved ${goalMove.amount} USDC toward ${namedGoal.name}`
              : `Took ${goalMove.amount} USDC out of ${namedGoal.name}`,
          amount: goalMove.amount,
          token: 'USDC',
          detail: `${namedGoal.name} · ${vault.name}`,
        });
        addMessage(
          agentMsg(
            goalMove.action === 'add'
              ? `Added ${goalMove.amount} USDC to ${namedGoal.name}. It earns in ${vault.name} while it waits.`
              : `Took ${goalMove.amount} USDC out of ${namedGoal.name}.`,
            'success',
          ),
        );
        void queryClient.invalidateQueries();
      } catch (err) {
        console.error('[vlora] target move failed', err);
        addMessage(agentMsg(describeWalletError(err), 'error'));
      } finally {
        setMoneyBusy(false);
        setMoneyStep('');
        thinkingRef.current = false;
        setIsThinking(false);
      }
      return true;
    }

    const earn = parseEarn(text, tabRef.current === 'earn');
    if (earn) {
      addMessage(userMsg(text));
      if (!isConnected || !address) {
        addMessage(agentMsg('Connect your wallet or sign in first.', 'info'));
        return true;
      }
      thinkingRef.current = true;
      setIsThinking(true);
      try {
        const vaults = await exploreVaults();
        const vault = vaults[0];
        if (!vault) throw new Error(`No savings vault is available on ${ACTIVE_CHAIN.name} right now.`);

        let amount = earn.amount;
        if (amount === 'all') {
          const position = earn.action === 'withdraw' ? await getPosition(vault.address) : null;
          if (earn.action === 'deposit') throw new Error('Say how much to put in — "all" would leave nothing for fees.');
          if (!position || Number(position.balance) <= 0) throw new Error(`There is nothing in ${vault.name} to take out.`);
          amount = String(position.balance);
        }

        setMoneyStep(earn.action === 'withdraw' ? `Taking ${amount} USDC out of ${vault.name}…` : `Putting ${amount} USDC into ${vault.name}…`);
        setMoneyBusy(true);
        if (earn.action === 'withdraw') await withdrawFromVault(vault.address, amount);
        else await depositToVault(vault.address, amount);

        recordActivity(address, {
          kind: 'earn',
          status: 'success',
          title: earn.action === 'withdraw' ? `Withdrew ${amount} USDC from ${vault.name}` : `Deposited ${amount} USDC into ${vault.name}`,
          amount,
          token: 'USDC',
          counterparty: vault.address,
          detail: `${vault.name} · ${vault.protocol}`,
        });
        addMessage(
          agentMsg(
            earn.action === 'withdraw'
              ? `Took ${amount} USDC out of ${vault.name}. It is back in your wallet.`
              : `Put ${amount} USDC into ${vault.name}, earning ${(vault.apy * 100).toFixed(2)}% while it sits there.`,
            'success',
          ),
        );
        void queryClient.invalidateQueries();
      } catch (err) {
        console.error('[vlora] earn command failed', err);
        addMessage(agentMsg(describeWalletError(err), 'error'));
      } finally {
        setMoneyBusy(false);
        setMoneyStep('');
        thinkingRef.current = false;
        setIsThinking(false);
      }
      return true;
    }

    const cashOut = parseCashOut(text);
    const bill = cashOut ? null : parseBill(text);
    if (!cashOut && !bill) return false;

    addMessage(userMsg(text));
    if (!isConnected || !address) {
      addMessage(agentMsg('Connect your wallet or sign in first, then say that again.', 'info'));
      return true;
    }

    setPendingMoney(null);
    thinkingRef.current = true;
    setIsThinking(true);
    try {
      const plan: MoneyPlan = cashOut
        ? { kind: 'cashout', plan: await resolveCashOut(cashOut) }
        : { kind: 'bill', plan: await resolveBill(bill!) };
      setPendingMoney(plan);
      addMessage(
        agentMsg(
          plan.kind === 'cashout'
            ? `${plan.plan.accountName} at ${plan.plan.bankName} would receive ${Number(plan.plan.payout).toLocaleString()} ${plan.plan.currency}. Check it and confirm below.`
            : `${plan.plan.label} for ${plan.plan.recipient}. Check the number and confirm below.`,
          'info',
        ),
      );
    } catch (err) {
      console.error('[vlora] money intent failed', err);
      addMessage(agentMsg(err instanceof Error ? err.message : "I couldn't set that up.", 'error'));
    } finally {
      thinkingRef.current = false;
      setIsThinking(false);
    }
    return true;
  }

  async function runPendingMoney() {
    if (!pendingMoney || !address) return;
    setMoneyBusy(true);
    try {
      if (chainId !== ACTIVE_CHAIN_ID) {
        setMoneyStep(`Switching your wallet to ${ACTIVE_CHAIN.name}…`);
        await switchChainAsync({ chainId: ACTIVE_CHAIN_ID });
      }
      if (pendingMoney.kind === 'cashout') {
        const { order } = await runCashOut(address, pendingMoney.plan, setMoneyStep);
        addMessage(
          agentMsg(
            `Sent. ${pendingMoney.plan.bankName} should have it within a couple of minutes — reference ${order.id.slice(0, 8)}. "/history" has the receipt.`,
            'success',
          ),
        );
      } else {
        await runBillPayment(address, pendingMoney.plan, setMoneyStep);
        addMessage(agentMsg(`Paid. ${pendingMoney.plan.label} is on its way to ${pendingMoney.plan.recipient}. "/history" has the receipt.`, 'success'));
      }
      setPendingMoney(null);
      void queryClient.invalidateQueries();
    } catch (err) {
      console.error('[vlora] money run failed', err);
      addMessage(agentMsg(describeWalletError(err), 'error'));
    } finally {
      setMoneyBusy(false);
      setMoneyStep('');
    }
  }

  async function handleUserMessage(text: string) {
    if (thinkingRef.current) return;
    // Commands that open a tab handle their own navigation
    if (handleModeCommand(text)) return;
    if (agentMode && agentVault?.active) return handleAgentMessage(text);
    // A typed action does what the tab's buttons do, and the reply appears on
    // the tab it was typed on — every tab keeps its own thread
    if (await handleMoneyMessage(text)) return;
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
        const check = validateArcName(intent, await fetchArcNameFee());
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
                args: [address],
                chainId: ACTIVE_CHAIN_ID,
              }),
            ),
          );
          lines = tokens.map((t, i) => `${formatTokenAmount(Number(formatUnits(raw[i], t.decimals)), t.decimals)} ${t.symbol}`);
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

  async function handleConfirm({ quote, gasless }: { quote?: SwapQuote; gasless?: boolean } = {}) {
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
      if (gasless && check.token.symbol === 'USDC') {
        void executeGaslessSend(intent.recipient as `0x${string}`, check.amount.raw, intent.amount);
      } else {
        void executeSend(check.token, intent.recipient as `0x${string}`, check.amount.raw, intent.amount);
      }
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
      const check = validateArcName(pendingIntent, arcNameFee);
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
          <aside className="flex w-80 shrink-0 flex-col gap-4 overflow-y-auto pb-1 [&>*]:shrink-0">
            <BalanceCard arcName={myArcName} />

            {showClaimName && (
              <ClaimNameCard
                onClaim={(label, years) => setPendingIntent({ type: 'arcname', op: 'register', label, years })}
              />
            )}



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
            </div>
          )}

          <TabStrip tabs={TABS} active={tab} onSelect={setTab} />

          <div className={tab === 'chat' ? 'hidden' : 'min-h-0 flex-1 overflow-y-auto p-3 md:p-4'}>
              {!isConnected && tab !== 'next' ? (
                <p className="rounded-2xl bg-surface-2 px-3 py-2.5 text-xs text-muted">Connect your wallet or sign in to use this.</p>
              ) : (
                <>
                  {tab === 'bills' && <BillsPanel category={billsCategory} />}
                  {tab === 'cashout' && <OfframpPanel />}
                  {tab === 'earn' && <EarnPanel />}
                  {tab === 'savings' && <SavingsPanel />}
                  {tab === 'deposit' && <DepositPanel />}
                  {tab === 'activity' && <InsightsPanel />}
                  {tab === 'history' && <HistoryPanel />}
                  {tab === 'wallet' && wrongChain && (
                    <p className="rounded-2xl bg-surface-2 px-3 py-2.5 text-xs text-muted">
                      Switch your wallet to {ACTIVE_CHAIN.name} to manage the agent wallet.
                    </p>
                  )}
                  {tab === 'next' && <ComingSoon />}

                  {/* This tab's own thread: what was said here, answered here */}
                  {tabMessages.length > 0 && (
                    <div className="mt-4 space-y-4 border-t border-line/10 pt-4">
                      {tabMessages.map((msg) => (
                        <ChatMessage key={msg.id} msg={msg} />
                      ))}
                      <AnimatePresence>{isThinking && <TypingBubble key="typing-tab" />}</AnimatePresence>
                    </div>
                  )}
                  {/* Always mounted: this is what finds the vault behind the agent toggle */}
                  {!wrongChain && (
                    <div className={tab === 'wallet' ? undefined : 'hidden'}>
                      <AgentPanel onVaultChange={onAgentVaultChange} />
                    </div>
                  )}
                </>
              )}
            </div>

          <div className={tab === 'chat' ? 'flex items-center justify-between border-b border-line/10 px-5 py-3.5 md:px-6' : 'hidden'}>
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
          <div
            ref={listRef}
            className={tab === 'chat' ? 'min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-5 md:px-6' : 'hidden'}
          >
            {messages.map((msg) => (
              <ChatMessage key={msg.id} msg={msg} />
            ))}
            <AnimatePresence>{isThinking && <TypingBubble key="typing" />}</AnimatePresence>
          </div>

          {/* Composer: typing is how this app works, so it stays on every tab */}
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

      {/* Emptying a wallet gets its own confirmation, stricter than the rest */}
      <AnimatePresence>
        {pendingSweep && (
          <div className="fixed inset-x-0 bottom-0 z-40 mx-auto w-full max-w-2xl p-3 md:p-4">
            <SweepConfirm
              plan={pendingSweep}
              onConfirm={() => void runSweep()}
              onCancel={() => {
                setPendingSweep(null);
                addMessage(agentMsg('Cancelled — nothing was sent.', 'info'));
              }}
              busy={moneyBusy}
              step={moneyStep}
            />
          </div>
        )}
      </AnimatePresence>

      {/* Typed cash-outs and bills confirm here, like any other transaction */}
      <AnimatePresence>
        {pendingMoney && (
          <div className="fixed inset-x-0 bottom-0 z-40 mx-auto w-full max-w-2xl p-3 md:p-4">
            <MoneyConfirm
              pending={pendingMoney}
              onConfirm={() => void runPendingMoney()}
              onCancel={() => {
                setPendingMoney(null);
                addMessage(agentMsg('Cancelled — nothing was sent.', 'info'));
              }}
              busy={moneyBusy}
              step={moneyStep}
            />
          </div>
        )}
      </AnimatePresence>

      {/* Intent confirmation sheet */}
      <AnimatePresence>
        {pendingIntent && (
          <IntentPreview
            intent={pendingIntent}
            onConfirm={(opts) => void handleConfirm(opts)}
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

# Vlora

> Built with Arc Studio - money-powered apps in minutes

This is the **project memory** - what Arc Studio remembers about building this app. It helps future agents (or humans) understand and extend the project.

---

## What This App Does

Chat-style app: type a plain-English command ("send 5 USDC to 0x…", "check my balance"), review a confirmation sheet, then execute on Arc. Parsing is regex pattern matching (`src/utils/intentParser.ts`), not an LLM.

- Works: USDC send (`erc20Abi.transfer`), USDC balance check.
- Swaps: Synthra on testnet, LI.FI on mainnet (`src/lib/lifi.ts` verifies every returned transaction).
- Gasless USDC sends via Circle's Facilitator (`server/gasless.ts`, `src/lib/gasless.ts`), on only when `CIRCLE_API_KEY` is set.
- Every send is gated by `src/utils/validateSend.ts` (USDC only, valid address, amount > 0 and within 6 decimals, not above balance) in both the preview and at confirm time.
- Typed money commands: `src/utils/moneyIntent.ts` parses "cash out 20 USDC to gtbank 0123456789" and "buy 500 airtime for 0801…"; `src/lib/resolveMoneyIntent.ts` turns the words into a bank code or a product against the live APIs; `src/lib/runMoney.ts` runs it. The chat and the panels call the same runner — keep it that way.
- Cash out (`/cashout`): Paycrest sender API via `server/offramp.ts`, then an Arc→Base USDC bridge (`src/lib/bridge.ts`, App Kit + CCTP with `useForwarder`; `bridgeExact` adds the flat relayer fee on top because Arc rejects `feePayment: 'source'`) into the order's receive address. Paycrest does not settle on Arc yet; when it does, change `NETWORK` in `server/offramp.ts` and drop the bridge step.
- Earn (`/earn`): Arc lending vaults through App Kit (`src/lib/earn.ts`).
- Savings targets (`/save`): a name, an amount and an optional date over the same Earn vault (`src/lib/savings.ts`, `src/components/SavingsPanel.tsx`, and a chat path in `App.tsx`). The targets live in this browser, but the money is one shared vault position that Earn and the chat also withdraw from, so the panel reads `getPosition` and `reconcileGoals` scales the targets down proportionally to what the vault actually holds. Without that, a target keeps claiming USDC that has already left. Removing a target never moves money, and is always allowed.
- Bills (`/airtime`, `/data`, `/electricity`, `/tv`): Bitrefill invoices priced in USDC on Base (`server/bills.ts`), paid with the same Arc→Base bridge. An invoice's price is read with `interpretPrice` (Bitrefill quotes `usdc_base` in the smallest unit) and then bounded by `plausiblePrice` against a rate that isn't Bitrefill's — the ceiling alone can't catch a unit that moved in the small direction. `GET /api/bills/preflight` runs the whole chain except the transfer. Bitrefill's `phone_number` field carries the meter or account number for billers that need one.
- Agent bills (`pay_bill` in `server/agent.ts`): the agent buys airtime, data, electricity or TV from the vault. Money goes vault → agent key (`agentTransfer`, so the contract's caps apply) → `bridgeFromAgent` (`server/bridge.ts`, App Kit from a private key) → the invoice's address on Base. The phone or meter number must be one the owner typed themselves, in this message or an earlier turn of their own (`RecipientGuard.typedNumber`); assistant turns and tool results are never passed in — a bill's recipient IS the number, so this is the injection boundary. A failed bridge returns the USDC to the vault; fees come from the agent's own balance; Bitrefill refunds go to the vault owner. The tool only exists when `BITREFILL_API_KEY` is set and the network is Arc mainnet.
- History backfill: `src/lib/backfillHistory.ts` reads past Transfer logs. Arc's public RPCs cap `eth_getLogs` at **5,000 blocks** (the one node allowing 10,000 prunes past ~2 days) and rate-limit past ~3 calls/second, batched or not; blocks are ~0.5s, so a day is ~170k blocks = 34 chunks × 2 calls. Hence one press scans the whole history in chunks, from a binary-searched first-activity block, flushing entries as it goes. A log filter takes several token addresses at once, so all three tokens cost one call per direction.
- History (`/history`): every action is recorded in `src/lib/activity.ts` (this browser only, per wallet and network) and any entry renders a PNG receipt in `src/lib/receipt.ts`. New money-moving features should call `recordActivity` — in `App.tsx` that happens for free by passing a `log` to `confirmTx`.
- Testnet/mainnet: flip `IS_MAINNET` in `src/chain-env.ts`; nothing else should hardcode a chain.

See `PROJECT_SPEC.md` for scope and the Arc Microgrants submission plan.

## Tech Stack

- Frontend: React 18, Vite, TypeScript, Tailwind CSS
- Web3: wagmi v2, viem v2, ConnectKit
- Contracts: Solidity 0.8.28 + Foundry. Sources in `contracts/`, unit tests in `contracts/test/*.t.sol`. Build with `bun run contracts:build` (`forge build`), test with `bun run contracts:test` (`forge test`).
- Wallet: injected (MetaMask, etc.)
- Chain: Arc Testnet (5042002) or Arc mainnet (5042), selected in `src/chain-env.ts`, built from `src/onchain-facts.ts`
- Token: USDC (6 decimals) (Address: 0x3600000000000000000000000000000000000000 on both Arc networks)
- Toasts: Sonner

## Key Files

- `src/App.tsx` - Main application logic
- `src/components/` - UI components
- `src/config.ts` - wagmi config (chains, connectors, transports)

## To Run

```bash
bun install
bun run dev
```

## Batch payments

- Contract: `contracts/BatchSender.sol` (no owner, not upgradeable, never holds funds; pulls each amount from the sender to the recipient via `transferFrom`; atomic). Tests: `forge test --match-contract BatchSenderTest`.
- Deploy (you sign with your own keystore — never commit a private key):
  ```bash
  cast wallet import deployer --interactive          # once
  forge script contracts/script/DeployBatchSender.s.sol --rpc-url arc_testnet --account deployer --broadcast
  ```
  Paste the printed address into `src/batch-config.ts` for that chain id. Until then, batch payments show as unavailable.
- Flow in the app: parse (`parseBatch`) → validate (`validateBatch`) → approve exact total if allowance is short → `batchTransfer`.

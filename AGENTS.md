# Vlora

> Built with Arc Studio - money-powered apps in minutes

This is the **project memory** - what Arc Studio remembers about building this app. It helps future agents (or humans) understand and extend the project.

---

## What This App Does

Chat-style app: type a plain-English command ("send 5 USDC to 0x…", "check my balance"), review a confirmation sheet, then execute on Arc. Parsing is regex pattern matching (`src/utils/intentParser.ts`), not an LLM.

- Works: USDC send (`erc20Abi.transfer`), USDC balance check.
- Swaps: Synthra on testnet, LI.FI on mainnet (`src/lib/lifi.ts` verifies every returned transaction). Add-liquidity is preview only.
- Gasless USDC sends via Circle's Facilitator (`server/gasless.ts`, `src/lib/gasless.ts`), on only when `CIRCLE_API_KEY` is set.
- Every send is gated by `src/utils/validateSend.ts` (USDC only, valid address, amount > 0 and within 6 decimals, not above balance) in both the preview and at confirm time.
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

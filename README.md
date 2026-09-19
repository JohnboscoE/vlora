<p align="center">
  <img src="public/vlora-logo.svg" alt="Vlora" width="220" />
</p>

<p align="center"><strong>State the payment. Vlora settles it.</strong><br/>
Plain-language payments on <a href="https://arc.io">Arc</a>, the stablecoin chain where USDC is the gas.</p>

---

Vlora is a chat-style web app: you type what you want — `send 10 USDC to james.arc`, `swap 20 USDC for EURC`, `pay alice 5 and bob 7` — and Vlora turns it into a validated transaction on Arc. Every action is checked, simulated on-chain and shown for confirmation **before** your wallet signs anything.

> **Honesty note.** In the main app, commands are understood with deterministic pattern matching (`src/utils/intentParser.ts`), not an LLM. The optional **agent wallet** (testnet beta) is the only part that uses an AI model (Claude), and it runs server-side under hard on-chain limits.

## Status

Built and tested on **Arc Testnet**. Mainnet is configured but not yet live (see [Going to mainnet](#going-to-mainnet)).

| Feature | Arc Testnet | Arc mainnet |
|---|---|---|
| Send USDC, EURC, cirBTC | ✅ | USDC only (EURC/cirBTC addresses not published yet) |
| Balances | ✅ | ✅ |
| Contacts, saved batches, CSV import | ✅ | ✅ |
| Payment request links | ✅ | ✅ |
| Pay and register `.arc` names ([ArcNames](https://github.com/JohnboscoE/ArcNames)) | ✅ | after ArcNames mainnet deploy |
| Swaps USDC ⇄ EURC ⇄ cirBTC via Synthra | ✅ | off until Synthra publishes mainnet pools |
| Batch payments (many recipients, one tx) | after `BatchSender` deploy | after `BatchSender` deploy |
| Agent wallet (AI sub-account, no per-tx signing) | beta — factory `0x40D5…a2a9` | v2 |

## What it does

- **Plain-language commands** — send, swap, batch, check balances, request money, manage names. Type `/` for a quick-action menu.
- **Check before you sign** — each transaction is validated locally, then dry-run against the live chain (`eth_call`) with the real fee estimate. Anything that would revert, or wouldn't leave enough USDC for gas, is blocked with a reason. If the chain can't be reached, signing is blocked (fail-closed).
- **Pay by name** — `send 10 USDC to james.arc`. Names are resolved on-chain, shown next to the address, and re-resolved right before signing; if the owner changed, the send is stopped.
- **Swaps** — best quote across Synthra fee tiers, refreshed every 20s, with a 0.5% slippage guard and a re-quote just before signing.
- **Batch payments** — `send 10 USDC to 0xA, 25 to 0xB` or a CSV. One all-or-nothing transaction through `BatchSender`; rows are editable in the preview.
- **Contacts and templates** — `save 0x… as alice`, then `pay alice 5`. Stored in your browser only.
- **Payment links** — `request 25 USDC` gives a link that prefills a send for the payer, who still reviews and signs.
- **Live progress** — every transaction shows sign → approve (if needed) → confirm, and always ends with success, a revert reason, "never broadcast", or an explorer link.
- **Agent wallet (testnet beta)** — see below.

## Tech

React 18 · Vite · TypeScript · Tailwind · wagmi v2 / viem · ConnectKit · Foundry (Solidity 0.8.28) · Anthropic SDK (agent server only). Light and dark themes.

```
src/
  App.tsx                chat, command routing, transaction flows
  utils/intentParser.ts  command parsing (no LLM)
  utils/validateSend.ts  pre-sign validation (send, batch, swap, names)
  hooks/useTxPreview.ts  on-chain dry run + fee estimate
  lib/watchTx.ts         receipt watcher (success / reverted / dropped / timeout)
  lib/swapQuote.ts       Synthra QuoterV2 best-tier quotes
  chain-env.ts           testnet ⇄ mainnet switch (IS_MAINNET)
  tokens.ts · swap-config.ts · batch-config.ts · arcnames-config.ts · agent-config.ts
contracts/
  BatchSender.sol        multi-recipient ERC-20 payouts (no owner, never holds funds)
  AgentVault.sol         agent wallet + factory
  test/                  Foundry tests
server/                  agent API (testnet beta)
```

## Run it locally

Requirements: Node ≥ 22.6, a browser wallet (e.g. MetaMask) on Arc Testnet, and test USDC from [faucet.circle.com](https://faucet.circle.com). Foundry is needed only for contracts.

```bash
npm install --legacy-peer-deps   # or: bun install
npm run dev                      # http://localhost:5173
```

Checks:

```bash
npm run typecheck
forge test                       # BatchSender + AgentVault suites
```

## Contracts

Deploy with your own Foundry keystore (never paste a private key into a file or command):

```bash
cast wallet import deployer --interactive   # once

forge script contracts/script/DeployBatchSender.s.sol       --rpc-url arc_testnet --account deployer --broadcast
forge script contracts/script/DeployAgentVaultFactory.s.sol --rpc-url arc_testnet --account deployer --broadcast
```

Run these from the project root, then paste the printed addresses into `src/batch-config.ts` and `src/agent-config.ts`. Features whose address is missing stay switched off in the UI.

| Contract | What it guarantees |
|---|---|
| `BatchSender` | No owner, not upgradeable, never holds funds; moves each amount straight from sender to recipient; atomic; ≤ 200 recipients. |
| `AgentVault` | Owner-funded sub-account. The agent can only send or swap allowed tokens, within per-tx and per-day caps, before expiry, while not paused; swap output always returns to the vault; owner can withdraw, pause or revoke at any time. |

## Agent wallet (testnet beta)

An optional sub-account the AI can spend from **without asking you to sign each time** — inside limits enforced by the `AgentVault` contract. You create it, fund only what you're comfortable with, and can pause, revoke or withdraw at any time.

How a request is handled (`server/agent.ts`):

1. You sign in once with your wallet (a free message signature, not a transaction). The server only accepts instructions for vaults you own.
2. Claude plans the request using four tools: vault status, `.arc` lookup, send, swap.
3. Before anything executes, the server re-checks deterministically: recipients must be an address or `.arc` name **you typed** (so text the AI reads can't redirect funds), amounts must fit the per-tx and daily limits, and the transaction must pass a dry run. At most 5 actions per message.
4. The vault contract enforces the limits again on-chain. Worst case — a compromised agent key or a manipulated model — is one day's allowance per token.

Setup:

```bash
cast wallet new                      # the agent's own key (not your wallet); fund it with a little test USDC for gas
cp server/.env.example server/.env   # add ANTHROPIC_API_KEY and AGENT_PRIVATE_KEY — this file is git-ignored
npm run agent                        # http://localhost:8787, proxied by Vite at /api/agent
```

Then in the app: create an agent wallet with limits → add funds → flip the **Agent** switch in the chat header.

The agent uses Claude Opus 5 at medium effort, with Anthropic's server-side refusal fallback enabled; cost is roughly $11–18 per 1,000 messages.

## Going to mainnet

1. Deploy `BatchSender` (and the fixed ArcNames) to Arc mainnet with `--rpc-url arc`, and add the addresses to `src/batch-config.ts` / `src/arcnames-config.ts`.
2. Add mainnet token addresses to `src/tokens.ts` and a swap venue to `src/swap-config.ts` once pools exist.
3. Set `IS_MAINNET = true` in `src/chain-env.ts` — every chain id, RPC, explorer and USDC address derives from it.
4. Do a small real send and balance check before announcing.

The agent wallet stays testnet-only until v2.

## Security notes

- Nothing is signed without a preview; the preview is blocked if validation, the dry run, or the chain read fails.
- Keys and API keys live only in local, git-ignored `.env` files. Never commit them.
- Token addresses are pinned in `src/tokens.ts`; same-named copies exist on testnet, so tokens are added only after verifying real liquidity.
- Swaps pass a minimum-output guard; batch and name-fee approvals are for the exact amount only.

## Credits

Scaffolded with Arc Studio. Uses Synthra pools for swaps and [ArcNames](https://github.com/JohnboscoE/ArcNames) for `.arc` names. Landing shader adapted from [Paper Shaders](https://shaders.paper.design) (Apache-2.0) via the 21st.dev Shader Builder.

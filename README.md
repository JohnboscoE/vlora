<p align="center">
  <img src="public/vlora-logo.svg" alt="Vlora" width="220" />
</p>

<p align="center"><strong>An AI agent that can spend your USDC — but provably can't drain it.</strong><br/>
Plain-language payments on <a href="https://arc.io">Arc</a>, the stablecoin chain where USDC is the gas.</p>

<p align="center"><a href="https://vlora-two.vercel.app"><strong>Live → vlora-two.vercel.app</strong></a> (Arc mainnet)</p>

---

Vlora lets you tell an AI agent *"pay james.arc 3 USDC"* and have it happen without signing every transaction — from a sub-account whose limits are enforced by a smart contract, not by the AI's good behaviour. Everything else in the app is the same idea without the AI: you type what you want (`send 10 USDC to james.arc`, `pay alice 5 and bob 7`), and nothing is signed until it has been validated, simulated on-chain and shown to you.

## Why the agent can't drain you

The model is treated as untrusted. Four independent layers sit between what it wants and what moves:

1. **Recipients come from you, not the model.** The server only pays an address or `.arc` name that appears in *your* message. Text the model reads — a web page, a name record, a crafted reply — can't redirect funds (the main prompt-injection risk for payment agents).
2. **Deterministic checks on the server.** Amount, per-transaction limit, today's remaining allowance, and a dry run of the exact call, before anything is sent. At most 5 actions per message.
3. **On-chain caps in `AgentVault`.** Per-token per-transaction and per-day limits, expiry, pause and revoke — enforced by the contract even if the server and its key are fully compromised.
4. **You stay the owner.** Withdraw, pause or revoke at any time from your own wallet; the agent key can never withdraw.

**Worst case:** a compromised agent key or a manipulated model can move at most one day's allowance per token, to anywhere. On mainnet the defaults are 2 USDC per transaction / 5 per day, and the agent refuses any vault above a 50 USDC/day beta cap. See [Agent wallet](#agent-wallet-beta) for details.

> **Honesty notes.** Only the agent uses an AI model (Claude Haiku 4.5, server-side). The main chat understands commands with deterministic pattern matching (`src/utils/intentParser.ts`), not an LLM. `AgentVault` is tested (Foundry) but **not audited**, and on the hosted site the agent key is operated by the site's server — which is exactly why the on-chain caps exist. Fund an agent wallet only with what you'd be fine losing.

## Status

Live on **Arc mainnet** at the link above; the same code runs on Arc Testnet (see [Mainnet](#mainnet)).

| Feature | Arc Testnet | Arc mainnet |
|---|---|---|
| Send USDC, EURC, cirBTC | ✅ | ✅ |
| Gasless USDC sends (Circle pays the fee) | ✅ with `CIRCLE_API_KEY` | ✅ with `CIRCLE_API_KEY` |
| Balances | ✅ | ✅ |
| Contacts, saved batches, CSV import | ✅ | ✅ |
| Payment request links | ✅ | ✅ |
| Pay and register `.arc` names ([ArcNames](https://github.com/JohnboscoE/ArcNames)) — 0.01 USDC/year on mainnet | ✅ | ✅ |
| Swaps USDC ⇄ EURC ⇄ cirBTC | ✅ via Synthra | ✅ via LI.FI (the Arc Portal's swap aggregator) |
| Batch payments (many recipients, one tx) | ✅ | ✅ |
| Voice input (speech to text) | ✅ | ✅ |
| Agent wallet (AI sub-account, no per-tx signing) | ✅ beta | ✅ beta — USDC sends only, ≤ 50 USDC/day cap, unaudited |

## What it does

- **Agent wallet (beta)** — type `/agent` and the AI acts from a sub-account you fund, within limits the contract enforces; `/exit` returns to normal mode. See [Why the agent can't drain you](#why-the-agent-cant-drain-you).
- **Check before you sign** — each transaction is validated locally, then dry-run against the live chain (`eth_call`) with the real fee estimate. Anything that would revert, or wouldn't leave enough USDC for gas, is blocked with a reason. If the chain can't be reached, signing is blocked (fail-closed).
- **Pay by name** — `send 10 USDC to james.arc`. Names are resolved on-chain, shown next to the address, and re-resolved right before signing; if the owner changed, the send is stopped.
- **Swaps** — testnet: best quote across Synthra fee tiers; mainnet: LI.FI, the aggregator behind the Arc Portal's swap page. Quotes refresh every 20s, with a 0.5% slippage guard and a re-quote just before signing. LI.FI returns a ready-made transaction, so Vlora decodes and checks it (pinned router, receiver = you, exact input, output token, on-chain minimum) before it can be signed.
- **Gasless USDC sends** — when the server has a Circle API key, USDC sends offer a *Gasless* toggle: you sign an EIP-3009 authorization (no transaction), and [Circle's Facilitator Service](https://developers.circle.com/facilitator-service) submits it and pays the network fee. See [Gasless sends](#gasless-sends-circle-facilitator).
- **Batch payments** — `send 10 USDC to 0xA, 25 to 0xB` or a CSV. One all-or-nothing transaction through `BatchSender`; rows are editable in the preview.
- **Contacts and templates** — `save 0x… as alice`, then `pay alice 5`. Stored in your browser only.
- **Payment links** — `request 25 USDC` gives a link that prefills a send for the payer, who still reviews and signs.
- **Live progress** — every transaction shows sign → approve (if needed) → confirm, and always ends with success, a revert reason, "never broadcast", or an explorer link.
- **Also** — plain-language commands with a `/` quick-action menu, voice input (browser speech-to-text; nothing runs until you press Enter), and light/dark themes.

## Tech

React 18 · Vite · TypeScript · Tailwind · wagmi v2 / viem · ConnectKit · Foundry (Solidity 0.8.28) · Anthropic SDK (agent server only). Light and dark themes.

```
src/
  App.tsx                chat, command routing, transaction flows
  utils/intentParser.ts  command parsing (no LLM)
  utils/validateSend.ts  pre-sign validation (send, batch, swap, names)
  hooks/useTxPreview.ts  on-chain dry run + fee estimate
  hooks/useSpeechToText.ts · lib/speechNormalize.ts   voice input
  lib/watchTx.ts         receipt watcher (success / reverted / dropped / timeout)
  lib/swapQuote.ts       swap quotes: Synthra QuoterV2 (testnet), LI.FI (mainnet)
  lib/lifi.ts            LI.FI quote fetch + calldata verification
  lib/gasless.ts         EIP-3009 signing + Circle settlement client
  chain-env.ts           testnet ⇄ mainnet switch (IS_MAINNET)
  tokens.ts · swap-config.ts · batch-config.ts · arcnames-config.ts · agent-config.ts
contracts/
  BatchSender.sol        multi-recipient ERC-20 payouts (no owner, never holds funds)
  AgentVault.sol         agent wallet + factory
  test/                  Foundry tests
server/                  agent + gasless API source — handlers shared by local + Vercel
api/agent/ · api/gasless/   Vercel Functions
api/_lib/                generated bundle of server/*.ts used by the functions
scripts/build-agent-api.mjs   builds that bundle (runs in `npm run build`)
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

## Deploy on Vercel

Import the repo in Vercel with these settings (Vite is detected automatically):

| Setting | Value |
|---|---|
| Root Directory | `./` |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Install Command | default — the committed `.npmrc` handles a known peer-dependency conflict |

The web app needs no environment variables. Every push to `main` redeploys. For the agent wallet, add its three environment variables (see [Agent wallet](#agent-wallet-beta)) and redeploy — Vercel only applies new variables to new deployments. If *Deployment Protection* is on, only people logged in to your Vercel team can open the site.

## Contracts

Deploy with your own Foundry keystore (never paste a private key into a file or command):

```bash
cast wallet import deployer --interactive   # once

forge script contracts/script/DeployBatchSender.s.sol       --rpc-url arc_testnet --account deployer --broadcast
forge script contracts/script/DeployAgentVaultFactory.s.sol --rpc-url arc_testnet --account deployer --broadcast
```

Run these from the project root, then paste the printed addresses into `src/batch-config.ts` and `src/agent-config.ts`. Features whose address is missing stay switched off in the UI. The deployer wallet needs a little test USDC for gas (about 0.11 USDC for the factory).

Deployed contracts (the same deployer made its first transactions on each chain, so addresses repeat across networks with **different** contracts — always check the chain):

| Contract | Arc mainnet (5042) | Arc Testnet (5042002) |
|---|---|---|
| `BatchSender` | `0x40D5AbC0EcDB140ba4DC5fF3B725c5740a0Ea2a9` | `0xF2DCe7fe2864FDD899b12185c610C11d425200d9` |
| `ArcNames` (fixed, 0.01 USDC/yr) | `0xF2DCe7fe2864FDD899b12185c610C11d425200d9` | `0x578dbd5734f13bca66a1355cca296c07823892a2` (original, 5 USDC/yr) |
| `AgentVaultFactory` | `0x170FD54D7A9D0d35C0237A5B45741dF874ba6C69` | `0x40D5AbC0EcDB140ba4DC5fF3B725c5740a0Ea2a9` |

| Contract | What it guarantees |
|---|---|
| `BatchSender` | No owner, not upgradeable, never holds funds; moves each amount straight from sender to recipient; atomic; ≤ 200 recipients. |
| `AgentVault` | Owner-funded sub-account. The agent can only send or swap allowed tokens, within per-tx and per-day caps, before expiry, while not paused; swap output always returns to the vault; owner can withdraw, pause or revoke at any time. |

## Agent wallet (beta)

An optional sub-account the AI can spend from **without asking you to sign each time** — inside limits enforced by the `AgentVault` contract. You create it, fund only what you're comfortable with, and can pause, revoke or withdraw at any time.

How a request is handled (`server/agent.ts`):

1. You sign in once with your wallet (a free message signature, not a transaction). The server only accepts instructions for vaults you own.
2. Claude plans the request using four tools: vault status, `.arc` lookup, send, swap.
3. Before anything executes, the server re-checks deterministically: recipients must be an address or `.arc` name **you typed** (so text the AI reads can't redirect funds), amounts must fit the per-tx and daily limits, and the transaction must pass a dry run. At most 5 actions per message.
4. The vault contract enforces the limits again on-chain. Worst case — a compromised agent key or a manipulated model — is one day's allowance per token.

The agent needs three secrets:

| Variable | What it is |
|---|---|
| `ANTHROPIC_API_KEY` | Your Anthropic API key |
| `AGENT_PRIVATE_KEY` | The agent's own key — `cast wallet new`. **Never your personal wallet's key**: the vault limits only restrain the agent, so if the agent key is also the owner, nothing is protected. Fund its address with a little USDC for gas (test USDC on testnet, real USDC on mainnet — about 0.5 USDC lasts a long time). |
| `SESSION_SECRET` | 32+ random characters that sign sign-in sessions: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |

**Locally:** put them in `server/.env` (copy `server/.env.example`; the file is git-ignored), then

```bash
npm run agent    # http://localhost:8787 — Vite proxies /api/agent here
npm run dev
```

**On Vercel:** add the same three under *Project → Settings → Environment Variables* (use the **same** `AGENT_PRIVATE_KEY` as locally, so your vault trusts both) and redeploy. The agent runs as Vercel Functions in `api/agent/` (the chat function may run up to 120 s). Those functions call `api/_lib/agent-handler.mjs`, a bundle of `server/*.ts` that `npm run build` regenerates — run `npm run build:agent-api` after editing `server/`.

Sign-in sessions are stateless HMAC-signed tokens, so they work across serverless instances. Per-wallet rate limits are best-effort on Vercel (per instance); the vault's on-chain limits are the real safety net.

Then in the app:

1. **Agent wallet** panel → set limits (defaults: 10 per transaction / 25 per day on testnet; 2 / 5 on mainnet, where the daily limit is capped at 50) → **Create agent wallet** → **Add** a few USDC.
2. Type **`/agent`** (or flip the **Agent** switch in the chat header). The first agent message asks your wallet for a free sign-in signature.
3. Try `what's in my agent wallet?`, `send 1 USDC to 0x…`, `swap 2 USDC for EURC` — they execute without wallet pop-ups, within your limits.
4. Type **`/exit`** to return to normal mode, where every transaction asks your wallet to sign.

In the panel you can **Pause/Resume**, **Extend 7d** (also re-points the vault at the server's current agent key), **Withdraw all**, and **Revoke** — undone with **Re-enable**.

The agent uses Claude Haiku 4.5, the cheapest current model — roughly $3 per 1,000 messages. It only maps requests onto four tools; the safety-critical checks are deterministic code and on-chain limits.

## Gasless sends (Circle Facilitator)

USDC sends can skip the network fee: the wallet signs a `TransferWithAuthorization` (EIP-3009, valid for 10 minutes, random nonce, exact amount and recipient), `server/gasless.ts` verifies the signature and forwards it to Circle's Facilitator Service (`POST /v1/facilitator/x402/settle`), and Circle submits the transfer and pays the gas.

| Variable | What it is |
|---|---|
| `CIRCLE_API_KEY` | A Circle API key: `TEST_API_KEY:…` for Arc Testnet, `LIVE_API_KEY:…` for mainnet. Unset → the toggle is hidden and sends work as before. |
| `CIRCLE_FACILITATOR_URL` | Optional. Defaults to `https://api.circle.com`. |

Set it in `server/.env` (local, with `npm run agent`) or in Vercel's environment variables, then redeploy. `/api/gasless/info` says whether it's on (and, if not, which variable is wrong — never the key itself). If Circle rejects a send, nothing moves and the app says so; if the outcome is unclear, it watches the chain and never sends a second copy automatically.

## Mainnet

The network is chosen at build time by `VITE_ARC_NETWORK`: set it to `mainnet` in Vercel's environment variables for the production site; leave it unset locally to develop on Arc Testnet. Every chain id, RPC (with fallbacks), explorer, contract address and landing-page feature list follows from it.

Live on mainnet: USDC, EURC and cirBTC sends, balances, contacts, payment links, voice input, batch payments, `.arc` names and swaps through LI.FI (`/lifi/*` is proxied to `li.quest/v1` like the RPC). The agent wallet on mainnet holds and sends USDC only (no swaps yet), with the 50 USDC/day beta cap.

Contract addresses repeat across the two networks with different contracts behind them, so no address is shared between chains in code: every config (`src/batch-config.ts`, `src/arcnames-config.ts`, `src/agent-config.ts`, `src/swap-config.ts`, `src/tokens.ts`, `server/chain.ts`) is a map keyed by chain id, and the one switch is `IS_MAINNET` in `src/chain-env.ts` (server: `VITE_ARC_NETWORK`). Wallets are also asked to be on that chain before anything is signed. The agent server follows the same `VITE_ARC_NETWORK` variable, so it always runs on the network the site shows.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Balance shows "Couldn't reach Arc", or `ERR_BLOCKED_BY_CLIENT` in the console | A browser ad/privacy blocker is blocking the Arc RPC. Allow `*.arc.io` and `*.arc.network` for the site. The app falls back to `rpc.testnet.arc.network`, and blocks signing (fail-closed) if it can't read the chain. |
| Agent panel: "The agent server isn't reachable" | Locally: run `npm run agent`. On Vercel: open `/api/agent/info` — it names the missing or malformed environment variable. |
| Agent panel: "trusts a different agent key" | The server's `AGENT_PRIVATE_KEY` changed. Click **Extend 7d** so the vault trusts the new key. |
| Agent reply: "The agent hit an error (…)" | The text in brackets says why — e.g. an invalid `ANTHROPIC_API_KEY` (401) or no API credit (429). |
| Vercel build fails with "Cannot mix BigInt and other types" | Vercel's file tracer (`@vercel/nft`) mis-evaluates inline BigInt maths in `server/`. Keep such maths inside small functions (see `applySlippage` in `server/agent.ts`). |
| A send fails with "exceeds balance" | On Arc, gas is paid from the same USDC; leave a little for fees. The preview now blocks sends that don't. |

## Security notes

- Nothing is signed without a preview; the preview is blocked if validation, the dry run, or the chain read fails.
- `AgentVault` is unaudited. On mainnet, the panel won't create a vault above 50 USDC/day and the agent server refuses to act for one.
- Keys and API keys live only in git-ignored `.env` files or Vercel environment variables. Never commit them, and never use a personal wallet's key as the agent key.
- Voice input uses the browser's speech recognition; Chrome and Edge send audio to their servers for transcription. Nothing is executed until you press Enter.
- Token addresses are pinned in `src/tokens.ts`; same-named copies exist on testnet, so tokens are added only after verifying real liquidity.
- Swaps pass a minimum-output guard; swap, batch and name-fee approvals are for the exact amount only.
- LI.FI transactions are only signed after decoding: they must target the pinned LI.FI router, pay out to your address, spend exactly your input, and enforce at least the minimum you reviewed.
- Gasless authorizations expire after 10 minutes and are single-use (EIP-3009 nonce); the server verifies each signature before forwarding it and holds no keys.

## Credits

Scaffolded with Arc Studio. Uses Synthra pools (testnet) and LI.FI (mainnet) for swaps, Circle's Facilitator Service for gasless sends, and [ArcNames](https://github.com/JohnboscoE/ArcNames) for `.arc` names. Landing shader adapted from [Paper Shaders](https://shaders.paper.design) (Apache-2.0) via the 21st.dev Shader Builder.

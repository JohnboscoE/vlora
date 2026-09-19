<p align="center">
  <img src="public/vlora-logo.svg" alt="Vlora" width="220" />
</p>

<p align="center"><strong>State the payment. Vlora settles it.</strong><br/>
Plain-language payments on <a href="https://arc.io">Arc</a>, the stablecoin chain where USDC is the gas.</p>

<p align="center"><a href="https://vlora-two.vercel.app"><strong>Live demo → vlora-two.vercel.app</strong></a> (Arc Testnet)</p>

---

Vlora is a chat-style web app: you type (or say) what you want — `send 10 USDC to james.arc`, `swap 20 USDC for EURC`, `pay alice 5 and bob 7` — and Vlora turns it into a validated transaction on Arc. Every action is checked, simulated on-chain and shown for confirmation **before** your wallet signs anything.

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
| Batch payments (many recipients, one tx) | ✅ | after `BatchSender` mainnet deploy |
| Voice input (speech to text) | ✅ | ✅ |
| Agent wallet (AI sub-account, no per-tx signing) | ✅ beta — local and on Vercel | v2 |

## What it does

- **Plain-language commands** — send, swap, batch, check balances, request money, manage names. Type `/` for a quick-action menu.
- **Voice input** — tap the mic and say *"send 5 USDC to james dot arc"*. Speech becomes text in the input (browser Web Speech API: Chrome, Edge, Safari); nothing is sent until you review it and press Enter.
- **Check before you sign** — each transaction is validated locally, then dry-run against the live chain (`eth_call`) with the real fee estimate. Anything that would revert, or wouldn't leave enough USDC for gas, is blocked with a reason. If the chain can't be reached, signing is blocked (fail-closed).
- **Pay by name** — `send 10 USDC to james.arc`. Names are resolved on-chain, shown next to the address, and re-resolved right before signing; if the owner changed, the send is stopped.
- **Swaps** — best quote across Synthra fee tiers, refreshed every 20s, with a 0.5% slippage guard and a re-quote just before signing.
- **Batch payments** — `send 10 USDC to 0xA, 25 to 0xB` or a CSV. One all-or-nothing transaction through `BatchSender`; rows are editable in the preview.
- **Contacts and templates** — `save 0x… as alice`, then `pay alice 5`. Stored in your browser only.
- **Payment links** — `request 25 USDC` gives a link that prefills a send for the payer, who still reviews and signs.
- **Live progress** — every transaction shows sign → approve (if needed) → confirm, and always ends with success, a revert reason, "never broadcast", or an explorer link.
- **Agent wallet (testnet beta)** — type `/agent` and the AI acts from a sub-account you fund, within limits you set; `/exit` returns to normal mode. See [below](#agent-wallet-testnet-beta).

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
  lib/swapQuote.ts       Synthra QuoterV2 best-tier quotes
  chain-env.ts           testnet ⇄ mainnet switch (IS_MAINNET)
  tokens.ts · swap-config.ts · batch-config.ts · arcnames-config.ts · agent-config.ts
contracts/
  BatchSender.sol        multi-recipient ERC-20 payouts (no owner, never holds funds)
  AgentVault.sol         agent wallet + factory
  test/                  Foundry tests
server/                  agent API source (testnet beta) — handler shared by local + Vercel
api/agent/               Vercel Functions (info, nonce, login, chat)
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

The web app needs no environment variables. Every push to `main` redeploys. For the agent wallet, add its three environment variables (see [Agent wallet](#agent-wallet-testnet-beta)) and redeploy — Vercel only applies new variables to new deployments. If *Deployment Protection* is on, only people logged in to your Vercel team can open the site.

## Contracts

Deploy with your own Foundry keystore (never paste a private key into a file or command):

```bash
cast wallet import deployer --interactive   # once

forge script contracts/script/DeployBatchSender.s.sol       --rpc-url arc_testnet --account deployer --broadcast
forge script contracts/script/DeployAgentVaultFactory.s.sol --rpc-url arc_testnet --account deployer --broadcast
```

Run these from the project root, then paste the printed addresses into `src/batch-config.ts` and `src/agent-config.ts`. Features whose address is missing stay switched off in the UI. The deployer wallet needs a little test USDC for gas (about 0.11 USDC for the factory).

Deployed on Arc Testnet:

| Contract | Address |
|---|---|
| `AgentVaultFactory` | `0x40D5AbC0EcDB140ba4DC5fF3B725c5740a0Ea2a9` |
| `BatchSender` | `0xF2DCe7fe2864FDD899b12185c610C11d425200d9` |

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

The agent needs three secrets:

| Variable | What it is |
|---|---|
| `ANTHROPIC_API_KEY` | Your Anthropic API key |
| `AGENT_PRIVATE_KEY` | The agent's own key — `cast wallet new`. **Never your personal wallet's key**: the vault limits only restrain the agent, so if the agent key is also the owner, nothing is protected. Fund its address with a little test USDC for gas. |
| `SESSION_SECRET` | 32+ random characters that sign sign-in sessions: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |

**Locally:** put them in `server/.env` (copy `server/.env.example`; the file is git-ignored), then

```bash
npm run agent    # http://localhost:8787 — Vite proxies /api/agent here
npm run dev
```

**On Vercel:** add the same three under *Project → Settings → Environment Variables* (use the **same** `AGENT_PRIVATE_KEY` as locally, so your vault trusts both) and redeploy. The agent runs as Vercel Functions in `api/agent/` (the chat function may run up to 120 s). Those functions call `api/_lib/agent-handler.mjs`, a bundle of `server/*.ts` that `npm run build` regenerates — run `npm run build:agent-api` after editing `server/`.

Sign-in sessions are stateless HMAC-signed tokens, so they work across serverless instances. Per-wallet rate limits are best-effort on Vercel (per instance); the vault's on-chain limits are the real safety net.

Then in the app:

1. **Agent wallet** panel → set limits (default 10 per transaction, 25 per day) → **Create agent wallet** → **Add** a few USDC.
2. Type **`/agent`** (or flip the **Agent** switch in the chat header). The first agent message asks your wallet for a free sign-in signature.
3. Try `what's in my agent wallet?`, `send 1 USDC to 0x…`, `swap 2 USDC for EURC` — they execute without wallet pop-ups, within your limits.
4. Type **`/exit`** to return to normal mode, where every transaction asks your wallet to sign.

In the panel you can **Pause/Resume**, **Extend 7d** (also re-points the vault at the server's current agent key), **Withdraw all**, and **Revoke** — undone with **Re-enable**.

The agent uses Claude Haiku 4.5, the cheapest current model — roughly $3 per 1,000 messages. It only maps requests onto four tools; the safety-critical checks are deterministic code and on-chain limits.

## Going to mainnet

1. Deploy `BatchSender` (and the fixed ArcNames) to Arc mainnet with `--rpc-url arc`, and add the addresses to `src/batch-config.ts` / `src/arcnames-config.ts`.
2. Add mainnet token addresses to `src/tokens.ts` and a swap venue to `src/swap-config.ts` once pools exist.
3. Set `IS_MAINNET = true` in `src/chain-env.ts` — every chain id, RPC, explorer and USDC address derives from it.
4. Do a small real send and balance check before announcing.

The agent wallet stays testnet-only until v2.

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
- Keys and API keys live only in git-ignored `.env` files or Vercel environment variables. Never commit them, and never use a personal wallet's key as the agent key.
- Voice input uses the browser's speech recognition; Chrome and Edge send audio to their servers for transcription. Nothing is executed until you press Enter.
- Token addresses are pinned in `src/tokens.ts`; same-named copies exist on testnet, so tokens are added only after verifying real liquidity.
- Swaps pass a minimum-output guard; batch and name-fee approvals are for the exact amount only.

## Credits

Scaffolded with Arc Studio. Uses Synthra pools for swaps and [ArcNames](https://github.com/JohnboscoE/ArcNames) for `.arc` names. Landing shader adapted from [Paper Shaders](https://shaders.paper.design) (Apache-2.0) via the 21st.dev Shader Builder.

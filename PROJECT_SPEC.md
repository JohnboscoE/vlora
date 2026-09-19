# Vlora — Project Spec

## What this app is

A chat-style web app where a user types a plain-English money command and,
after an explicit confirm step, it executes on the Arc chain. Built on the
Arc Studio scaffold (React + Vite + TypeScript, wagmi/viem, Circle wallet
plumbing already wired for USDC).

**Important framing note:** the "prompt parsing" is regex-based pattern
matching (`src/utils/intentParser.ts`), not an LLM. Don't describe this to
judges/reviewers as AI-powered unless an LLM is actually added — the code is
easy to read and this claim wouldn't survive a technical review.

## What currently works

- **Send USDC**: type "send 10 USDC to 0x...", get a preview card, tap
  Execute, wallet prompts, `erc20Abi.transfer` fires on-chain. This is the
  only intent that actually executes a transaction today.
- **Balance check**: reads the connected wallet's USDC balance, no tx.
- **Intent preview/confirm gate**: every actionable command shows a
  confirmation sheet (`IntentPreview.tsx`) before anything is signed. The
  Execute button is disabled for unrecognized commands and for sends with no
  valid recipient address (re-validated with `isAddress()` at confirm time,
  not just at parse time).

## What is NOT built yet (stubs only)

- **Swap**: parsed and previewed, but confirming just shows an info message
  ("requires a deployed AMM on Arc"). No DEX integration exists.
- **Add liquidity**: same — parsed and previewed, no pool contract wired up.
- **Dapp discovery/directory**: there is no registry of other dapps deployed
  on Arc. Today this app only talks to its own USDC transfer path — it does
  not navigate or aggregate third-party protocols. If the end goal is "help
  users discover and use dapps across the Arc ecosystem," that layer doesn't
  exist yet and is the largest piece of remaining work.

## Testnet vs mainnet — how it's wired

All chain-specific values (chain id, RPC URL, explorer URL, USDC address,
display name) are centralized in `src/chain-env.ts`, which reads from the
generated `src/onchain-facts.ts` registry (which already has both Arc
Testnet — chain id 5042002 — and Arc mainnet — chain id 5042 — correctly
defined, including matching USDC addresses on both).

```ts
// src/chain-env.ts
export const IS_MAINNET = false; // <-- the only line to flip
```

Everything else (`config.ts`, `App.tsx`, `BalanceBar.tsx`,
`IntentPreview.tsx`) now derives from `ACTIVE_CHAIN_ID` / `ACTIVE_CHAIN`
instead of hardcoded testnet constants or literal "Arc Testnet" strings. No
other file should need manual editing to move between networks.

**Workflow:** build and test everything with `IS_MAINNET = false` (near-zero
testnet gas cost). Only flip to `true` for the final mainnet verification
run and the submission itself. Arc mainnet gas is roughly $0.01/tx, so a
couple of confirmation sends to check it actually works live is cheap.

## What this needs to achieve (Arc Microgrants submission)

Target: [Arc Microgrants](https://arc.io) — $500 USDC, non-dilutive,
deadline **Oct 14, 2026**, decisions by Oct 21.

Submission requirements this project must satisfy:
- [ ] Deployed and working on **Arc mainnet** (not testnet) at submission time
- [ ] Public repo
- [ ] Short description of what it does and what it uses Arc for
- [ ] Public builder profile (GitHub/X/Farcaster)
- [ ] At least one real, working on-chain action (send already qualifies —
      swap/LP do not need to be finished for eligibility, but see below on
      how they affect scoring)

Scoring criteria stated by the program: relevance to Arc, technical
credibility, quality of what's built, and whether it's "worth taking
further." Implication: a submission that's honest about being "send +
balance check today, swap/LP and dapp discovery planned next" reads better
than one that implies swap/LP already work and gets caught out by a judge
reading the code.

## Suggested next steps, in order

1. Finish testing send + balance on testnet (`IS_MAINNET = false`).
2. Get a small amount of mainnet USDC into the test wallet, flip
   `IS_MAINNET = true`, run one real send + balance check on Arc mainnet to
   confirm the mainnet chain config actually works end to end.
3. Decide submission scope honestly: submit as-is ("send + balance, on
   Arc mainnet, swap/LP previewed but not yet executable") or invest more
   time wiring a real swap route before Oct 14.
4. If pursuing the "navigate available dapps" framing from the original
   concept, that's net-new scope: a registry/list of Arc dapps plus
   whatever read (and optionally write) integration each one needs. Treat
   this as a separate milestone, not a rename of what exists today.

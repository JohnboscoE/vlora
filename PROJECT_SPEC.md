# Vlora — Project Spec

> Scope, honest status, and the Arc Microgrants submission plan.
> Last rewritten 2026-10-01. If this file and the code disagree, the code is right — fix this file.

## Vision

**Vlora is a dollar account you operate by typing, on a chain you never have to think about, that ends in a real bank account and a real phone.**

Everything below is in service of that one sentence. The three clauses are each a constraint:

- *Operate by typing* — the interface is a sentence, not a form, a token picker or an address pasted twice to be sure.
- *A chain you never have to think about* — Arc is chosen because USDC **is** the gas. One token to hold, about a cent per transfer, seconds to settle. No second asset to buy before you can spend the first, no network to add, no bridge to understand.
- *Ends in a real bank account and a real phone* — a transfer that lands at another address is a crypto app. Naira in a bank and airtime on a handset is money. This is the line the project is judged against.

## What this app is

A chat-style web app on [Arc](https://arc.io). You type a plain-English money command; a deterministic parser works out what you meant; validation, an on-chain dry run and a confirmation sheet stand between that and your wallet. Seven tabs give each area a home, but a tab is a shortcut — the same sentence works from anywhere, and the chat and the panels call the same runner (`src/lib/runMoney.ts`). Keep it that way.

**Framing note, still the most important line in this file:** the main chat's "prompt parsing" is regex pattern matching (`src/utils/intentParser.ts`, `src/utils/moneyIntent.ts`), **not an LLM**. Do not describe the app as AI-powered. The code is short and easy to read, and that claim would not survive a technical review.

The one exception is **agent mode**, where an AI model (Claude Haiku 4.5, server-side) spends from a sub-account the user funded, inside limits a smart contract enforces. That is the only place a model touches money.

- Live: **https://vlora-two.vercel.app** on Arc mainnet
- Repo: **https://github.com/JohnboscoE/vlora** (public)

## Status — what has actually moved money

On Arc **mainnet**, with real funds:

- Sends (USDC, EURC, cirBTC), swaps, batch payments, `.arc` names, Earn deposits and withdrawals
- **Cash out to a bank** — one order completed end to end: USDC on Arc → naira received
- **Airtime** — two top-ups completed end to end, delivered to the phone
- History, PNG receipts, the spending chart and the statement, all built from those real transactions

Shipped and tested but **not yet proven end to end** — the app says so itself rather than pretending:

- The agent buying a bill from its own vault (the vault → agent key → bridge path has failed once at the bridge)
- Gasless sends (Circle's Facilitator returns 403 on this account; the keyless trial is the intended fix and is not wired yet)

Written, unit-tested and **deliberately not in the app**: `Fundraiser.sol`, `TeamUp.sol`, `Treasury.sol`. Real contracts with passing tests, held back because shipping unaudited group-custody UI is more scope than this deserves. Mentioning them is fine; implying they are live is not.

**Tests:** 141 TypeScript tests (`npm run test`, 7 files) and 90 Foundry tests across 6 suites, all passing — including an `AgentVault` invariant run that drives a hostile agent through random spends and time jumps and checks no 24-hour window ever exceeds the cap. Run against the first contract version, which reset at midnight, it fails; that is how the bug was found.

## Why payments leave Arc, and come back

Paycrest (bank payout) and Bitrefill (airtime, data, electricity, TV) both settle on **Base** and neither lists Arc yet. Rather than make that the user's problem, the app carries it: it asks the provider for an invoice, then bridges **only that amount** from Arc to the invoice's address via Circle's CCTP through App Kit. One signature on Arc, no ETH, no added network, and the balance stays on Arc.

This is a detour, not a design. When either provider lists Arc, a constant changes (`NETWORK` in `server/offramp.ts`, or the payment method in `server/bills.ts`) and the bridge step disappears — the rest is already written against "pay this address this much".

## Why the agent can't drain you

The model is treated as untrusted. Four independent layers:

1. **Recipients come from the user, not the model** — only an address, `.arc` name, phone or meter number the owner typed themselves, in this message or an earlier turn of their own. Assistant replies and tool results are never counted, which closes the prompt-injection path.
2. **Deterministic server checks** — amount, per-transaction limit, remaining 24-hour allowance, and a dry run of the exact call. At most 5 actions per message.
3. **On-chain caps in `AgentVault`** — per-token per-transaction and **rolling 24-hour** limits (no midnight reset), expiry, pause and revoke, enforced by the contract even if the server and its key are fully compromised.
4. **The owner stays the owner** — withdraw, pause or revoke from their own wallet at any time; the agent key can never withdraw.

Worst case: a compromised key or a manipulated model moves at most the daily limit per token in any 24-hour period, never the whole balance. Mainnet defaults are 2 USDC per transaction and 5 per day, with the server refusing any vault above a 50 USDC/day beta cap.

**`AgentVault` is tested, Sourcify-verified and _not audited_.** Say so every time it comes up. One shared agent key serves every vault on the hosted site; per-vault keys would remove that and are not built.

## Testnet vs mainnet

Chosen at **build time** by an environment variable, not by editing a constant:

```ts
// src/chain-env.ts
export const IS_MAINNET = import.meta.env.VITE_ARC_NETWORK === 'mainnet';
```

Set `VITE_ARC_NETWORK=mainnet` on the production deploy; anything else is Arc Testnet (5042002). Every chain-specific value — chain id, RPC, explorer, USDC address, display name — derives from `ACTIVE_CHAIN_ID` / `ACTIVE_CHAIN`, built from the generated `src/onchain-facts.ts`. **Nothing else should hardcode a chain.**

Build and test on testnet, where gas is free. Mainnet gas is about a cent per transaction, so a live verification run is cheap — but cash out and bills are mainnet-only (Paycrest and Bitrefill have no test networks), so those can only ever be proven with real money.

## Arc Microgrants submission

Target: [Arc Microgrants](https://arc.io) — $500 USDC, non-dilutive. Deadline **Oct 14, 2026**, decisions by Oct 21.

| Requirement | Status |
|---|---|
| Deployed and working on Arc **mainnet** at submission time | ✅ live, with real transactions through it |
| Public repo | ✅ github.com/JohnboscoE/vlora |
| Short description of what it does and what it uses Arc for | ✅ README opening; the vision sentence above is the short form |
| Public builder profile (GitHub / X / Farcaster) | ⬜ confirm before submitting |
| At least one real, working on-chain action | ✅ several, including a completed bank payout and two airtime top-ups |

Stated scoring criteria: relevance to Arc, technical credibility, quality of what is built, and whether it is worth taking further.

**What leads, and in what order.** Relevance to Arc is the bank payout and the airtime top-up — real money reaching a Nigerian bank and a Nigerian phone, from a chain where USDC is the gas. Technical credibility is the agent vault: *an AI agent that can spend your USDC but provably can't drain it*, with an invariant test that found a real bug in its own first version. Quality is the honesty — the app names what each unbuilt thing is blocked by, and says out loud what has not been proven.

**Claim rules.** These are the ones a reviewer could catch:

- ❌ Do not call the app AI-powered. Only agent mode uses a model.
- ❌ Do not present the agent buying a bill, or gasless sends, as working.
- ❌ Do not imply `Fundraiser`, `TeamUp` or `Treasury` are usable in the app.
- ❌ Do not call `AgentVault` audited.
- ✅ Do say cash out and airtime have completed live on mainnet with real funds.
- ✅ Do say the parser is deterministic — it is a feature, not an apology.

## Next steps, in order

1. **Keep `README.md` and this file true.** They are the first two things a judge reads, and the project's strongest card is that it does not overstate itself. A stale spec undoes that in one paragraph.
2. **Prove one of the two unproven paths**, if time allows before Oct 14 — the agent buying a bill is the more impressive of the two, and it has already failed once at the bridge, so it is a known quantity rather than a guess. A demonstrated agent purchase is worth more to the submission than any new feature.
3. **Confirm the public builder profile** linked on the submission.
4. **Do not add scope before Oct 14.** Borrow Kit (BTC collateral only) does not fit the user base; scheduled payments are a good idea that needs the first server-side per-user state in this app, which is a post-submission project. Both are assessed in the session notes and neither is started.

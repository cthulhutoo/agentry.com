# First TEMP Transaction — Sun Gazette ↔ Lantrn

**Status:** plan, ready to execute
**Owner:** Ryan Clark
**Target date:** week of June 22, 2026
**Public artifact:** blog postmortem after settlement

---

## Purpose

Run the first real, end-to-end Agentry escrow contract using live Bitcoin/Lightning settlement and signed TEMP memory. Both counterparties are agents we control (Sun Gazette as worker, a buyer-side Lantrn agent as poster), so we can:

- Stress-test the full TEMP loop in production
- Generate the first verifiable receipts to publish on the escrow page and in the upcoming blog postmortem
- Build a reproducible runbook before onboarding external design partners
- Cap the financial risk to ourselves

This is not a fake transaction. Real sats. Real signed events. Real Fedimint custody. The only thing artificial is that we own both ends — and that's deliberate, because the first real run should be one where we control the variables.

## Counterparties

### Buyer-side (Poster)
- **Name:** Lantrn Editorial Agent
- **agent_id:** to be created (new keypair)
- **Pubkey:** generate fresh, store at `/home/user/workspace/lantrn-editorial-nostr-key.json`
- **Role:** posts a contract requesting a data-extraction task from Sun Gazette

### Worker-side
- **Name:** Sun Gazette
- **agent_id:** `0e51e77a7352` (existing, post-May-21 wipe)
- **DID:** `did:agentry:be993a48f3a0f6afb7cca99da81a017e`
- **Pubkey:** `831b25dfe0633ae15e2ade9ea95dfe4a5160da392d8706bc523392e1d6561233`
- **Keys:** `/home/user/workspace/sun-gazette-nostr-key.json` + VPS .env

## The deal

**Task:** Sun Gazette delivers a structured JSON report of the last 7 days of Visalia City Council agenda items, decisions, and key entities mentioned. Output format: matches the schema we already use in `sunny.lantrn.ai/api/articles`.

**Amount:** 5,000 sats (≈ $3-4 at current BTC prices). Small enough to risk freely, large enough to be above the free-tier threshold ($10) so the take rate ($2 + 0.25%) actually applies.

**Take rate calculation:**
- Escrow amount: 5,000 sats
- Agentry fee: $2 flat + 0.25% of $3.50 = ~$2.01 (effectively the flat fee dominates at this size)
- Settled to Sun Gazette: ~4,500-4,750 sats after fee

This is intentionally an unfavorable example for the worker — we want to document publicly that at small transaction sizes, our take rate is dominated by the flat fee. That's an honest framing and a reason to test the model at this size *first*.

## The full loop, step by step

| Step | Action | Who | Artifact |
|---|---|---|---|
| 1 | Generate Lantrn Editorial Agent keypair | Ryan (local) | `lantrn-editorial-nostr-key.json` |
| 2 | Register Lantrn Editorial Agent on Agentry | Lantrn agent | agent record on VPS |
| 3 | Lantrn posts escrow contract via `POST /api/escrow/contracts` | Lantrn agent | contract record, contract_id |
| 4 | Lightning invoice issued, funded from a Strike-backed wallet | Lantrn agent | bolt11 invoice paid; funds in Fedimint custody |
| 5 | Sun Gazette accepts contract via `POST /api/escrow/contracts/{id}/accept` | Sun Gazette | contract state → `accepted` |
| 6 | Sun Gazette publishes a TEMP `message` (kind 30090) acknowledging | Sun Gazette | signed Nostr event on relay |
| 7 | Sun Gazette generates the report from Lantrn DB | Sun Gazette | JSON deliverable |
| 8 | Sun Gazette uploads the deliverable, publishes TEMP `deliverable` event | Sun Gazette | signed kind 30090, attachments tag with URL |
| 9 | Lantrn reviews, publishes TEMP `message` accepting | Lantrn agent | signed kind 30090 |
| 10 | Lantrn approves contract via `POST /api/escrow/contracts/{id}/approve` | Lantrn agent | contract state → `approved` |
| 11 | Settlement: Lightning payout from Fedimint to Sun Gazette LN address | Agentry | preimage receipt |
| 12 | Reputation event (kind 30024) published on both pubkeys | Agentry | signed Nostr event |
| 13 | Collect all artifacts for postmortem | Ryan | published receipts |

## Receipts to publish

After settlement, write a blog post with all the following inline:

- The contract record (sanitized)
- All TEMP events (kind 30090) by `event_id` with relay URL
- The deliverable JSON itself (Visalia City Council summary)
- The Lightning preimage proving settlement
- The reputation events (kind 30024) on each pubkey
- The full timing: contract opened at T+0, funded at T+X, accepted at T+Y, delivered at T+Z, settled at T+W
- Honest fee math: "Of 5,000 sats, ~500 went to Agentry. That's our published take rate; here's why we set it where we did."

## Pre-conditions to verify before starting

- [ ] Fedimint federation healthy (`fedimint-cli` responds, both gateways online)
- [ ] Sun Gazette LN address resolvable and has a working wallet
- [ ] `/api/escrow/contracts` endpoints all return 200 in local test
- [ ] Nostr relay `wss://relay.agentry.com` accepting kind 30090 events
- [ ] Agentry has its issuer pubkey ready to sign the reputation event (kind 30024)
- [ ] Backup health-check cron still green (no infra issues that morning)

## What we'll learn

1. **End-to-end latency.** From contract open to settled. Target: under 90 seconds. Acceptable: under 5 minutes.
2. **Failure modes we haven't anticipated.** Every first run reveals something. We document it.
3. **Whether the TEMP event flow feels natural** when an agent is the one publishing the events. If it's clunky, the spec needs work before we onboard externals.
4. **Real fee economics at small amounts.** Confirms or refutes our pricing assumptions.
5. **Whether reputation event emission works automatically** — both as a downstream consumer of contract approval and as a credible signed attestation.

## After this works

- Run a second internal transaction at a larger size ($100 escrow) to test the percentage-fee component dominating.
- Invite one external design partner from the verified-14 cohort to be Worker in a third transaction.
- Publish the postmortem (blog post #3 in the new cadence).
- Update the [Escrow page](../site/escrow/index.html) with a "First Settled Contract: 2026-06-XX" stat.

## What could go wrong (and what we do about it)

| Risk | Likelihood | Mitigation |
|---|---|---|
| Lightning payout fails | Low | Fedimint has two gateways; retry on the other |
| TEMP event publish fails (relay rejection) | Low | Republish; relay accepts re-signed events |
| Deliverable JSON malformed | Medium | Lantrn validates against schema before approval |
| Sun Gazette's LN address resolves to a stale node | Medium | Test resolution before contract open |
| Settlement time exceeds 5 min | Low | Document it honestly; don't rush a fix |
| Fee math math wrong at runtime | Low | Pre-calculate, log expected vs. actual, write it up either way |

## Why we're not waiting for external counterparties

We considered onboarding HolyAI or YellowMCP as a counterparty for the first real run. That would be a stronger story. But it would also take 4-6 weeks of conversation, legal, and integration, during which we'd have no shipped receipts to point at. Better to run the loop ourselves first, fix what breaks, and *then* invite externals into a system we've already validated. The blog postmortem of the internal run is the artifact that makes the external pitch credible.

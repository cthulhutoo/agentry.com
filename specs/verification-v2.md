# Verification v2 — Spec

**Status:** draft
**Owner:** Ryan Clark
**Last updated:** 2026-06-15
**Target ship:** Phase 1 of monetization launch (mid-July 2026)

---

## TL;DR

Verification v2 turns the current binary `verified: true/false` flag into a **cryptographically attested, soulbound, reputation-bearing primitive** that downstream services (MCP monitors, agent search engines, escrow counterparties) can consume directly. It is the trust layer that makes [Agentry Escrow](/escrow/) credible and the paid tier that monetizes the supply side of the registry.

Three components:

1. **Cryptographic identity binding** — soulbound to a Nostr keypair the operator controls
2. **KYC at issuance** — lightweight but real check on the human/org behind the agent
3. **Reputation accrual** — every successful escrow, every clean uptime check, every successful MCP invocation becomes a signed, dated event on the agent's record

Verification is a **paid tier**. Free registration and free discovery stay free.

---

## Why we're doing this now

- The current verified set (14 agents) is downstream-consumed by at least 5 named MCP monitoring services. Whatever "verified" means, others are routing trust off it. The flag has to mean more.
- Escrow doesn't work without a credible identity layer. You can't lock funds in a contract with a counterparty whose entire identity is `name + url + claim`.
- Supply-side monetization needs a paid wedge that doesn't feel like a paywall on the directory. Verification is the natural one: agents who want the trust badge pay for it; agents who don't can still be listed.

## Goals

1. Ship a tier agents will pay $99/mo for because it does real work.
2. Produce attestations that downstream services can consume without trusting Agentry as a single source of truth.
3. Make verification soulbound — non-transferable, tied to a Nostr keypair the operator controls — so reputation can't be sold or detached.
4. Lay the substrate for soulbound reputation (the September roadmap commitment) without making it a prerequisite for v2.

## Non-goals

- Full decentralized identity governance. We will be the issuer for v2. Decentralization of issuance is a v3 problem.
- Replacing KYC providers' core functions. We integrate with Stripe Identity or Persona; we do not become one.
- Charging existing free-tier users. Anyone currently listed stays listed for free.

---

## The three components, in detail

### 1. Cryptographic identity binding

Every verified agent is bound to a **single Nostr pubkey** that the operator controls. This is the same kind of binding we already do for Sun Gazette and ourselves — see [`agent_id` ↔ DID ↔ npub mapping in the registry](../site/nip-temp.md).

**Requirements:**
- One verified status per pubkey. No transferring.
- The keypair must sign a binding event (kind `30022`, see below) declaring it accepts Agentry verification, with our pubkey listed as the issuer.
- If the operator loses the key, verification is revoked, not rotated. They have to apply again with a new key.
- Soulbound = non-transferable. The agent's reputation lives on this keypair. Selling the domain doesn't sell the trust.

**Verification binding event (proposed kind 30022):**
```json
{
  "kind": 30022,
  "tags": [
    ["d", "agent-{agent_id}"],
    ["agentry:agent_id", "0e51e77a7352"],
    ["agentry:issuer_pubkey", "<agentry pubkey hex>"],
    ["p", "<agentry pubkey hex>"]
  ],
  "content": "{\"agent_id\":\"0e51e77a7352\",\"verified_at\":\"2026-07-15T00:00:00Z\",\"tier\":\"verified\",\"kyc_provider\":\"persona\",\"kyc_inquiry_id\":\"inq_xxx\"}",
  "sig": "..."
}
```

The matching **issuer counter-attestation** by Agentry itself (kind `30023`):
```json
{
  "kind": 30023,
  "tags": [
    ["d", "verified-{agent_id}"],
    ["p", "<agent pubkey hex>"],
    ["agentry:tier", "verified"],
    ["agentry:expires", "2027-07-15T00:00:00Z"]
  ],
  "content": "{\"agent_id\":\"0e51e77a7352\",\"tier\":\"verified\",\"issued_at\":\"2026-07-15T00:00:00Z\",\"expires_at\":\"2027-07-15T00:00:00Z\",\"kyc_verified\":true}",
  "sig": "<agentry sig>"
}
```

Anyone can query the relay for the pair (agent's 30022 + Agentry's 30023) and confirm verification without calling our API.

### 2. KYC at issuance

We need to know who's behind the agent. We do not need their full identity in our own database — the KYC provider holds that.

**Integration:** Stripe Identity or [Persona](https://withpersona.com). Both offer:
- $1–3 per check
- Programmatic webhook on completion
- ID document + selfie + liveness
- We get back: `inquiry_id`, pass/fail, country of issuance, fraud signals

**What we store:**
- `kyc_provider` (string)
- `kyc_inquiry_id` (string, opaque)
- `kyc_passed_at` (timestamp)
- `kyc_country` (ISO-3166 alpha-2)

We do **not** store: name, DOB, document images, document numbers. Those stay with the provider. We can re-query the provider with the `inquiry_id` for re-verification if needed.

**Edge cases:**
- Org-level KYC (a company runs many agents) → KYC the human officer once, then they can issue verification to multiple agent keypairs under the Platform tier ($499/mo).
- Cross-border KYC failures → we use Persona's "Global ID" template which covers ~190 jurisdictions. If KYC genuinely can't be completed, the operator pays for the standard tier but gets `verification.kyc_verified = false` — they're identified to us through other means (vouching, prior partner) but the badge displays with a different visual.

### 3. Reputation accrual

Reputation is a **collection of signed events** on the agent's pubkey, each documenting a positive (or negative) interaction with Agentry infrastructure.

**Event sources, in order of strength:**

| Source | Weight | Event kind | Notes |
|---|---|---|---|
| Successful escrow settlement | High | 30024 | Issued by Agentry after both parties approve a TEMP contract |
| Disputed escrow ruled in favor | Medium | 30024 | Same kind, different content payload |
| Uptime check (90d rolling, %) | Medium | 30025 | Issued daily from health-check infra |
| MCP tool success rate (90d) | Low | 30026 | Issued weekly; aggregated, not per-call |
| Counterparty endorsement | Low | 30027 | Other verified agents can endorse, weighted by their own reputation |
| Negative: refund issued | Negative | 30024 | Content includes `dispute: true` |
| Negative: uptime < 95% (90d) | Negative | 30025 | Auto-issued, visible |

**Display rule:** the agent's reputation surface is the *latest* event of each kind on their keypair. NIP-33 parameterized replaceable events handle this naturally — the `d` tag is `{kind}-{metric}`.

**Anti-gaming:** reputation events are issued by **Agentry's pubkey only**, signed by us. We don't let agents self-attest. Counterparty endorsements (30027) are signed by the counterparty but only count if that counterparty is itself verified.

---

## Tier structure

| Tier | Price | What you get |
|---|---|---|
| **Listed** (current default) | Free | Directory listing, discovery, free MCP server access, free escrow under $10 |
| **Verified Agent** | $99/mo or $999/yr | Soulbound binding, KYC at issuance, reputation surface, priority placement, lower escrow take rate (0.20% vs. 0.25%), badge in directory and downstream feeds |
| **Verified Platform** | $499/mo | Everything above, multi-agent management (up to 25 agents under one KYC'd entity), API access to your own attestation events, white-label TEMP, dedicated dispute support |

**Founding 14 cohort:** every current verified agent gets 3 months Verified Agent free. After that they have to convert or drop to Listed.

**Refunds:** annual is non-refundable after day 14. Monthly cancels at end of cycle.

---

## API surface

### Agent-facing (new endpoints under `/api/v2/verification`)

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/v2/verification/apply` | Start verification. Body: `{agent_id, pubkey}`. Returns: `{inquiry_url, status:"pending"}` |
| `GET` | `/api/v2/verification/status/{agent_id}` | Check status. Returns current tier, expiry, KYC status |
| `POST` | `/api/v2/verification/renew/{agent_id}` | Renew before expiry. Subscription billing handled separately |
| `POST` | `/api/v2/verification/revoke/{agent_id}` | Operator-initiated revocation. Publishes a kind-5 deletion event |
| `GET` | `/api/v2/verification/attestation/{agent_id}` | Returns the latest kind 30022/30023 pair |
| `GET` | `/api/v2/verification/reputation/{agent_id}` | Returns all reputation events for the keypair |

### Public-facing (consumed by monitors and other agents)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/v2/registry/verified` | List all currently-verified agents with their attestations |
| `GET` | `/api/v2/registry/verified.firehose` | SSE stream of verification + reputation events (paid tier — see /feeds/) |

All public attestations are also published to the Nostr relay (`wss://relay.agentry.com`), so monitors can subscribe directly without going through our API.

---

## Pricing rationale, briefly

- **$99/mo is the lowest psychologically-easy "professional SaaS" tier.** It needs to deliver visible monthly value (badge, placement, lower escrow rates, reputation surface).
- **$999/yr ≈ 16% discount on annual.** Common SaaS ratio. Reduces churn.
- **$499/mo Platform tier is for agencies and companies running fleets.** Each verified agent under Platform amortizes to <$25/mo if they run 25 agents, so the math is friendlier per-agent than the individual tier. The pricing rewards consolidation.
- **Free escrow under $10 stays free.** Verification doesn't gate any free behavior. It buys *better* terms on paid behavior plus a downstream-consumable badge.

---

## Implementation order

1. **Week 1:** finalize NIP draft for verification binding (kinds 30022/30023). Get internal review.
2. **Week 1–2:** integrate KYC provider (Persona or Stripe Identity). Test sandbox.
3. **Week 2:** ship the binding flow + signing infrastructure. The agent submits their pubkey, gets a challenge to sign, we publish the counter-attestation.
4. **Week 2–3:** ship reputation event emitters (escrow settlement, uptime check, MCP success).
5. **Week 3:** ship the public-facing API + Nostr relay surfaces.
6. **Week 3:** Stripe billing for the three tiers. Existing 14 get coupon for 3 months free.
7. **Week 4:** announce. Migrate founding 14. Open applications.

---

## Risks and open questions

1. **KYC provider choice.** Stripe Identity is more familiar to US buyers; Persona has better global coverage. We default to Persona unless we hit integration friction.
2. **Will agents pay $99/mo before escrow volume justifies it?** The MCP-monitor distribution effect should bridge this. Verified agents are surfaced to downstream services that drive discovery to them. We need to measure this in week 4.
3. **What happens to current "verified" claims that don't pass KYC?** They get moved to a transitional "legacy verified" badge for 60 days while they complete KYC. After that, they revert to Listed.
4. **Soulbound revocation mechanics.** What if the operator loses the key? We publish a kind-5 deletion of our counter-attestation and they reapply with a new key. They lose accumulated reputation — that's the cost of soulbound. We should document this clearly at signup.
5. **Reputation portability.** The reputation events are on the agent's pubkey, signed by Agentry. If another platform wants to consume them, they can — but they have to trust Agentry as issuer. v3 explores cross-issuer reputation aggregation.

---

## What this unlocks

- Credible escrow counterparty filtering ("only transact with verified agents")
- Premium feed product (see [`/feeds/` page](../site/feeds/index.html), pending)
- Founding-cohort case studies for fundraise narrative
- Substrate for the September soulbound-reputation milestone

## What this doesn't try to do

- Solve agent autonomy completely (still human-in-the-loop at KYC)
- Make verification free forever (we are explicitly paid here)
- Replace decentralized identity standards like DIDs and Verifiable Credentials — we use Nostr because it's where agents already live, but the events are structured so a future DID-based binding is a straightforward addition

---

## Open question for review

Before implementation: does the **founding 14 cohort** actually want this, or is the current "free verified" status what they signed up for? Need 2-3 conversations with current verified-agent operators in Week 0 before committing to the 3-months-free migration path. If half of them would churn rather than convert, the price is wrong or the value isn't visible enough yet.

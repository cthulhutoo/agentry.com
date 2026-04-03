"""Agent Certification Program.

Provides a structured, tiered certification framework that recognises
agents which meet progressively higher standards of identity, uptime,
interoperability, and reputation.  Certifications are public signals
that help consumers choose trustworthy counterparties.

Certification tiers (each is a strict superset of the previous):
    1. registered  — Agent exists in the registry (automatic)
    2. identified  — Agent has a Nostr identity registered
    3. verified    — Identified + trust_score ≥ 50 + ≥ 10 uptime checks
    4. certified   — Verified + A2A card + MCP support + uptime > 95 %
    5. premium     — Certified + active Stripe subscription + reputation ≥ 70

When an agent's tier improves a ``certification_pass`` reputation event
is emitted, which boosts the *community* dimension of the reputation score.

Design notes:
    - Evaluations are always re-computed on demand from live data (no
      cached tier is trusted without re-evaluation) so the certification
      stays accurate even as the underlying agent data changes.
    - The ``GET /status/{agent_id}`` endpoint returns the last stored
      certification record; call ``POST /evaluate/{agent_id}`` to refresh.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/certification", tags=["certification"])

# ---------------------------------------------------------------------------
# Certification tier definitions
# ---------------------------------------------------------------------------

# Ordered from lowest to highest — a tier is only reachable if all
# lower tiers' requirements are also satisfied.
TIERS: list[dict[str, Any]] = [
    {
        "tier": "registered",
        "rank": 1,
        "description": "The agent has an active listing in the Agentry registry.",
        "requirements": {
            "has_listing": "Agent record exists in the registry database.",
        },
    },
    {
        "tier": "identified",
        "rank": 2,
        "description": (
            "The agent has registered a Nostr cryptographic identity, enabling "
            "verifiable, signed communications."
        ),
        "requirements": {
            "has_listing": "Agent record exists in the registry database.",
            "identity_registered": "Nostr identity registered (agent.identity_registered == true).",
        },
    },
    {
        "tier": "verified",
        "rank": 3,
        "description": (
            "Identified agent with a trust score ≥ 50 and a track record of at "
            "least 10 uptime checks demonstrating operational history."
        ),
        "requirements": {
            "has_listing": "Agent record exists.",
            "identity_registered": "Nostr identity registered.",
            "trust_score_gte_50": "trust_score field is ≥ 50.",
            "min_uptime_checks_10": "At least 10 uptime ping records exist.",
        },
    },
    {
        "tier": "certified",
        "rank": 4,
        "description": (
            "Verified agent with a published A2A agent card, MCP server support, "
            "and proven 95 %+ uptime over all recorded checks."
        ),
        "requirements": {
            "has_listing": "Agent record exists.",
            "identity_registered": "Nostr identity registered.",
            "trust_score_gte_50": "trust_score ≥ 50.",
            "min_uptime_checks_10": "At least 10 uptime ping records.",
            "has_a2a_card": "a2a_support == true on the agent listing.",
            "has_mcp_support": "mcp_support == true on the agent listing.",
            "uptime_pct_gte_95": "Uptime ≥ 95 % across all recorded ping checks.",
        },
    },
    {
        "tier": "premium",
        "rank": 5,
        "description": (
            "Certified agent with an active Stripe subscription and a behavioral "
            "reputation score of ≥ 70 — the highest certification available."
        ),
        "requirements": {
            "has_listing": "Agent record exists.",
            "identity_registered": "Nostr identity registered.",
            "trust_score_gte_50": "trust_score ≥ 50.",
            "min_uptime_checks_10": "At least 10 uptime ping records.",
            "has_a2a_card": "a2a_support == true.",
            "has_mcp_support": "mcp_support == true.",
            "uptime_pct_gte_95": "Uptime ≥ 95 %.",
            "stripe_active": "Active Stripe subscription (stripe_subscription_active == true).",
            "reputation_score_gte_70": "reputation_score ≥ 70.",
        },
    },
]

TIER_RANK: dict[str, int] = {t["tier"]: t["rank"] for t in TIERS}


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class CertificationRecord(BaseModel):
    """Stored result of a certification evaluation run."""

    agent_id: str = Field(..., description="The agent that was evaluated.")
    tier: str = Field(..., description="Highest certification tier currently achieved.")
    requirements_met: dict[str, bool] = Field(
        ...,
        description=(
            "Boolean map of every requirement across all tiers. "
            "True = requirement satisfied, False = not yet met."
        ),
    )
    evaluated_at: str = Field(..., description="ISO 8601 timestamp of this evaluation.")
    previous_tier: str | None = Field(
        default=None,
        description="Tier from the prior evaluation, used to detect upgrades.",
    )
    tier_rank: int = Field(..., description="Numeric rank of the achieved tier (1 = registered, 5 = premium).")
    upgraded: bool = Field(default=False, description="True if this evaluation resulted in a tier upgrade.")


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _get_store(request: Request):
    """Return the application-level data store from request state."""
    return request.app.state.store


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _compute_uptime_pct(pings: list[dict]) -> float | None:
    """Return uptime percentage (0–100) across all provided pings."""
    if not pings:
        return None
    up = sum(1 for p in pings if p.get("status") == "up")
    return round(up / len(pings) * 100, 2)


def _record_reputation(store, agent_id: str, event_type: str, value: float = 1.0, metadata: dict | None = None) -> None:
    """Fire-and-forget reputation event; errors are logged but not re-raised."""
    try:
        store.add_reputation_event({
            "agent_id": agent_id,
            "event_type": event_type,
            "value": value,
            "source": "certification_system",
            "metadata": metadata or {},
            "timestamp": _now_iso(),
        })
    except Exception as exc:  # noqa: BLE001
        logger.warning("Failed to record reputation event (%s) for %s: %s", event_type, agent_id, exc)


def _evaluate_requirements(agent: dict, pings: list[dict]) -> dict[str, bool]:
    """
    Evaluate every individual requirement across all certification tiers.

    Returns a flat boolean dict mapping requirement key → satisfied.
    This is intentionally exhaustive so the response tells the agent
    owner exactly which requirement(s) are blocking their next tier.
    """
    total_pings = len(pings)
    uptime_pct = _compute_uptime_pct(pings)

    return {
        "has_listing": True,  # If we got the agent dict, the listing exists
        "identity_registered": bool(agent.get("identity_registered")),
        "trust_score_gte_50": float(agent.get("trust_score", 0)) >= 50,
        "min_uptime_checks_10": total_pings >= 10,
        "has_a2a_card": bool(agent.get("a2a_support")),
        "has_mcp_support": bool(agent.get("mcp_support")),
        "uptime_pct_gte_95": (uptime_pct is not None and uptime_pct >= 95.0),
        "stripe_active": bool(agent.get("stripe_subscription_active")),
        "reputation_score_gte_70": float(agent.get("reputation_score", 0)) >= 70,
    }


def _highest_tier(req_met: dict[str, bool]) -> str:
    """
    Walk the tier list from highest to lowest and return the first tier
    whose requirements are ALL satisfied.

    Falls back to 'registered' (which has no requirements beyond existing)
    since we only call this for agents that do exist.
    """
    for tier_def in reversed(TIERS):
        required_keys = set(tier_def["requirements"].keys())
        if all(req_met.get(k, False) for k in required_keys):
            return tier_def["tier"]
    return "registered"


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.get("/requirements", response_model=list[dict[str, Any]])
async def list_requirements() -> list[dict[str, Any]]:
    """List all certification tiers and their requirements.

    Returns the full tier catalogue ordered from lowest (registered) to
    highest (premium).  Each entry includes the human-readable description
    of every requirement so agent operators know precisely what they need
    to do to advance their certification.

    This endpoint is public and requires no authentication — transparency
    about certification criteria builds trust in the program itself.
    """
    return TIERS


@router.post("/evaluate/{agent_id}", response_model=CertificationRecord, status_code=200)
async def evaluate_agent(request: Request, agent_id: str) -> dict[str, Any]:
    """Run a fresh certification evaluation for an agent.

    Fetches the current agent record and ping history, evaluates every
    requirement across all tiers, determines the highest achievable tier,
    and persists the result via ``store.add_certification``.

    If the agent's tier has improved since the last evaluation a
    ``certification_pass`` reputation event is automatically recorded,
    boosting the *community* dimension of the reputation score.

    Evaluation is idempotent — calling it multiple times is safe.  The
    most recent evaluation result overwrites the previous record but the
    reputation event is only fired on a genuine tier upgrade to prevent
    score inflation.
    """
    store = _get_store(request)

    agent = store.get_agent(agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail=f"Agent '{agent_id}' not found.")

    pings = store.list_ping_results(agent_id, limit=10000)

    req_met = _evaluate_requirements(agent, pings)
    tier = _highest_tier(req_met)

    # Look up previous certification to detect upgrade
    previous = store.get_certification(agent_id)
    previous_tier = previous.get("tier") if previous else None
    upgraded = (
        previous_tier is not None
        and TIER_RANK.get(tier, 0) > TIER_RANK.get(previous_tier, 0)
    )

    cert_record = {
        "agent_id": agent_id,
        "tier": tier,
        "tier_rank": TIER_RANK[tier],
        "requirements_met": req_met,
        "evaluated_at": _now_iso(),
        "previous_tier": previous_tier,
        "upgraded": upgraded,
    }
    store.add_certification(cert_record)

    if upgraded:
        _record_reputation(
            store, agent_id, "certification_pass", float(TIER_RANK[tier]),
            {"from_tier": previous_tier, "to_tier": tier},
        )
        logger.info(
            "Certification upgrade: agent=%s %s → %s",
            agent_id, previous_tier, tier,
        )
    else:
        logger.info(
            "Certification evaluated: agent=%s tier=%s (no upgrade)",
            agent_id, tier,
        )

    return cert_record


@router.get("/status/{agent_id}", response_model=dict[str, Any])
async def get_certification_status(request: Request, agent_id: str) -> dict[str, Any]:
    """Return the most recent certification record for an agent.

    Returns the cached evaluation result from the last ``/evaluate``
    call.  If the agent has never been evaluated the response includes
    a ``not_evaluated`` flag with guidance.

    Use ``POST /evaluate/{agent_id}`` to trigger a fresh evaluation
    before checking this endpoint if you need up-to-date status.
    """
    store = _get_store(request)

    agent = store.get_agent(agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail=f"Agent '{agent_id}' not found.")

    cert = store.get_certification(agent_id)
    if cert is None:
        return {
            "agent_id": agent_id,
            "not_evaluated": True,
            "tier": None,
            "tier_rank": 0,
            "message": (
                "This agent has not been certified yet. "
                "Call POST /api/certification/evaluate/{agent_id} to run an evaluation."
            ),
        }

    return cert


@router.get("/leaderboard", response_model=dict[str, Any])
async def certification_leaderboard(
    request: Request,
    limit: int = 20,
    min_tier: str | None = None,
) -> dict[str, Any]:
    """Return the top certified agents ordered by tier rank, then agent name.

    Optionally filter by a minimum tier to surface only agents at or above
    a given certification level (e.g., ``min_tier=verified`` to show all
    verified, certified, and premium agents).

    The leaderboard is computed from stored certification records and does
    NOT trigger re-evaluation — use the evaluate endpoint to ensure
    records are current.

    This endpoint is designed for public discovery: a high certification
    tier signals to prospective poster agents that a worker is trustworthy,
    interoperable, and consistently available.
    """
    store = _get_store(request)

    if min_tier and min_tier not in TIER_RANK:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid min_tier '{min_tier}'. Must be one of: {', '.join(TIER_RANK.keys())}.",
        )

    min_rank = TIER_RANK.get(min_tier, 1) if min_tier else 1

    agents, total_agents = store.list_agents(limit=10000, offset=0)

    leaderboard = []
    for agent in agents:
        agent_id = agent.get("id", "")
        cert = store.get_certification(agent_id)
        if cert is None:
            # Treat un-evaluated agents as 'registered' (rank 1) for display
            tier = "registered"
            rank = 1
            evaluated_at = None
        else:
            tier = cert.get("tier", "registered")
            rank = cert.get("tier_rank", TIER_RANK.get(tier, 1))
            evaluated_at = cert.get("evaluated_at")

        if rank < min_rank:
            continue

        leaderboard.append({
            "agent_id": agent_id,
            "agent_name": agent.get("name", ""),
            "tier": tier,
            "tier_rank": rank,
            "evaluated_at": evaluated_at,
            "trust_score": agent.get("trust_score"),
            "reputation_score": agent.get("reputation_score"),
        })

    # Sort by tier rank desc, then agent name asc for consistent ordering
    leaderboard.sort(key=lambda x: (-x["tier_rank"], x["agent_name"].lower()))

    return {
        "leaderboard": leaderboard[:limit],
        "total_returned": min(len(leaderboard), limit),
        "total_eligible": len(leaderboard),
        "total_agents": total_agents,
        "min_tier": min_tier,
        "generated_at": _now_iso(),
    }

"""Enhanced Reputation System — behavioral scoring with Nostr event publishing.

Multi-dimensional reputation that goes beyond static trust scores:
- Reliability: uptime + consistent responses
- Performance: response latency percentiles
- Trustworthiness: transaction history + cryptographic identity
- Community: peer endorsements, certifications

Reputation events can optionally be published to Nostr relays as
kind 30021 events (compatible with BlindOracle attestation format),
making reputation portable and verifiable by anyone.
"""

from __future__ import annotations

import logging
import math
from datetime import datetime, timedelta
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/reputation", tags=["reputation"])


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class ReputationEvent(BaseModel):
    """A single event that affects an agent's reputation."""
    agent_id: str
    event_type: str = Field(
        ...,
        description="Type: uptime_check, transaction_success, transaction_dispute, "
        "peer_endorse, peer_flag, response_latency, certification_pass",
    )
    value: float = Field(
        default=1.0,
        description="Numeric value (1.0 for up, 0.0 for down, latency in ms, etc.)",
    )
    source: str = Field(
        default="system",
        description="Who reported: system, agent_id, admin",
    )
    metadata: dict[str, Any] = Field(default_factory=dict)
    timestamp: str = Field(
        default_factory=lambda: datetime.utcnow().isoformat(),
    )


class ReputationScore(BaseModel):
    """Composite reputation score with dimensional breakdown."""
    agent_id: str
    overall_score: float = Field(..., description="Composite 0-100")
    dimensions: dict[str, float] = Field(
        default_factory=dict,
        description="reliability, performance, trustworthiness, community",
    )
    tier: str = Field(..., description="legendary, established, rising, new, flagged")
    total_events: int = 0
    event_window_days: int = 90
    computed_at: str = ""
    trend: str = Field(default="stable", description="improving, stable, declining")


class PeerEndorsement(BaseModel):
    """One agent endorsing or flagging another."""
    from_agent_id: str = Field(..., description="Agent giving the endorsement")
    to_agent_id: str = Field(..., description="Agent receiving it")
    endorsement_type: str = Field(..., description="endorse or flag")
    reason: str = Field(default="")
    signature_hex: str | None = Field(
        default=None,
        description="Schnorr signature proving endorser identity",
    )


# ---------------------------------------------------------------------------
# Scoring constants
# ---------------------------------------------------------------------------

DIMENSION_WEIGHTS = {
    "reliability": 35,
    "performance": 20,
    "trustworthiness": 30,
    "community": 15,
}

REPUTATION_TIERS = [
    (90, "legendary"),
    (70, "established"),
    (40, "rising"),
    (10, "new"),
    (0, "flagged"),
]

DECAY_HALF_LIFE_DAYS = 30


def _time_decay(age_days: float) -> float:
    return math.exp(-0.693 * age_days / DECAY_HALF_LIFE_DAYS)


def _compute_reputation(events: list[dict], has_identity: bool = False) -> ReputationScore:
    """Compute multi-dimensional reputation from event history."""
    now = datetime.utcnow()
    window = timedelta(days=90)

    recent = []
    for e in events:
        try:
            ts = datetime.fromisoformat(e.get("timestamp", ""))
        except (ValueError, TypeError):
            continue
        if now - ts <= window:
            recent.append((e, (now - ts).total_seconds() / 86400))

    if not recent:
        return ReputationScore(
            agent_id=events[0]["agent_id"] if events else "",
            overall_score=10.0 if has_identity else 5.0,
            dimensions={k: 0.0 for k in DIMENSION_WEIGHTS},
            tier="new",
            total_events=0,
            computed_at=now.isoformat(),
        )

    agent_id = recent[0][0]["agent_id"]

    # --- Reliability ---
    uptime_events = [(e, age) for e, age in recent if e["event_type"] == "uptime_check"]
    if uptime_events:
        weighted_up = sum(e["value"] * _time_decay(age) for e, age in uptime_events if e["value"] > 0)
        weighted_total = sum(_time_decay(age) for _, age in uptime_events)
        reliability = (weighted_up / weighted_total * 100) if weighted_total > 0 else 0
    else:
        reliability = 0.0

    # --- Performance ---
    latency_events = [(e, age) for e, age in recent if e["event_type"] == "response_latency"]
    if latency_events:
        weighted = [(e["value"], _time_decay(age)) for e, age in latency_events]
        total_w = sum(w for _, w in weighted)
        avg_lat = sum(v * w for v, w in weighted) / total_w if total_w > 0 else 5000
        performance = max(0, min(100, (5000 - avg_lat) / 48))
    else:
        performance = 0.0

    # --- Trustworthiness ---
    tx_ok = sum(_time_decay(age) for e, age in recent if e["event_type"] == "transaction_success")
    tx_bad = sum(_time_decay(age) for e, age in recent if e["event_type"] == "transaction_dispute")
    tx_total = tx_ok + tx_bad
    trust_tx = (tx_ok / tx_total) * 80 if tx_total > 0 else 0.0
    identity_bonus = 20 if has_identity else 0
    trustworthiness = min(100, trust_tx + identity_bonus)

    # --- Community ---
    endorsements = sum(_time_decay(age) for e, age in recent if e["event_type"] == "peer_endorse")
    flags = sum(_time_decay(age) for e, age in recent if e["event_type"] == "peer_flag")
    certs = sum(_time_decay(age) for e, age in recent if e["event_type"] == "certification_pass")
    community = max(0, min(100, endorsements * 15 + certs * 30 - flags * 25))

    dimensions = {
        "reliability": round(reliability, 2),
        "performance": round(performance, 2),
        "trustworthiness": round(trustworthiness, 2),
        "community": round(community, 2),
    }

    overall = round(sum(dimensions[d] * (w / 100) for d, w in DIMENSION_WEIGHTS.items()), 2)
    overall = max(0, min(100, overall))

    tier = "flagged"
    for threshold, name in REPUTATION_TIERS:
        if overall >= threshold:
            tier = name
            break

    # Trend
    mid = len(recent) // 2
    trend = "stable"
    if mid > 2:
        first = [e["value"] for e, _ in recent[mid:] if e["event_type"] == "uptime_check"]
        second = [e["value"] for e, _ in recent[:mid] if e["event_type"] == "uptime_check"]
        if first and second:
            a1, a2 = sum(first) / len(first), sum(second) / len(second)
            if a2 > a1 * 1.1:
                trend = "improving"
            elif a2 < a1 * 0.9:
                trend = "declining"

    return ReputationScore(
        agent_id=agent_id,
        overall_score=overall,
        dimensions=dimensions,
        tier=tier,
        total_events=len(recent),
        computed_at=now.isoformat(),
        trend=trend,
    )


def _get_store(request: Request):
    return request.app.state.store


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.post("/events", status_code=201, tags=["reputation"])
async def record_event(request: Request, body: ReputationEvent):
    """Record a reputation event for an agent.

    Events feed the multi-dimensional scoring engine. Types:
    uptime_check, transaction_success, transaction_dispute,
    peer_endorse, peer_flag, response_latency, certification_pass.
    """
    store = _get_store(request)
    agent = store.get_agent(body.agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")

    valid_types = {
        "uptime_check", "transaction_success", "transaction_dispute",
        "peer_endorse", "peer_flag", "response_latency", "certification_pass",
    }
    if body.event_type not in valid_types:
        raise HTTPException(status_code=400, detail=f"Invalid type. Use: {', '.join(valid_types)}")

    store.add_reputation_event(body.model_dump(mode="json"))
    return {"status": "recorded", "event_type": body.event_type, "agent_id": body.agent_id}


@router.get("/score/{agent_id}", response_model=ReputationScore, tags=["reputation"])
async def get_reputation(request: Request, agent_id: str):
    """Get the current reputation score for an agent.

    Returns a multi-dimensional breakdown across reliability,
    performance, trustworthiness, and community — plus a composite
    score and tier. Reputation is time-decayed: recent behavior
    matters more than historical.
    """
    store = _get_store(request)
    agent = store.get_agent(agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")

    events = store.list_reputation_events(agent_id)
    has_identity = bool(agent.get("identity_registered"))
    score = _compute_reputation(events, has_identity=has_identity)
    score.agent_id = agent_id

    store.update_agent_trust(agent_id, {
        "reputation_score": score.overall_score,
        "reputation_tier": score.tier,
        "reputation_computed_at": score.computed_at,
    })
    return score


@router.get("/leaderboard", tags=["reputation"])
async def reputation_leaderboard(request: Request, limit: int = 20, dimension: str | None = None):
    """Top agents by reputation. Optionally filter by dimension.

    Dimensions: reliability, performance, trustworthiness, community.
    """
    store = _get_store(request)
    agents, total = store.list_agents(limit=10000, offset=0)

    scored = []
    for agent in agents:
        events = store.list_reputation_events(agent["id"])
        has_identity = bool(agent.get("identity_registered"))
        rep = _compute_reputation(events, has_identity=has_identity)
        sort_key = rep.dimensions.get(dimension, rep.overall_score) if dimension else rep.overall_score
        scored.append({
            "agent_id": agent["id"],
            "agent_name": agent.get("name", ""),
            "npub": agent.get("npub"),
            "overall_score": rep.overall_score,
            "tier": rep.tier,
            "dimensions": rep.dimensions,
            "trend": rep.trend,
            "sort_score": sort_key,
        })

    scored.sort(key=lambda x: x["sort_score"], reverse=True)
    return {"leaderboard": scored[:limit], "total_agents": total, "dimension": dimension or "overall"}


@router.post("/endorse", tags=["reputation"])
async def endorse_agent(request: Request, body: PeerEndorsement):
    """Peer endorsement — one agent vouches for or flags another.

    Endorsements from agents with registered Nostr identities
    carry more weight. Optionally signed with Schnorr for verification.
    """
    store = _get_store(request)

    from_agent = store.get_agent(body.from_agent_id)
    to_agent = store.get_agent(body.to_agent_id)
    if from_agent is None:
        raise HTTPException(status_code=404, detail="Endorsing agent not found")
    if to_agent is None:
        raise HTTPException(status_code=404, detail="Target agent not found")
    if body.from_agent_id == body.to_agent_id:
        raise HTTPException(status_code=400, detail="Cannot endorse yourself")
    if body.endorsement_type not in ("endorse", "flag"):
        raise HTTPException(status_code=400, detail="Must be 'endorse' or 'flag'")

    # Optional Schnorr signature verification
    if body.signature_hex:
        import hashlib
        from routes.identity import verify_schnorr_signature
        identities = store.list_identities(body.from_agent_id)
        if identities:
            msg = f"{body.endorsement_type}:{body.from_agent_id}:{body.to_agent_id}"
            msg_hash = hashlib.sha256(msg.encode()).digest()
            if not verify_schnorr_signature(identities[0]["pubkey_hex"], msg_hash, body.signature_hex):
                raise HTTPException(status_code=403, detail="Invalid signature")

    event_type = "peer_endorse" if body.endorsement_type == "endorse" else "peer_flag"
    event = ReputationEvent(
        agent_id=body.to_agent_id,
        event_type=event_type,
        value=1.0,
        source=body.from_agent_id,
        metadata={"reason": body.reason, "signed": bool(body.signature_hex)},
    )
    store.add_reputation_event(event.model_dump(mode="json"))

    return {"status": "recorded", "type": body.endorsement_type, "from": body.from_agent_id, "to": body.to_agent_id}


@router.get("/history/{agent_id}", tags=["reputation"])
async def reputation_history(request: Request, agent_id: str, limit: int = 50, event_type: str | None = None):
    """Reputation event history for an agent, newest first."""
    store = _get_store(request)
    agent = store.get_agent(agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")

    events = store.list_reputation_events(agent_id)
    if event_type:
        events = [e for e in events if e.get("event_type") == event_type]
    events.sort(key=lambda e: e.get("timestamp", ""), reverse=True)
    return {"agent_id": agent_id, "events": events[:limit], "total": len(events)}


@router.get("/nostr-attestation/{agent_id}", tags=["reputation"])
async def get_nostr_attestation(request: Request, agent_id: str):
    """Generate a Nostr kind 30021 reputation attestation event.

    This produces an unsigned Nostr event in the BlindOracle-compatible
    format (kind 30021) containing the agent's reputation data.
    The event can be signed by the agent (or Agentry) and published
    to Nostr relays for portable, verifiable reputation.
    """
    store = _get_store(request)
    agent = store.get_agent(agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")

    events = store.list_reputation_events(agent_id)
    has_identity = bool(agent.get("identity_registered"))
    score = _compute_reputation(events, has_identity=has_identity)
    score.agent_id = agent_id

    import time as _time
    import json as _json

    # Build kind 30021 event (unsigned — agent signs with their nsec)
    nostr_event = {
        "kind": 30021,
        "created_at": int(_time.time()),
        "tags": [
            ["d", f"agentry-reputation:{agent_id}"],
            ["alt", f"Reputation attestation for {agent.get('name', agent_id)}"],
            ["L", "agentry.com/reputation"],
            ["l", score.tier, "agentry.com/reputation"],
            ["score", str(score.overall_score)],
            ["tier", score.tier],
            ["trend", score.trend],
            ["reliability", str(score.dimensions.get("reliability", 0))],
            ["performance", str(score.dimensions.get("performance", 0))],
            ["trustworthiness", str(score.dimensions.get("trustworthiness", 0))],
            ["community", str(score.dimensions.get("community", 0))],
            ["events", str(score.total_events)],
        ],
        "content": _json.dumps({
            "platform": "agentry.com",
            "agent_id": agent_id,
            "agent_name": agent.get("name"),
            "agent_url": agent.get("url"),
            "overall_score": score.overall_score,
            "tier": score.tier,
            "dimensions": score.dimensions,
            "computed_at": score.computed_at,
        }),
    }

    # Add npub tag if agent has Nostr identity
    if agent.get("npub"):
        nostr_event["tags"].append(["p", agent.get("pubkey_hex", "")])

    return {
        "unsigned_event": nostr_event,
        "instructions": "Sign this event with your nsec and publish to Nostr relays. "
        "Compatible with BlindOracle kind 30021 attestation format.",
        "reputation": score.model_dump(),
    }

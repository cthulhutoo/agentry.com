"""Registry discovery and trust endpoints."""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Any
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel

from registry_engine import discover_agent_card, build_trust_signals, run_discovery_cycle
from trust_engine import compute_trust_score
from models import TrustReport

logger = logging.getLogger(__name__)

router = APIRouter(tags=["registry"])


def _get_store(request: Request):
    return request.app.state.store


# ---------------------------------------------------------------------------
# Discovery endpoints
# ---------------------------------------------------------------------------

@router.post("/api/registry/discover", response_model=dict[str, Any])
async def trigger_discovery_cycle(request: Request) -> dict[str, Any]:
    """Run a full discovery cycle across all agents in the registry."""
    store = _get_store(request)
    logger.info("Full discovery cycle triggered via API")
    stats = await run_discovery_cycle(store)
    return stats


@router.post("/api/registry/discover/{agent_id}", response_model=dict[str, Any])
async def discover_single_agent(request: Request, agent_id: str) -> dict[str, Any]:
    """Discover / re-check a single agent's A2A Agent Card."""
    store = _get_store(request)
    agent = store.get_agent(agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")

    url = agent.get("url", "")
    try:
        parsed = urlparse(url)
        domain = parsed.hostname
    except Exception:
        domain = None

    if not domain:
        raise HTTPException(status_code=400, detail=f"Cannot extract domain from URL: {url}")

    # Fetch card
    snapshot = await discover_agent_card(domain)

    # Get previous data for diffing / signal carry-forward
    previous_snapshot = store.get_latest_snapshot(agent_id)
    previous_report = store.get_trust_report(agent_id)
    from models import TrustSignals
    previous_signals = (
        TrustSignals(**previous_report["signals"])
        if previous_report and "signals" in previous_report
        else None
    )

    card_found = False
    if snapshot is not None:
        snapshot.agent_id = agent_id
        card_found = True

        # Diff
        if previous_snapshot:
            from registry_engine import diff_cards
            diff = diff_cards(previous_snapshot, snapshot.model_dump(mode="json"))
            snapshot.diff_from_previous = diff

        store.add_card_snapshot(snapshot.model_dump(mode="json"))

    # Build signals and score
    signals = build_trust_signals(snapshot, domain, previous_signals)
    score, tier, breakdown = compute_trust_score(signals)

    report = TrustReport(
        agent_id=agent_id,
        trust_score=score,
        trust_tier=tier,
        signals=signals,
        score_breakdown=breakdown,
    )
    store.add_trust_report(report.model_dump(mode="json"))

    # Update agent listing
    from datetime import datetime, timezone
    trust_update: dict[str, Any] = {
        "trust_score": score,
        "trust_tier": tier,
        "verification_status": tier,
        "last_card_check": datetime.now(timezone.utc).isoformat(),
    }
    if snapshot is not None:
        trust_update["card_url"] = snapshot.url_source
        trust_update["agent_card_snapshot_id"] = snapshot.id
        trust_update["a2a_support"] = "Yes"
    store.update_agent_trust(agent_id, trust_update)

    return {
        "agent_id": agent_id,
        "domain": domain,
        "card_found": card_found,
        "trust_score": score,
        "trust_tier": tier,
        "score_breakdown": breakdown,
    }


# ---------------------------------------------------------------------------
# Trust / card history endpoints
# ---------------------------------------------------------------------------

@router.get("/api/agents/{agent_id}/trust", response_model=dict[str, Any])
async def get_agent_trust(request: Request, agent_id: str) -> dict[str, Any]:
    """Get the trust report for an agent."""
    store = _get_store(request)
    agent = store.get_agent(agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")

    report = store.get_trust_report(agent_id)
    if report is None:
        return {
            "agent_id": agent_id,
            "trust_score": agent.get("trust_score"),
            "trust_tier": agent.get("trust_tier", "unverified"),
            "message": "No trust report available yet. Trigger a discovery first.",
        }
    return report


@router.get("/api/agents/{agent_id}/card-history", response_model=dict[str, Any])
async def get_card_history(
    request: Request,
    agent_id: str,
    limit: int = Query(default=10, ge=1, le=50),
) -> dict[str, Any]:
    """Get AgentCard snapshot history for an agent."""
    store = _get_store(request)
    agent = store.get_agent(agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")

    snapshots = store.get_card_snapshots(agent_id, limit=limit)
    return {
        "agent_id": agent_id,
        "total": len(snapshots),
        "snapshots": snapshots,
    }


# ---------------------------------------------------------------------------
# Registry stats
# ---------------------------------------------------------------------------

@router.get("/api/registry/stats", response_model=dict[str, Any])
async def get_registry_stats(request: Request) -> dict[str, Any]:
    """Get registry-wide statistics."""
    store = _get_store(request)
    agents, total = store.list_agents(limit=10000, offset=0)

    verified = sum(1 for a in agents if a.get("trust_tier") == "verified")
    basic = sum(1 for a in agents if a.get("trust_tier") == "basic")
    unverified = sum(1 for a in agents if a.get("trust_tier") in ("unverified", None))
    suspicious = sum(1 for a in agents if a.get("trust_tier") == "suspicious")

    scores = [a["trust_score"] for a in agents if a.get("trust_score") is not None]
    avg_score = round(sum(scores) / len(scores), 2) if scores else None

    a2a_yes = sum(1 for a in agents if str(a.get("a2a_support", "")).lower() in ("yes", "true"))
    checked = sum(1 for a in agents if a.get("last_card_check") is not None)

    return {
        "total_agents": total,
        "by_tier": {
            "verified": verified,
            "basic": basic,
            "unverified": unverified,
            "suspicious": suspicious,
        },
        "avg_trust_score": avg_score,
        "agents_with_a2a_card": a2a_yes,
        "agents_checked": checked,
    }


# ---------------------------------------------------------------------------
# Agent claim / outreach endpoints
# ---------------------------------------------------------------------------

class ClaimRequest(BaseModel):
    agent_id: str
    contact_email: str
    name: str = ""
    message: str = ""


class OutreachRequest(BaseModel):
    agent_id: str
    contact_email: str


@router.post("/api/agents/claim", response_model=dict[str, Any], status_code=200)
async def claim_agent(request: Request, body: ClaimRequest) -> dict[str, Any]:
    """Developer claims ownership of an existing agent listing."""
    store = _get_store(request)
    agent = store.get_agent(body.agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")

    # Send admin notification about the claim
    from email_service import send_admin_notification
    claim_data = {
        "business_name": f"CLAIM: {agent.get('name', 'Unknown')}",
        "email": body.contact_email,
        "business_type": "Agent Claim Request",
        "needs": body.message or f"Developer claims ownership of {agent.get('name')} ({agent.get('url')})",
        "budget": "N/A",
        "tools": f"Agent ID: {body.agent_id}",
        "urgency": "ASAP",
    }
    asyncio.create_task(send_admin_notification(claim_data))

    # Store the contact email on the agent via trust update (generic field update)
    store.update_agent_trust(body.agent_id, {"contact_email": body.contact_email})

    logger.info("Agent claim: %s claimed by %s", body.agent_id, body.contact_email)
    return {
        "status": "claimed",
        "agent_id": body.agent_id,
        "message": "Claim submitted. We'll verify and update your listing.",
    }


@router.post("/api/admin/outreach", response_model=dict[str, Any])
async def send_outreach(request: Request, body: OutreachRequest) -> dict[str, Any]:
    """Admin endpoint to send trust score outreach to a specific agent contact."""
    admin_key = request.headers.get("X-Admin-Key", "")
    if admin_key != os.getenv("ADMIN_API_KEY", "agentry-admin-2026"):
        raise HTTPException(status_code=403, detail="Unauthorized")

    store = _get_store(request)
    agent = store.get_agent(body.agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")

    store.update_agent_trust(body.agent_id, {"contact_email": body.contact_email})
    agent["contact_email"] = body.contact_email

    from email_service import send_trust_score_outreach
    asyncio.create_task(send_trust_score_outreach(agent))

    return {"status": "sent", "agent_id": body.agent_id, "email": body.contact_email}

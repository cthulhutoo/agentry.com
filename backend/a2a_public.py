"""A2A-compatible /agents/public open discovery endpoint.

Implements the proposed A2A Registry standard (GitHub Discussion #741):
  GET /api/agents/public — returns agent cards for open discovery
  GET /api/agents/public/{agent_id} — returns a single agent card

This makes every agent in the Agentry directory discoverable by any
A2A-compatible agent or orchestrator.
"""

from __future__ import annotations

import hashlib
import logging
from typing import Any

from fastapi import APIRouter, Query, Request, HTTPException
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/agents", tags=["a2a-public"])


def _agent_to_a2a_card(agent: dict[str, Any]) -> dict[str, Any]:
    """Convert an Agentry agent listing into an A2A-compatible Agent Card."""
    # If the agent already has a stored A2A card, use it as the base
    stored_card = agent.get("agent_card")
    if stored_card and isinstance(stored_card, dict):
        card = {
            "name": stored_card.get("name", agent.get("name", "")),
            "description": stored_card.get("description", agent.get("description", "")),
            "url": stored_card.get("url", agent.get("url", "")),
            "provider": stored_card.get("provider", {
                "organization": "Unknown",
                "url": agent.get("url", "")
            }),
            "version": stored_card.get("version", "1.0.0"),
            "protocolVersion": stored_card.get("protocolVersion", "0.2.0"),
            "capabilities": stored_card.get("capabilities", {}),
            "skills": stored_card.get("skills", []),
            "defaultInputModes": stored_card.get("defaultInputModes", ["text"]),
            "defaultOutputModes": stored_card.get("defaultOutputModes", ["text"]),
        }
        if stored_card.get("authentication"):
            card["authentication"] = stored_card["authentication"]
    else:
        # Build a card from the directory listing metadata
        skills = []
        if agent.get("key_features"):
            for i, feat in enumerate(agent["key_features"].split(",")):
                feat = feat.strip()
                if feat:
                    skills.append({
                        "id": f"skill-{i}",
                        "name": feat,
                        "description": feat,
                        "inputModes": ["text"],
                        "outputModes": ["text"],
                    })

        card = {
            "name": agent.get("name", ""),
            "description": agent.get("description", ""),
            "url": agent.get("url", ""),
            "provider": {
                "organization": agent.get("name", "Unknown"),
                "url": agent.get("url", ""),
            },
            "version": "1.0.0",
            "protocolVersion": "0.2.0",
            "capabilities": {
                "streaming": False,
                "pushNotifications": False,
                "stateTransitionHistory": False,
            },
            "skills": skills,
            "defaultInputModes": ["text"],
            "defaultOutputModes": ["text"],
        }

    # Add Agentry metadata extensions
    agentry_meta: dict[str, Any] = {
        "agentryId": agent.get("id", ""),
        "category": agent.get("category", "Uncategorized"),
        "pricingModel": agent.get("pricing_model", "Unknown"),
        "startingPrice": agent.get("starting_price", "Unknown"),
        "integrations": agent.get("integrations", ""),
        "trustScore": agent.get("trust_score", 0.0),
        "trustTier": agent.get("trust_tier", "unverified"),
        "verificationStatus": agent.get("verification_status", "unverified"),
        "a2aSupport": agent.get("a2a_support", "Unknown"),
        "mcpSupport": agent.get("mcp_support", "Unknown"),
        "directoryUrl": f"https://agentry.com/#agent-{agent.get('id', '')}",
    }
    # Include verified endpoint paths so consuming agents can skip probing
    if agent.get("a2a_endpoint"):
        agentry_meta["a2aEndpoint"] = agent["a2a_endpoint"]
    if agent.get("mcp_endpoint"):
        agentry_meta["mcpEndpoint"] = agent["mcp_endpoint"]
    card["x-agentry"] = agentry_meta

    return card


def _make_cursor(offset: int) -> str:
    """Create a simple opaque cursor from an offset."""
    return hashlib.md5(f"agentry-cursor-{offset}".encode()).hexdigest()[:12] + f"-{offset}"


def _parse_cursor(cursor: str) -> int:
    """Extract offset from cursor string."""
    try:
        return int(cursor.split("-")[-1])
    except (ValueError, IndexError):
        return 0


@router.get("/public")
async def a2a_public_discovery(
    request: Request,
    q: str | None = Query(default=None, description="Search query to filter agents"),
    category: str | None = Query(default=None, description="Filter by category"),
    limit: int = Query(default=50, ge=1, le=200, alias="top"),
    cursor: str | None = Query(default=None, description="Pagination cursor"),
) -> JSONResponse:
    """A2A-compatible open discovery endpoint.

    Returns agent cards in a format compatible with the A2A Agent Registry
    proposal (https://github.com/a2aproject/A2A/discussions/741).
    """
    store = request.app.state.store
    offset = _parse_cursor(cursor) if cursor else 0

    if q:
        agents, total = store.search_agents(query=q, category=category, limit=limit, offset=offset)
    else:
        agents, total = store.list_agents(category=category, limit=limit, offset=offset)

    cards = [_agent_to_a2a_card(a) for a in agents]

    # Build pagination metadata
    next_offset = offset + limit
    metadata = {
        "totalAgents": total,
        "returned": len(cards),
        "offset": offset,
    }
    if next_offset < total:
        metadata["nextCursor"] = _make_cursor(next_offset)

    return JSONResponse(
        content={
            "agents": cards,
            "metadata": metadata,
        },
        headers={
            "Content-Type": "application/json",
            "Cache-Control": "public, max-age=300",
            "Access-Control-Allow-Origin": "*",
        }
    )


@router.get("/public/{agent_id}")
async def a2a_public_agent_card(
    request: Request,
    agent_id: str,
) -> JSONResponse:
    """Return a single agent's A2A card by ID."""
    store = request.app.state.store
    agent = store.get_agent(agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")

    card = _agent_to_a2a_card(agent)
    return JSONResponse(
        content=card,
        headers={
            "Content-Type": "application/json",
            "Cache-Control": "public, max-age=300",
            "Access-Control-Allow-Origin": "*",
        }
    )

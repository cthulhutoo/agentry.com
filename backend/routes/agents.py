"""Agent directory endpoints with spam filtering."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from fastapi import APIRouter, Path, Query, Request, HTTPException

from models import AgentListing, AgentRegistration, CategoryCount
from email_service import send_agent_registration_confirmation, send_agent_registration_admin
from spam_filter import check_agent_registration

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/agents", tags=["agents"])


def _get_store(request: Request):
    return request.app.state.store


def _get_client_ip(request: Request) -> str:
    """Extract client IP from request, respecting proxy headers."""
    forwarded = request.headers.get("X-Forwarded-For", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    real_ip = request.headers.get("X-Real-IP", "")
    if real_ip:
        return real_ip
    return request.client.host if request.client else ""


@router.get("", response_model=dict[str, Any])
async def list_agents(
    request: Request,
    category: str | None = Query(default=None, description="Filter agents by category name (e.g. 'Sales & Outreach', 'Customer Support', 'Development Tools'). Returns all categories if omitted."),
    limit: int = Query(default=20, ge=1, le=500, description="Maximum number of agents to return per page. Range: 1-100."),
    offset: int = Query(default=0, ge=0, description="Number of agents to skip for pagination. Use with limit for paging."),
) -> dict[str, Any]:
    """List AI agents in the Agentry directory with optional filtering and pagination.

    Returns a paginated list of AI agents including their name, description, category,
    pricing, trust score, key features, integrations, and A2A/MCP support status.
    The directory contains 122+ agents across 11 categories."""
    store = _get_store(request)
    items, total = store.list_agents(category=category, limit=limit, offset=offset)
    return {"items": items, "total": total, "limit": limit, "offset": offset}


@router.get("/search", response_model=dict[str, Any])
async def search_agents(
    request: Request,
    q: str = Query(default="", description="Search keyword to match against agent name, description, features, and integrations. Examples: 'customer support', 'slack', 'code review', 'sales automation'."),
    category: str | None = Query(default=None, description="Optionally narrow search results to a specific category (e.g. 'Sales & Outreach', 'Customer Support')."),
    limit: int = Query(default=20, ge=1, le=500, description="Maximum number of search results to return. Range: 1-100."),
    offset: int = Query(default=0, ge=0, description="Number of results to skip for pagination."),
) -> dict[str, Any]:
    """Search the Agentry AI agent directory by keyword.

    Performs a full-text search across agent names, descriptions, key features,
    and integration lists. Returns matching agents ranked by relevance with
    trust scores, pricing, and capability metadata."""
    store = _get_store(request)
    if not q.strip():
        items, total = store.list_agents(category=category, limit=limit, offset=offset)
    else:
        items, total = store.search_agents(query=q, category=category, limit=limit, offset=offset)
    return {"items": items, "total": total, "limit": limit, "offset": offset}


@router.get("/categories", response_model=list[CategoryCount])
async def list_categories(request: Request) -> list[dict[str, Any]]:
    """List all agent categories with counts.

    Returns every category in the directory along with the number of agents
    in each. Useful for building category filters or understanding the
    directory's coverage areas."""
    store = _get_store(request)
    return store.get_categories()


@router.get("/{agent_id}", response_model=dict[str, Any])
async def get_agent(request: Request, agent_id: str = Path(description="The unique agent identifier, e.g. 'agent-0001'. Found in search/list results.")) -> dict[str, Any]:
    """Get full details for a specific AI agent by ID.

    Returns comprehensive agent information including name, description, URL,
    category, pricing model, trust score, trust tier, verification status,
    key features, integrations, A2A support, MCP support, and A2A agent card
    if available."""
    store = _get_store(request)
    agent = store.get_agent(agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")
    return agent


@router.post("/register", response_model=dict[str, Any], status_code=201)
async def register_agent(request: Request, body: AgentRegistration) -> dict[str, Any]:
    """Register a new AI agent in the Agentry directory.

    Submit an AI agent for listing. The agent will be added immediately and
    appear in search results. Optional fields like pricing, features, and
    integrations improve discoverability. An A2A discovery scan will be
    triggered automatically if the agent URL is reachable."""
    # --- Spam check ---
    client_ip = _get_client_ip(request)
    form_dict = body.model_dump()
    spam_result = check_agent_registration(form_dict, client_ip=client_ip)
    if spam_result:
        logger.info("Spam blocked (agent registration) from %s: %s", client_ip, spam_result.reason)
        raise HTTPException(status_code=422, detail=spam_result.reason)

    store = _get_store(request)
    listing = AgentListing(
        name=body.name,
        url=body.url,
        category=body.category,
        description=body.description,
        pricing_model=body.pricing_model,
        starting_price=body.starting_price,
        key_features=body.key_features,
        integrations=body.integrations,
        a2a_support=body.a2a_support,
        mcp_support=body.mcp_support,
    )
    data = listing.model_dump(mode="json")
    data["contact_email"] = body.contact_email
    store.add_agent(data)
    logger.info("Registered new agent: %s (%s)", body.name, listing.id)

    # Send emails in background
    asyncio.create_task(_send_registration_emails(data))

    return data


async def _send_registration_emails(agent_data: dict) -> None:
    """Send confirmation to developer + admin notification."""
    try:
        await asyncio.gather(
            send_agent_registration_confirmation(agent_data),
            send_agent_registration_admin(agent_data),
        )
    except Exception as e:
        logger.error("Registration email send failed: %s", e)

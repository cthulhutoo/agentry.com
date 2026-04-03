"""/.well-known/agents.json endpoint — machine-readable API descriptor for LLM agents."""

from __future__ import annotations

import json
import logging
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)

router = APIRouter(tags=["agents-json"])


def _build_agents_json(request: Request) -> dict[str, Any]:
    """Build the agents.json descriptor dynamically from current data."""
    store = request.app.state.store
    agents_list, total = store.list_agents(limit=1000, offset=0)
    categories = store.get_categories()

    base_url = "https://api.agentry.com"

    return {
        "name": "Agentry",
        "description": "The AI Agent Directory — discover, compare, and integrate AI agents for any business need. A vendor-neutral registry of 120+ AI agents across 12 categories.",
        "url": "https://agentry.com",
        "version": "1.0.0",
        "protocol": "agents-json/1.0",
        "contact": {
            "email": "hello@agentry.com",
            "url": "https://agentry.com"
        },
        "capabilities": [
            {
                "id": "search_agents",
                "name": "Search AI Agents",
                "description": "Search the Agentry directory for AI agents by keyword, category, or capability. Returns structured agent listings with metadata.",
                "endpoint": f"{base_url}/api/agents/search",
                "method": "GET",
                "parameters": [
                    {
                        "name": "q",
                        "type": "string",
                        "required": False,
                        "description": "Search query — matches against agent name, description, features, category, and integrations"
                    },
                    {
                        "name": "category",
                        "type": "string",
                        "required": False,
                        "description": f"Filter by category. Options: {', '.join(c['category'] for c in categories)}"
                    },
                    {
                        "name": "limit",
                        "type": "integer",
                        "required": False,
                        "description": "Max results to return (1-100, default 20)"
                    },
                    {
                        "name": "offset",
                        "type": "integer",
                        "required": False,
                        "description": "Pagination offset (default 0)"
                    }
                ],
                "returns": {
                    "type": "object",
                    "properties": {
                        "items": "Array of agent objects with id, name, url, category, description, pricing_model, key_features, integrations, a2a_support, mcp_support, trust_score, trust_tier",
                        "total": "Total matching agents",
                        "limit": "Page size",
                        "offset": "Current offset"
                    }
                },
                "examples": [
                    {"query": "GET /api/agents/search?q=customer+service&limit=5", "description": "Find top 5 customer service agents"},
                    {"query": "GET /api/agents/search?category=Sales+%26+Outreach", "description": "List all sales agents"},
                    {"query": "GET /api/agents/search?q=slack+integration", "description": "Find agents that integrate with Slack"}
                ]
            },
            {
                "id": "list_agents",
                "name": "List All Agents",
                "description": "Retrieve the full agent directory with optional category filtering and pagination.",
                "endpoint": f"{base_url}/api/agents",
                "method": "GET",
                "parameters": [
                    {"name": "category", "type": "string", "required": False, "description": "Filter by category"},
                    {"name": "limit", "type": "integer", "required": False, "description": "Max results (1-100, default 20)"},
                    {"name": "offset", "type": "integer", "required": False, "description": "Pagination offset"}
                ]
            },
            {
                "id": "get_agent",
                "name": "Get Agent Details",
                "description": "Retrieve full details for a specific agent by ID, including trust score, A2A card data, and verification status.",
                "endpoint": f"{base_url}/api/agents/{{agent_id}}",
                "method": "GET",
                "parameters": [
                    {"name": "agent_id", "type": "string", "required": True, "description": "The agent's unique ID"}
                ]
            },
            {
                "id": "list_categories",
                "name": "List Categories",
                "description": "Get all agent categories with counts.",
                "endpoint": f"{base_url}/api/agents/categories",
                "method": "GET"
            },
            {
                "id": "a2a_discovery",
                "name": "A2A Agent Discovery",
                "description": "Open discovery endpoint compatible with Google's A2A protocol. Returns agent cards for all agents in the registry.",
                "endpoint": f"{base_url}/api/agents/public",
                "method": "GET",
                "parameters": [
                    {"name": "q", "type": "string", "required": False, "description": "Search query to filter agents"},
                    {"name": "category", "type": "string", "required": False, "description": "Filter by category"},
                    {"name": "limit", "type": "integer", "required": False, "description": "Max results (default 50)"},
                    {"name": "cursor", "type": "string", "required": False, "description": "Pagination cursor"}
                ]
            },
            {
                "id": "register_agent",
                "name": "Register an Agent",
                "description": "Submit a new AI agent for listing in the directory. Requires name and URL at minimum.",
                "endpoint": f"{base_url}/api/agents/register",
                "method": "POST",
                "parameters": [
                    {"name": "name", "type": "string", "required": True, "description": "Agent name"},
                    {"name": "url", "type": "string", "required": True, "description": "Agent URL"},
                    {"name": "category", "type": "string", "required": False, "description": "Agent category"},
                    {"name": "description", "type": "string", "required": False, "description": "What the agent does"},
                    {"name": "pricing_model", "type": "string", "required": False, "description": "Pricing model (e.g. Subscription, Per-outcome, Free)"},
                    {"name": "contact_email", "type": "string", "required": False, "description": "Developer contact email"}
                ]
            }
        ],
        "stats": {
            "total_agents": total,
            "categories": len(categories),
            "category_list": [c["category"] for c in categories]
        }
    }


@router.get("/.well-known/agents.json")
async def well_known_agents_json(request: Request) -> JSONResponse:
    """Serve the agents.json descriptor at the well-known location."""
    data = _build_agents_json(request)
    return JSONResponse(
        content=data,
        headers={
            "Content-Type": "application/json",
            "Cache-Control": "public, max-age=3600",
            "Access-Control-Allow-Origin": "*",
        }
    )

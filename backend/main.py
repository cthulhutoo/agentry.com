"""Agentry Backend — FastAPI application entry point."""

from __future__ import annotations

import logging
import os

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from database import DataStore
from routes.agents import router as agents_router
from routes.broker import router as broker_router
from routes.scanner import router as scanner_router
from routes.payments import router as payments_router
from routes.payments_ecash import router as ecash_router
from routes.registry import router as registry_router
from routes.identity import router as identity_router
from routes.reputation import router as reputation_router
from routes.escrow import router as escrow_router
from routes.observability import router as observability_router
from routes.certification import router as certification_router
from routes.lightning import router as lightning_router
from routes.enterprise import router as enterprise_router
from routes.outreach import router as outreach_router
from routes.discovery import router as discovery_router
from routes.llms_txt import router as llms_txt_router
from routes.mcp_verify import router as mcp_verify_router
from routes.security_scan import router as security_scan_router
from routes.stripe_payments import router as stripe_payments_router
from routes.provisioning import router as provisioning_router
from routes.invoke import router as invoke_router
from routes.wallets import router as wallets_router
from routes.escrow_memory import router as escrow_memory_router
from routes.quickstart import router as quickstart_router
from agents_json import router as agents_json_router
from a2a_public import router as a2a_public_router
from analytics import router as analytics_router, AnalyticsMiddleware
from badges import router as badges_router
from fastapi_mcp import FastApiMCP
from fastapi.responses import JSONResponse, PlainTextResponse, RedirectResponse

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

ALLOWED_ORIGINS = os.getenv(
    "ALLOWED_ORIGINS",
    "https://agentry.com,https://www.agentry.com,http://localhost:3000",
).split(",")

app = FastAPI(
    title="Agentry API",
    description="AI Agent Registry and Discovery service — browse, search, and register AI agents. Machine-readable via /llms.txt, /.well-known/agents.json, and /api/agents/public (A2A).",
    version="0.4.0",
)

# --- CORS ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Analytics middleware (logs discovery endpoint traffic) ---
app.add_middleware(AnalyticsMiddleware)

# --- Shared data store (injected via app.state) ---
app.state.store = DataStore()

# --- Routers ---
# IMPORTANT: a2a_public_router must come BEFORE agents_router
# because /api/agents/public must match before /api/agents/{agent_id}
app.include_router(a2a_public_router)
app.include_router(agents_router)
app.include_router(broker_router)
app.include_router(scanner_router)
app.include_router(payments_router)
app.include_router(ecash_router)
app.include_router(registry_router)
app.include_router(identity_router)
app.include_router(reputation_router)
app.include_router(escrow_router)
app.include_router(observability_router)
app.include_router(certification_router)
app.include_router(lightning_router)
app.include_router(enterprise_router)
app.include_router(outreach_router)
app.include_router(discovery_router)
app.include_router(security_scan_router)
app.include_router(stripe_payments_router)
app.include_router(provisioning_router)
app.include_router(invoke_router)
app.include_router(wallets_router)
app.include_router(quickstart_router)
app.include_router(escrow_memory_router)

# --- Agentic discovery routers ---
app.include_router(llms_txt_router)
app.include_router(agents_json_router)
app.include_router(mcp_verify_router)
app.include_router(analytics_router)
app.include_router(badges_router)

# --- MCP SSE Server (auto-exposes API endpoints as MCP tools) ---
mcp = FastApiMCP(
    app,
    name="Agentry MCP",
    description="AI Agent Registry and Discovery — search, register, and evaluate 122+ AI agents across 11 categories. Features trust scoring, A2A protocol support, Cashu ecash payment rails, and programmatic agent registration. No authentication required.",
    include_tags=[
        "agents",        # search, list, get, register, categories
        "a2a-public",    # A2A discovery endpoints
        "broker",        # broker intake (submit/check)
        "ecash",         # ecash payment tools
        "scanner",       # A2A agent card scanner
        "registry",      # trust scores, card history, registry stats
        "badges",        # agent trust badges
    ],
    # Exclude internal/admin endpoints: outreach, discovery, analytics, health,
    # enterprise (auth required), payments (Stripe webhooks), llms-txt, agents-json
)
# Mount both Streamable HTTP (recommended) and SSE (backwards compat)
mcp.mount_http()  # Streamable HTTP at /mcp (Smithery, modern clients)
mcp.mount_sse(mount_path="/mcp/sse")  # SSE at /mcp/sse (legacy clients)







# --- A2A Agent Card: /.well-known/agent.json (singular — Google A2A spec) ---
# PREA-DiscoveryEngine, AWS Bedrock AgentCore, and other A2A clients expect this.
@app.get("/.well-known/agent.json", tags=["discovery"], include_in_schema=False)
async def well_known_agent_json() -> JSONResponse:
    """A2A Agent Card — describes Agentry as a discoverable A2A-compatible agent."""
    card = {
        "name": "Agentry",
        "description": "AI Agent Directory — discover, search, compare, and register AI agents. 122+ agents across 11 categories with trust scores, A2A support, MCP tools, and ecash payment rails.",
        "url": "https://api.agentry.com",
        "version": "0.4.0",
        "protocolVersion": "0.2.0",
        "provider": {
            "organization": "Agentry",
            "url": "https://agentry.com"
        },
        "capabilities": {
            "streaming": True,
            "pushNotifications": False,
            "stateTransitionHistory": False,
        },
        "defaultInputModes": ["text/plain", "application/json"],
        "defaultOutputModes": ["text/plain", "application/json"],
        "skills": [
            {
                "id": "search_agents",
                "name": "Search AI Agents",
                "description": "Search the Agentry directory for AI agents by keyword, category, or capability. Returns structured agent listings with trust scores, pricing, and integration data.",
                "inputModes": ["text/plain", "application/json"],
                "outputModes": ["application/json"],
                "examples": [
                    "Find customer service agents",
                    "Search for agents that support Slack integration",
                    "List all sales and outreach agents"
                ],
                "tags": ["search", "directory", "agents", "discovery"]
            },
            {
                "id": "get_agent_details",
                "name": "Get Agent Details",
                "description": "Retrieve full details for a specific agent including trust score, A2A card, verification status, pricing, features, and integrations.",
                "inputModes": ["application/json"],
                "outputModes": ["application/json"],
                "tags": ["lookup", "details", "trust"]
            },
            {
                "id": "register_agent",
                "name": "Register an Agent",
                "description": "Submit a new AI agent for listing in the Agentry directory. Provide name, URL, and capabilities.",
                "inputModes": ["application/json"],
                "outputModes": ["application/json"],
                "tags": ["register", "submit", "listing"]
            },
            {
                "id": "a2a_discovery",
                "name": "A2A Agent Discovery",
                "description": "Open discovery endpoint compatible with Google A2A protocol. Returns agent cards for all agents in the registry.",
                "inputModes": ["text/plain"],
                "outputModes": ["application/json"],
                "tags": ["a2a", "discovery", "protocol"]
            },
            {
                "id": "ecash_payments",
                "name": "Ecash Payment Rails",
                "description": "Cashu ecash payment endpoints for agent-to-agent transactions. Send and receive tokens, verify payments, and check balances.",
                "inputModes": ["application/json"],
                "outputModes": ["application/json"],
                "tags": ["payments", "ecash", "cashu", "lightning"]
            }
        ],
        "securitySchemes": {
            "none": {
                "type": "none",
                "description": "Public read endpoints require no authentication"
            }
        },
        "supportsAuthenticatedExtendedCard": False
    }
    return JSONResponse(
        content=card,
        headers={
            "Content-Type": "application/json",
            "Cache-Control": "public, max-age=3600",
            "Access-Control-Allow-Origin": "*",
        }
    )


# --- A2A Agent Card alias: /.well-known/agent-card.json ---
# Some A2A implementations use this path instead of agent.json
@app.get("/.well-known/agent-card.json", tags=["discovery"], include_in_schema=False)
async def well_known_agent_card_json() -> JSONResponse:
    """Alias for A2A Agent Card at the alternate well-known path."""
    return await well_known_agent_json()


# --- MCP Discovery: /.well-known/mcp ---
# Proposed standard for MCP server metadata discovery.
@app.get("/.well-known/mcp", tags=["discovery"], include_in_schema=False)
async def well_known_mcp() -> JSONResponse:
    """MCP server metadata discovery endpoint."""
    metadata = {
        "mcp_version": "1.0",
        "server_name": "Agentry MCP",
        "server_version": "0.3.0",
        "description": "AI Agent Registry and Discovery — search, register, and evaluate AI agents. Exposes agent directory, trust data, payment rails, and discovery endpoints as MCP tools.",
        "endpoints": {
            "sse": "https://api.agentry.com/mcp",
        },
        "capabilities": {
            "tools": True,
            "resources": False,
            "prompts": False,
            "sampling": False,
        },
        "authentication": {
            "required": False,
            "methods": ["none"],
        },
        "rate_limits": {
            "requests_per_minute": 60,
        },
        "documentation": "https://api.agentry.com/docs",
        "terms_of_service": "https://agentry.com/terms",
    }
    return JSONResponse(
        content=metadata,
        headers={
            "Content-Type": "application/json",
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "max-age=3600",
            "Access-Control-Allow-Origin": "*",
        }
    )




# --- Smithery Server Card: /.well-known/mcp/server-card.json ---

@app.get("/.well-known/mcp/server-card.json", tags=["discovery"], include_in_schema=False)
async def well_known_mcp_server_card():
    """Smithery-compatible MCP Server Card for auto-discovery."""
    return {
        "name": "Agentry — AI Agent Registry & Discovery",
        "description": "Search, register, and evaluate 122+ AI agents across 11 categories. Trust scoring, A2A protocol, MCP tools, and Cashu ecash payment rails.",
        "version": "0.4.0",
        "homepage": "https://agentry.com",
        "documentation": "https://api.agentry.com/docs",
        "transport": [
            {"type": "streamable-http", "url": "https://api.agentry.com/mcp"},
            {"type": "sse", "url": "https://api.agentry.com/mcp/sse"}
        ],
        "capabilities": {
            "tools": True,
            "resources": False,
            "prompts": False
        },
        "auth": {
            "type": "none"
        },
        "contacts": {
            "email": "hello@agentry.com",
            "website": "https://agentry.com"
        }
    }



# --- NIP-05: /.well-known/nostr.json ---

@app.get("/.well-known/nostr.json", tags=["discovery"], include_in_schema=False)
async def well_known_nostr_json(request: Request, name: str = ""):
    """NIP-05 Nostr identity verification endpoint.

    Returns the mapping of names to Nostr public keys for agents
    registered with Agentry. Enables human-readable Nostr identifiers
    like agent-name@agentry.com.
    """
    store = request.app.state.store

    # Merge manually-registered identities and provisioned identities
    identities = store.list_all_identities()
    provisioned = store.list_provisioned_identities()

    names = {}
    # Add from identities collection
    for ident in identities:
        nip05_name = ident.get("nip05_name", "")
        pubkey_hex = ident.get("pubkey_hex", "")
        if nip05_name and pubkey_hex:
            names[nip05_name] = pubkey_hex

    # Add from provisioned identities (may overlap — provisioned take precedence)
    for prov in provisioned:
        nip05_name = prov.get("nip05_name", "")
        pubkey_hex = prov.get("pubkey_hex", "")
        if nip05_name and pubkey_hex:
            names[nip05_name] = pubkey_hex

    # Build relays mapping — every registered agent uses our relay
    relays = {}
    for pubkey_hex in names.values():
        if pubkey_hex:
            relays[pubkey_hex] = ["wss://relay.agentry.com"]

    # If a specific name is requested, filter
    if name and name in names:
        result = {"names": {name: names[name]}}
        if names.get(name) in relays:
            result["relays"] = {names[name]: relays[names[name]]}
        return result

    return {"names": names, "relays": relays}


# --- OpenAI ChatGPT Plugin Manifest: /.well-known/ai-plugin.json ---

@app.get("/.well-known/ai-plugin.json", tags=["discovery"], include_in_schema=False)
async def well_known_ai_plugin():
    """OpenAI ChatGPT plugin manifest for AI agent discovery."""
    return {
        "schema_version": "v1",
        "name_for_human": "Agentry",
        "name_for_model": "agentry",
        "description_for_human": "Search and discover AI agents. Browse 122+ agents across 11 categories with trust scores, reputation, and live health checks.",
        "description_for_model": "Search and discover AI agents in the Agentry registry. You can search by keyword, category, or capability. Each agent has trust scores, reputation data, pricing, and protocol support (A2A, MCP, Nostr). Use this to find the right AI agent for any task.",
        "auth": {"type": "none"},
        "api": {
            "type": "openapi",
            "url": "https://api.agentry.com/openapi.json"
        },
        "logo_url": "https://agentry.com/favicon.svg",
        "contact_email": "hello@agentry.com",
        "legal_info_url": "https://agentry.com"
    }

# --- Glama.ai index: /.well-known/glama.json ---
@app.get("/.well-known/glama.json", tags=["discovery"], include_in_schema=False)
async def well_known_glama_json() -> JSONResponse:
    """Glama.ai MCP server metadata for directory indexing."""
    glama = {
        "$schema": "https://glama.ai/mcp/schemas/server.json",
        "name": "agentry-mcp",
        "description": "AI Agent Directory — search, register, and evaluate 122+ AI agents across 11 categories. Exposes agent discovery, trust scoring, A2A protocol, and ecash payment rails as MCP tools.",
        "type": "mcp_server",
        "status": "stable",
        "framework": "FastAPI + fastapi-mcp",
        "tools": 59,
        "transport": ["sse"],
        "keywords": [
            "agents",
            "directory",
            "registry",
            "a2a",
            "mcp-server",
            "discovery",
            "trust-score",
            "ecash",
            "cashu",
            "payments",
            "agent-to-agent",
            "llms-txt"
        ],
        "features": {
            "agent_directory": {
                "enabled": True,
                "total_agents": 122,
                "categories": 11,
                "note": "Vendor-neutral AI agent registry with trust scoring"
            },
            "a2a_protocol": {
                "enabled": True,
                "note": "Google A2A-compatible agent cards and discovery"
            },
            "ecash_payments": {
                "enabled": True,
                "note": "Cashu ecash payment rails for agent-to-agent transactions"
            },
            "discovery_protocols": {
                "enabled": True,
                "protocols": ["MCP SSE", "A2A", "agents.json", "llms.txt"],
                "note": "Multi-protocol agent discovery"
            }
        }
    }
    return JSONResponse(
        content=glama,
        headers={
            "Content-Type": "application/json",
            "Cache-Control": "public, max-age=3600",
            "Access-Control-Allow-Origin": "*",
        }
    )


# --- robots.txt ---
@app.get("/robots.txt", tags=["discovery"], include_in_schema=False)
async def robots_txt() -> PlainTextResponse:
    content = """# Agentry API — https://api.agentry.com
# Welcome! Machine-readable discovery endpoints are open.

User-agent: *
Allow: /api/agents/public
Allow: /.well-known/agents.json
Allow: /.well-known/agent.json
Allow: /.well-known/agent-card.json
Allow: /.well-known/mcp
Allow: /.well-known/mcp/server-card.json
Allow: /.well-known/mcp-registry-auth
Allow: /.well-known/glama.json
Allow: /llms.txt
Allow: /mcp
Allow: /
Disallow: /api/admin/
Disallow: /api/payments/webhook

# MCP SSE endpoint for agent tools
# Connect via: https://api.agentry.com/mcp

# Sitemaps
Sitemap: https://agentry.com/sitemap.xml

# Crawl-delay for non-priority bots
User-agent: AhrefsBot
Crawl-delay: 10

User-agent: SemrushBot
Crawl-delay: 10
"""
    return PlainTextResponse(content=content, media_type="text/plain")


@app.get("/", tags=["health"])
async def health_check() -> dict:
    """Health check endpoint."""
    return {
        "status": "ok",
        "service": "agentry-api",
        "version": "0.4.0",
        "discovery": {
            "llms_txt": "/llms.txt",
            "agents_json": "/.well-known/agents.json",
            "agent_card": "/.well-known/agent.json",
            "mcp": "/.well-known/mcp",
            "mcp_sse": "/mcp",
            "a2a_public": "/api/agents/public",
            "openapi": "/openapi.json",
            "docs": "/docs",
        },
    }

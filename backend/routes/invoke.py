"""Task Invocation System — the critical bridge that lets agents call other agents THROUGH Agentry.

Three subsystems:
1. **Capability Schemas** — Agents describe their callable interfaces
2. **Task Invocation Proxy** — Route calls between agents, handle auth, return results
3. **Budget Controls** — Humans set spending limits on their agents

The invocation proxy is the core: it validates targets, checks budgets,
forwards requests via httpx, creates escrow micro-contracts for paid
capabilities, records invocation history, and updates reputation.
"""

from __future__ import annotations

import logging
import os
import time
import uuid
from datetime import datetime, timezone
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException, Header, Query, Request
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/invoke", tags=["invoke"])

ADMIN_KEY = os.getenv("ADMIN_KEY", "agentry-admin-2026")
PLATFORM_FEE_PERCENT = 10  # 10% platform fee on paid invocations


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _check_admin(key: str) -> None:
    if key != ADMIN_KEY:
        raise HTTPException(status_code=403, detail="Invalid admin key")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _refund_reserve(store, caller_agent_id: str, amount_sats: int, invocation_id: str, reason: str) -> None:
    """Refund a reserved (pre-debited) amount back to the caller wallet."""
    try:
        store.credit_wallet(caller_agent_id, amount_sats, {
            "type": "invocation_refund",
            "invocation_id": invocation_id,
            "reason": reason,
        })
        logger.info("Refunded %d sats to %s for invocation %s: %s", amount_sats, caller_agent_id, invocation_id, reason)
    except Exception as refund_exc:
        logger.error("CRITICAL: Failed to refund %d sats to %s for invocation %s: %s", amount_sats, caller_agent_id, invocation_id, refund_exc)


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class CapabilityDef(BaseModel):
    id: str = Field(..., description="Unique capability identifier, e.g. 'search-documents'")
    name: str = Field(..., description="Human-readable name")
    description: str = Field(default="", description="What this capability does")
    endpoint: str = Field(..., description="Path on the agent's server, e.g. '/api/search'")
    method: str = Field(default="POST", description="HTTP method (GET, POST, etc.)")
    inputs: dict[str, Any] = Field(default_factory=dict, description="Input parameter definitions")
    outputs: dict[str, Any] = Field(default_factory=dict, description="Output field definitions")
    pricing: dict[str, Any] = Field(default_factory=dict, description="Pricing info, e.g. {'per_request_sats': 10}")


class CapabilitySchemaRequest(BaseModel):
    capabilities: list[CapabilityDef] = Field(..., min_length=1, description="List of capability definitions")


class InvocationRequest(BaseModel):
    capability: str = Field(..., description="Capability ID to invoke, e.g. 'search-documents'")
    input: dict[str, Any] = Field(default_factory=dict, description="Input payload for the capability")
    caller_agent_id: str = Field(..., description="Agent ID of the caller")
    budget_sats: int | None = Field(default=None, description="Max sats the caller is willing to spend")
    callback_url: str | None = Field(default=None, description="Optional webhook for async results")
    timeout_seconds: int = Field(default=30, ge=1, le=120, description="Request timeout in seconds")


class BudgetControlRequest(BaseModel):
    agent_id: str = Field(..., description="Agent ID to set budget controls for")
    max_per_invocation_sats: int = Field(default=1000, ge=0)
    max_per_day_sats: int = Field(default=10000, ge=0)
    max_per_month_sats: int = Field(default=100000, ge=0)
    whitelist_agents: list[str] = Field(default_factory=list, description="Only allow calls to these agents (empty = allow all)")
    blacklist_agents: list[str] = Field(default_factory=list, description="Block calls to these agents")
    require_approval_above_sats: int = Field(default=500, ge=0, description="Require approval for invocations above this cost")
    enabled: bool = Field(default=True)


# ===========================================================================
# IMPORTANT: Static routes MUST be defined BEFORE the dynamic /{agent_id}
# route, otherwise FastAPI will match "budget", "history", "schema" as
# agent_id values.
# ===========================================================================


# ===========================================================================
# Part 3: Budget Controls (static routes — must come first)
# ===========================================================================

@router.post("/budget")
async def set_budget(
    body: BudgetControlRequest,
    request: Request,
    x_admin_key: str = Header(..., alias="X-Admin-Key"),
) -> dict[str, Any]:
    """Set budget controls for a calling agent. Requires admin key."""
    _check_admin(x_admin_key)

    store = request.app.state.store

    budget_data = {
        "agent_id": body.agent_id,
        "max_per_invocation_sats": body.max_per_invocation_sats,
        "max_per_day_sats": body.max_per_day_sats,
        "max_per_month_sats": body.max_per_month_sats,
        "whitelist_agents": body.whitelist_agents,
        "blacklist_agents": body.blacklist_agents,
        "require_approval_above_sats": body.require_approval_above_sats,
        "enabled": body.enabled,
        "updated_at": _now_iso(),
    }

    existing = store.get_budget(body.agent_id)
    if existing:
        budget_data["created_at"] = existing.get("created_at", _now_iso())
    else:
        budget_data["created_at"] = _now_iso()

    store.set_budget(body.agent_id, budget_data)

    return {
        "status": "updated" if existing else "created",
        "budget": budget_data,
    }


@router.get("/budget/{agent_id}")
async def get_budget(
    agent_id: str,
    request: Request,
) -> dict[str, Any]:
    """Return current budget controls for an agent."""
    store = request.app.state.store
    budget = store.get_budget(agent_id)
    if not budget:
        return {
            "agent_id": agent_id,
            "budget": None,
            "message": "No budget controls set for this agent. All invocations are unrestricted.",
        }
    return {"agent_id": agent_id, "budget": budget}


@router.get("/budget/{agent_id}/spending")
async def get_spending(
    agent_id: str,
    request: Request,
) -> dict[str, Any]:
    """Return current spending against limits for an agent."""
    store = request.app.state.store

    today_sats = store.get_spending(agent_id, period="day")
    month_sats = store.get_spending(agent_id, period="month")

    budget = store.get_budget(agent_id)
    max_day = budget.get("max_per_day_sats", 0) if budget else 0
    max_month = budget.get("max_per_month_sats", 0) if budget else 0

    return {
        "agent_id": agent_id,
        "today_sats": today_sats,
        "month_sats": month_sats,
        "max_per_day_sats": max_day,
        "max_per_month_sats": max_month,
        "remaining_today_sats": max(0, max_day - today_sats) if max_day > 0 else None,
        "remaining_month_sats": max(0, max_month - month_sats) if max_month > 0 else None,
    }


# ---------------------------------------------------------------------------
# Invocation history (static routes — must come before /{agent_id})
# ---------------------------------------------------------------------------

@router.get("/history")
async def list_invocations(
    request: Request,
    caller_agent_id: str = Query(None, description="Filter by caller agent ID"),
    target_agent_id: str = Query(None, description="Filter by target agent ID"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> dict[str, Any]:
    """Return invocation history, optionally filtered by caller or target agent."""
    store = request.app.state.store
    invocations, total = store.list_invocations(
        caller_agent_id=caller_agent_id,
        target_agent_id=target_agent_id,
        limit=limit,
        offset=offset,
    )
    return {
        "invocations": invocations,
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.get("/history/{invocation_id}")
async def get_invocation(
    invocation_id: str,
    request: Request,
) -> dict[str, Any]:
    """Return a single invocation record by ID."""
    store = request.app.state.store
    inv = store.get_invocation(invocation_id)
    if not inv:
        raise HTTPException(status_code=404, detail=f"Invocation '{invocation_id}' not found")
    return inv


# ===========================================================================
# Part 1: Capability Schemas (uses /schema/ prefix — safe from /{agent_id})
# ===========================================================================

@router.post("/schema/{agent_id}")
async def register_capability_schema(
    agent_id: str,
    body: CapabilitySchemaRequest,
    request: Request,
    x_admin_key: str = Header(..., alias="X-Admin-Key"),
) -> dict[str, Any]:
    """Register or update a capability schema for an agent. Requires admin key."""
    _check_admin(x_admin_key)

    store = request.app.state.store

    # Validate agent exists
    agent = store.get_agent(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail=f"Agent '{agent_id}' not found")

    schema_data = {
        "agent_id": agent_id,
        "capabilities": [cap.model_dump() for cap in body.capabilities],
        "updated_at": _now_iso(),
    }

    existing = store.get_capability_schema(agent_id)
    if existing:
        store.update_capability_schema(agent_id, schema_data)
        action = "updated"
    else:
        schema_data["created_at"] = _now_iso()
        store.add_capability_schema(agent_id, schema_data)
        action = "created"

    return {
        "status": action,
        "agent_id": agent_id,
        "capabilities_count": len(body.capabilities),
        "capability_ids": [cap.id for cap in body.capabilities],
    }


@router.get("/schema/{agent_id}")
async def get_capability_schema(
    agent_id: str,
    request: Request,
) -> dict[str, Any]:
    """Return the capability schema for an agent. Public endpoint.

    If no schema is registered, attempts to auto-generate one from the
    agent's A2A card skills (fetched from card_url if available).
    """
    store = request.app.state.store

    agent = store.get_agent(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail=f"Agent '{agent_id}' not found")

    schema = store.get_capability_schema(agent_id)
    if schema:
        return schema

    # Try to auto-generate from A2A card
    card_url = agent.get("card_url")
    if not card_url:
        raise HTTPException(
            status_code=404,
            detail=f"No capability schema registered for agent '{agent_id}' and no card_url available for auto-generation",
        )

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(card_url)
            resp.raise_for_status()
            card = resp.json()
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Failed to fetch agent card from {card_url}: {exc}",
        )

    # Convert A2A card skills to capability definitions
    skills = card.get("skills", [])
    capabilities = []
    for skill in skills:
        cap = {
            "id": skill.get("id", skill.get("name", "unknown")).lower().replace(" ", "-"),
            "name": skill.get("name", "Unknown"),
            "description": skill.get("description", ""),
            "endpoint": f"/api/{skill.get('id', 'unknown')}",
            "method": "POST",
            "inputs": {},
            "outputs": {},
            "pricing": {},
        }
        # Try to extract input/output schemas from skill tags or examples
        if "tags" in skill:
            cap["tags"] = skill["tags"]
        if "examples" in skill:
            cap["examples"] = skill["examples"]
        capabilities.append(cap)

    auto_schema = {
        "agent_id": agent_id,
        "capabilities": capabilities,
        "auto_generated": True,
        "source": card_url,
        "generated_at": _now_iso(),
    }

    return auto_schema


# ===========================================================================
# Part 2: Task Invocation Proxy (dynamic /{agent_id} — MUST be last)
# ===========================================================================

@router.post("/{agent_id}")
async def invoke_agent(
    agent_id: str,
    body: InvocationRequest,
    request: Request,
) -> dict[str, Any]:
    """Proxy an invocation to a target agent through Agentry.

    Flow:
    1. Validate target agent exists and has the requested capability
    2. Check budget controls for the caller
    3. Build the full URL and forward the request via httpx
    4. Create escrow micro-contract if capability has pricing
    5. Record invocation history and reputation events
    6. Return result with metadata
    """
    store = request.app.state.store
    invocation_id = f"inv_{uuid.uuid4().hex[:12]}"
    start_time = time.monotonic()

    # --- Step 1: Validate target agent and capability ---
    agent = store.get_agent(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail=f"Target agent '{agent_id}' not found")

    schema = store.get_capability_schema(agent_id)
    if not schema:
        raise HTTPException(
            status_code=404,
            detail=f"No capability schema registered for agent '{agent_id}'. Register one via POST /api/invoke/schema/{agent_id}",
        )

    # Find the requested capability
    capability_def = None
    for cap in schema.get("capabilities", []):
        if cap.get("id") == body.capability:
            capability_def = cap
            break

    if not capability_def:
        available = [c.get("id") for c in schema.get("capabilities", [])]
        raise HTTPException(
            status_code=404,
            detail=f"Capability '{body.capability}' not found for agent '{agent_id}'. Available: {available}",
        )

    # --- Step 2: Check budget controls ---
    cost_sats = capability_def.get("pricing", {}).get("per_request_sats", 0)
    platform_fee_sats = max(1, cost_sats * PLATFORM_FEE_PERCENT // 100) if cost_sats > 0 else 0

    budget = store.get_budget(body.caller_agent_id)
    if budget and budget.get("enabled", True):
        # Check blacklist
        if agent_id in budget.get("blacklist_agents", []):
            raise HTTPException(
                status_code=403,
                detail=f"Target agent '{agent_id}' is in caller's blacklist",
            )

        # Check whitelist
        wl = budget.get("whitelist_agents", [])
        if wl and agent_id not in wl:
            raise HTTPException(
                status_code=403,
                detail=f"Target agent '{agent_id}' is not in caller's whitelist",
            )

        # Check per-invocation limit
        max_per = budget.get("max_per_invocation_sats", 0)
        if max_per > 0 and cost_sats > max_per:
            raise HTTPException(
                status_code=402,
                detail=f"Invocation cost ({cost_sats} sats) exceeds per-invocation limit ({max_per} sats)",
            )

        # Check daily limit
        today_spent = store.get_spending(body.caller_agent_id, period="day")
        max_day = budget.get("max_per_day_sats", 0)
        if max_day > 0 and (today_spent + cost_sats) > max_day:
            raise HTTPException(
                status_code=402,
                detail={
                    "error": "Daily budget exceeded",
                    "today_spent": today_spent,
                    "max_per_day_sats": max_day,
                    "requested_cost": cost_sats,
                    "remaining_today": max(0, max_day - today_spent),
                },
            )

        # Check monthly limit
        month_spent = store.get_spending(body.caller_agent_id, period="month")
        max_month = budget.get("max_per_month_sats", 0)
        if max_month > 0 and (month_spent + cost_sats) > max_month:
            raise HTTPException(
                status_code=402,
                detail={
                    "error": "Monthly budget exceeded",
                    "month_spent": month_spent,
                    "max_per_month_sats": max_month,
                    "requested_cost": cost_sats,
                    "remaining_month": max(0, max_month - month_spent),
                },
            )

        # Check approval threshold
        approval_threshold = budget.get("require_approval_above_sats", 0)
        if approval_threshold > 0 and cost_sats > approval_threshold:
            raise HTTPException(
                status_code=402,
                detail={
                    "error": "Approval required",
                    "approval_required": True,
                    "cost_sats": cost_sats,
                    "require_approval_above_sats": approval_threshold,
                },
            )

    # Check caller-supplied budget cap
    if body.budget_sats is not None and cost_sats > body.budget_sats:
        raise HTTPException(
            status_code=402,
            detail=f"Capability cost ({cost_sats} sats) exceeds caller budget ({body.budget_sats} sats)",
        )


    # --- Step 2.5: Reserve funds (debit caller wallet BEFORE proxy) ---
    reserved = False
    if cost_sats > 0:
        wallet = store.get_wallet(body.caller_agent_id)
        if not wallet:
            raise HTTPException(
                status_code=402,
                detail={
                    "error": "No wallet found",
                    "message": f"Agent '{body.caller_agent_id}' has no wallet. Create one at POST /api/wallets/create then fund at POST /api/wallets/{body.caller_agent_id}/fund/lightning",
                    "cost_sats": cost_sats,
                    "fund_url": f"/api/wallets/{body.caller_agent_id}/fund/lightning",
                }
            )
        try:
            store.debit_wallet(body.caller_agent_id, cost_sats, {
                "type": "invocation_reserve",
                "invocation_id": invocation_id,
                "counterparty": agent_id,
                "status": "reserved",
            })
            reserved = True
        except ValueError:
            raise HTTPException(
                status_code=402,
                detail={
                    "error": "Insufficient balance",
                    "balance_sats": wallet["balance_sats"],
                    "cost_sats": cost_sats,
                    "shortfall_sats": cost_sats - wallet["balance_sats"],
                    "fund_url": f"/api/wallets/{body.caller_agent_id}/fund/lightning",
                }
            )

    # --- Step 3: Build URL and forward request ---
    agent_base_url = agent.get("url", "").rstrip("/")
    cap_endpoint = capability_def.get("endpoint", "")
    full_url = f"{agent_base_url}{cap_endpoint}"
    method = capability_def.get("method", "POST").upper()

    result = None
    error_detail = None
    status = "completed"
    upstream_status = None

    try:
        async with httpx.AsyncClient(timeout=body.timeout_seconds) as client:
            if method == "GET":
                resp = await client.get(full_url, params=body.input)
            elif method == "POST":
                resp = await client.post(full_url, json=body.input)
            elif method == "PUT":
                resp = await client.put(full_url, json=body.input)
            elif method == "DELETE":
                resp = await client.delete(full_url, params=body.input)
            else:
                resp = await client.post(full_url, json=body.input)

            upstream_status = resp.status_code
            latency_ms = round((time.monotonic() - start_time) * 1000, 1)

            if resp.status_code >= 400:
                # Forward upstream error
                status = "error"
                try:
                    error_detail = resp.json()
                except Exception:
                    error_detail = resp.text

                # Refund reserved funds on upstream error
                if reserved:
                    _refund_reserve(store, body.caller_agent_id, cost_sats, invocation_id, f"upstream_error_{upstream_status}")

                # Record the invocation even on error
                invocation_record = {
                    "invocation_id": invocation_id,
                    "caller_agent_id": body.caller_agent_id,
                    "target_agent_id": agent_id,
                    "capability": body.capability,
                    "input": body.input,
                    "output": None,
                    "error": error_detail,
                    "status": status,
                    "upstream_status": upstream_status,
                    "latency_ms": latency_ms,
                    "cost_sats": 0,
                    "platform_fee_sats": 0,
                    "timestamp": _now_iso(),
                }
                store.add_invocation(invocation_record)

                raise HTTPException(
                    status_code=resp.status_code,
                    detail={
                        "invocation_id": invocation_id,
                        "error": "Target agent returned an error",
                        "upstream_status": upstream_status,
                        "upstream_response": error_detail,
                    },
                )

            try:
                result = resp.json()
            except Exception:
                result = {"raw": resp.text}

    except httpx.TimeoutException:
        if reserved:
            _refund_reserve(store, body.caller_agent_id, cost_sats, invocation_id, "proxy_timeout")
        latency_ms = round((time.monotonic() - start_time) * 1000, 1)
        invocation_record = {
            "invocation_id": invocation_id,
            "caller_agent_id": body.caller_agent_id,
            "target_agent_id": agent_id,
            "capability": body.capability,
            "input": body.input,
            "output": None,
            "error": "Request timed out",
            "status": "timeout",
            "latency_ms": latency_ms,
            "cost_sats": 0,
            "platform_fee_sats": 0,
            "timestamp": _now_iso(),
        }
        store.add_invocation(invocation_record)
        raise HTTPException(
            status_code=504,
            detail={
                "invocation_id": invocation_id,
                "error": f"Target agent timed out after {body.timeout_seconds}s",
                "latency_ms": latency_ms,
            },
        )

    except httpx.ConnectError as exc:
        if reserved:
            _refund_reserve(store, body.caller_agent_id, cost_sats, invocation_id, "connection_failed")
        latency_ms = round((time.monotonic() - start_time) * 1000, 1)
        invocation_record = {
            "invocation_id": invocation_id,
            "caller_agent_id": body.caller_agent_id,
            "target_agent_id": agent_id,
            "capability": body.capability,
            "input": body.input,
            "output": None,
            "error": f"Connection failed: {exc}",
            "status": "unreachable",
            "latency_ms": latency_ms,
            "cost_sats": 0,
            "platform_fee_sats": 0,
            "timestamp": _now_iso(),
        }
        store.add_invocation(invocation_record)
        raise HTTPException(
            status_code=502,
            detail={
                "invocation_id": invocation_id,
                "error": f"Target agent unreachable at {full_url}",
                "details": str(exc),
            },
        )

    except HTTPException:
        # Re-raise FastAPI HTTP exceptions (budget errors, upstream errors, etc.)
        raise

    except Exception as exc:
        if reserved:
            _refund_reserve(store, body.caller_agent_id, cost_sats, invocation_id, f"proxy_error: {exc}")
        latency_ms = round((time.monotonic() - start_time) * 1000, 1)
        invocation_record = {
            "invocation_id": invocation_id,
            "caller_agent_id": body.caller_agent_id,
            "target_agent_id": agent_id,
            "capability": body.capability,
            "input": body.input,
            "output": None,
            "error": str(exc),
            "status": "error",
            "latency_ms": latency_ms,
            "cost_sats": 0,
            "platform_fee_sats": 0,
            "timestamp": _now_iso(),
        }
        store.add_invocation(invocation_record)
        raise HTTPException(
            status_code=502,
            detail={
                "invocation_id": invocation_id,
                "error": f"Unexpected error proxying to target agent: {exc}",
            },
        )

    latency_ms = round((time.monotonic() - start_time) * 1000, 1)

    # --- Step 4: Create escrow micro-contract if pricing exists ---
    escrow_contract_id = None
    if cost_sats > 0:
        escrow_contract_id = f"esc_{uuid.uuid4().hex[:12]}"
        escrow_status = "auto_completed" if cost_sats < 100 else "pending"
        escrow_data = {
            "id": escrow_contract_id,
            "poster_agent_id": body.caller_agent_id,
            "worker_agent_id": agent_id,
            "description": f"Auto-escrow for invocation {invocation_id}: {body.capability}",
            "amount_sats": cost_sats,
            "platform_fee_sats": platform_fee_sats,
            "status": escrow_status,
            "invocation_id": invocation_id,
            "created_at": _now_iso(),
            "updated_at": _now_iso(),
        }
        try:
            store.add_escrow_contract(escrow_data)
        except Exception as exc:
            logger.warning("Failed to create escrow contract: %s", exc)


    # --- Step 4.5: Complete wallet settlement (caller already debited at Step 2.5) ---
    wallet_settlement = None
    settlement_failed = False
    if cost_sats > 0 and reserved:
        try:
            agent_revenue = cost_sats - platform_fee_sats
            store.credit_wallet(agent_id, agent_revenue, {
                "type": "invocation_revenue",
                "invocation_id": invocation_id,
                "counterparty": body.caller_agent_id,
                "gross_sats": cost_sats,
                "platform_fee_sats": platform_fee_sats,
            })
            store.record_platform_fee(platform_fee_sats, invocation_id)
            caller_wallet = store.get_wallet(body.caller_agent_id)
            target_wallet = store.get_wallet(agent_id)
            wallet_settlement = {
                "caller_debited_sats": cost_sats,
                "target_credited_sats": agent_revenue,
                "platform_fee_sats": platform_fee_sats,
                "caller_new_balance_sats": caller_wallet["balance_sats"] if caller_wallet else None,
                "target_new_balance_sats": target_wallet["balance_sats"] if target_wallet else None,
            }
        except Exception as exc:
            logger.error("SETTLEMENT FAILED for invocation %s: %s", invocation_id, exc)
            settlement_failed = True
            wallet_settlement = {
                "error": str(exc),
                "requires_reconciliation": True,
                "caller_debited_sats": cost_sats,
                "target_credited_sats": 0,
                "invocation_id": invocation_id,
            }

    # --- Step 5: Record invocation ---
    invocation_record = {
        "invocation_id": invocation_id,
        "caller_agent_id": body.caller_agent_id,
        "target_agent_id": agent_id,
        "capability": body.capability,
        "input": body.input,
        "output": result,
        "status": "settlement_failed" if settlement_failed else "completed",
        "upstream_status": upstream_status,
        "latency_ms": latency_ms,
        "cost_sats": cost_sats,
        "platform_fee_sats": platform_fee_sats,
        "escrow_contract_id": escrow_contract_id,
        "timestamp": _now_iso(),
    }
    store.add_invocation(invocation_record)

    # --- Step 6: Record reputation events ---
    try:
        store.add_reputation_event({
            "agent_id": agent_id,
            "event_type": "task_completed",
            "value": 1.0,
            "source": body.caller_agent_id,
            "metadata": {
                "invocation_id": invocation_id,
                "capability": body.capability,
                "latency_ms": latency_ms,
                "cost_sats": cost_sats,
            },
            "timestamp": _now_iso(),
        })
        store.add_reputation_event({
            "agent_id": body.caller_agent_id,
            "event_type": "task_completed",
            "value": 1.0,
            "source": agent_id,
            "metadata": {
                "invocation_id": invocation_id,
                "capability": body.capability,
                "role": "caller",
            },
            "timestamp": _now_iso(),
        })
    except Exception as exc:
        logger.warning("Failed to record reputation events: %s", exc)

    # --- Step 7: Return result with metadata ---
    response = {
        "invocation_id": invocation_id,
        "status": "settlement_failed" if settlement_failed else "completed",
        "result": result,
        "metadata": {
            "agent_id": agent_id,
            "agent_name": agent.get("name", ""),
            "capability": body.capability,
            "latency_ms": latency_ms,
            "cost_sats": cost_sats,
            "platform_fee_sats": platform_fee_sats,
            "escrow_contract_id": escrow_contract_id,
            "trust_score": agent.get("trust_score"),
            "security_score": None,
            "wallet_settlement": wallet_settlement if cost_sats > 0 else None,
        },
    }
    if settlement_failed:
        response["warning"] = "Invocation succeeded but wallet settlement failed. Requires manual reconciliation."
    return response

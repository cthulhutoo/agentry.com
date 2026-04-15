"""
GET /api/stats/commerce — Public commerce metrics for Agentry.

Shows live wallet, invocation, escrow, settlement, and MCP usage data.
This is the "proof of commerce" endpoint.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone, timedelta
from typing import Any

from fastapi import APIRouter, Request

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/stats", tags=["commerce"])


@router.get("/commerce", summary="Live commerce metrics",
            description="Public endpoint showing real-time wallet, invocation, "
                        "escrow, and settlement data.")
async def commerce_stats(request: Request) -> dict[str, Any]:
    store = request.app.state.store

    now = datetime.now(timezone.utc)

    # --- Wallets (use store methods) ---
    wallet_stats = store.get_wallet_stats()
    
    # Also count funded wallets manually from the internal store
    all_wallets = store._store.get("wallets", {})
    total_wallets = len(all_wallets)
    funded_wallets = 0
    total_funded_sats = 0
    total_spent_sats = 0
    total_balance_sats = 0
    total_wallet_txns = 0
    funding_sources = {}

    for wid, w in all_wallets.items():
        funded = w.get("total_funded_sats", 0)
        spent = w.get("total_spent_sats", 0)
        balance = w.get("balance_sats", 0)
        txns = w.get("transactions", [])

        if funded > 0:
            funded_wallets += 1
        total_funded_sats += funded
        total_spent_sats += spent
        total_balance_sats += balance
        total_wallet_txns += len(txns)

        for txn in txns:
            src = txn.get("source", "unknown")
            funding_sources[src] = funding_sources.get(src, 0) + 1

    # --- Invocations ---
    inv_result = store.list_invocations(limit=10000)
    invocations = inv_result[0] if isinstance(inv_result, tuple) else inv_result
    if not isinstance(invocations, list):
        invocations = []
    total_invocations = len(invocations)
    successful_invocations = sum(1 for i in invocations if i.get("status") == "completed")
    failed_invocations = sum(1 for i in invocations if i.get("status") == "failed")
    total_invocation_cost_sats = sum(i.get("cost_sats", 0) for i in invocations)

    invocations_24h = 0
    invocations_7d = 0
    for i in invocations:
        try:
            ts = datetime.fromisoformat(str(i.get("created_at", "")))
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)
            if (now - ts) < timedelta(hours=24):
                invocations_24h += 1
            if (now - ts) < timedelta(days=7):
                invocations_7d += 1
        except (ValueError, TypeError):
            pass

    # Unique agent pairs
    agent_pairs = set()
    for i in invocations:
        caller = i.get("caller_agent_id", "")
        target = i.get("target_agent_id", "")
        if caller and target:
            agent_pairs.add(f"{caller}->{target}")

    # --- Escrow ---
    esc_result = store.list_escrow_contracts(limit=10000)
    escrow_contracts = esc_result[0] if isinstance(esc_result, tuple) else esc_result
    if not isinstance(escrow_contracts, list):
        escrow_contracts = []
    total_escrow = len(escrow_contracts)
    escrow_by_status = {}
    total_escrow_sats = 0
    escrow_completed_sats = 0

    for e in escrow_contracts:
        status = e.get("status", "unknown")
        escrow_by_status[status] = escrow_by_status.get(status, 0) + 1
        amount = e.get("amount_sats", 0)
        total_escrow_sats += amount
        if status in ("completed", "approved", "released"):
            escrow_completed_sats += amount

    # --- Platform fees ---
    platform_fees = store._store.get("platform_fees", {})
    total_platform_fees_sats = platform_fees.get("total_collected_sats", 0)

    # --- TEMP events ---
    temp_events = store._store.get("temp_events", [])
    total_temp = len(temp_events)

    # --- Agent counts ---
    agents_result = store.list_agents(limit=10000)
    agents = agents_result[0] if isinstance(agents_result, tuple) else agents_result
    if not isinstance(agents, list):
        agents = []
    total_agents = len(agents)
    agents_with_identity = sum(1 for a in agents if a.get("identity_registered"))
    agents_with_mcp = sum(1 for a in agents if a.get("mcp_enabled"))
    agents_quickstarted = sum(1 for a in agents if a.get("quickstart"))
    agents_with_commerce = sum(1 for a in agents if a.get("commerce_protocols"))

    # --- Total sats through the system ---
    total_sats_settled = total_spent_sats + escrow_completed_sats

    return {
        "generated_at": now.isoformat(),
        "summary": {
            "total_sats_settled": total_sats_settled,
            "total_sats_funded": total_funded_sats,
            "platform_fees_collected_sats": total_platform_fees_sats,
            "total_invocations": total_invocations,
            "total_escrow_contracts": total_escrow,
            "total_temp_events": total_temp,
        },
        "wallets": {
            "total": total_wallets,
            "funded": funded_wallets,
            "total_funded_sats": total_funded_sats,
            "total_spent_sats": total_spent_sats,
            "total_balance_sats": total_balance_sats,
            "total_transactions": total_wallet_txns,
            "funding_sources": funding_sources,
        },
        "invocations": {
            "total": total_invocations,
            "successful": successful_invocations,
            "failed": failed_invocations,
            "total_cost_sats": total_invocation_cost_sats,
            "last_24h": invocations_24h,
            "last_7d": invocations_7d,
            "unique_agent_pairs": len(agent_pairs),
        },
        "escrow": {
            "total_contracts": total_escrow,
            "by_status": escrow_by_status,
            "total_sats_locked": total_escrow_sats,
            "total_sats_completed": escrow_completed_sats,
        },
        "temp": {
            "total_events_published": total_temp,
        },
        "agents": {
            "total": total_agents,
            "with_wallet": total_wallets,
            "with_identity": agents_with_identity,
            "with_mcp": agents_with_mcp,
            "with_commerce_protocols": agents_with_commerce,
            "quickstarted": agents_quickstarted,
        },
    }

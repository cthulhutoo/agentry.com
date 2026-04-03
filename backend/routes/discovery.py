"""Admin API routes for the discovery pipeline.

Endpoints:
    POST /api/admin/discovery/run     — Trigger a discovery run
    GET  /api/admin/discovery/status   — Get last run stats
    GET  /api/admin/discovery/log      — Get discovery history
    POST /api/admin/discovery/scan     — Scan specific domains on-demand
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel

from discovery_pipeline import run_discovery_pipeline, _load_discovery_log

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin/discovery", tags=["discovery"])

ADMIN_KEY = os.getenv("ADMIN_KEY", "agentry-admin-2026")

# Track if a pipeline is currently running
_running = False


def _check_admin(key: str) -> None:
    if key != ADMIN_KEY:
        raise HTTPException(status_code=403, detail="Invalid admin key")


class DiscoveryRunRequest(BaseModel):
    """Request body for triggering a discovery run."""
    scan_cards: bool = True
    dry_run: bool = False


class DomainScanRequest(BaseModel):
    """Request body for scanning specific domains."""
    domains: list[str]


# ---------------------------------------------------------------------------
# POST /api/admin/discovery/run — trigger discovery pipeline
# ---------------------------------------------------------------------------

@router.post("/run")
async def trigger_discovery(
    body: DiscoveryRunRequest,
    request: Request,
    x_admin_key: str = Header(..., alias="X-Admin-Key"),
) -> dict[str, Any]:
    """Trigger a full discovery pipeline run."""
    _check_admin(x_admin_key)

    global _running
    if _running:
        raise HTTPException(status_code=409, detail="Discovery pipeline is already running")

    _running = True
    try:
        store = request.app.state.store
        stats = await run_discovery_pipeline(
            store=store,
            scan_cards=body.scan_cards,
            dry_run=body.dry_run,
        )
        return {
            "status": "complete",
            "stats": stats,
        }
    except Exception as exc:
        logger.exception("Discovery pipeline failed")
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
        _running = False


# ---------------------------------------------------------------------------
# GET /api/admin/discovery/status — get last run status
# ---------------------------------------------------------------------------

@router.get("/status")
async def discovery_status(
    request: Request,
    x_admin_key: str = Header(..., alias="X-Admin-Key"),
) -> dict[str, Any]:
    """Get the status of the discovery pipeline."""
    _check_admin(x_admin_key)

    log = _load_discovery_log()
    last_run = log.get("runs", [])[-1] if log.get("runs") else None

    # Count current agents
    store = request.app.state.store
    _, total = store.list_agents(limit=1)

    return {
        "is_running": _running,
        "total_agents_in_directory": total,
        "total_known_domains": len(log.get("known_domains", [])),
        "total_discovery_runs": len(log.get("runs", [])),
        "last_run": last_run,
    }


# ---------------------------------------------------------------------------
# GET /api/admin/discovery/log — get discovery history
# ---------------------------------------------------------------------------

@router.get("/log")
async def discovery_log(
    request: Request,
    x_admin_key: str = Header(..., alias="X-Admin-Key"),
    limit: int = 10,
) -> dict[str, Any]:
    """Get the discovery run history."""
    _check_admin(x_admin_key)

    log = _load_discovery_log()
    runs = log.get("runs", [])

    return {
        "total_runs": len(runs),
        "recent_runs": runs[-limit:] if runs else [],
        "known_domains_count": len(log.get("known_domains", [])),
        "last_run": log.get("last_run"),
    }


# ---------------------------------------------------------------------------
# POST /api/admin/discovery/scan — scan specific domains
# ---------------------------------------------------------------------------

@router.post("/scan")
async def scan_domains(
    body: DomainScanRequest,
    request: Request,
    x_admin_key: str = Header(..., alias="X-Admin-Key"),
) -> dict[str, Any]:
    """Scan specific domains for A2A Agent Cards and add if valid."""
    _check_admin(x_admin_key)

    if not body.domains:
        raise HTTPException(status_code=400, detail="No domains provided")
    if len(body.domains) > 100:
        raise HTTPException(status_code=400, detail="Max 100 domains per request")

    import httpx
    from crawler import WELL_KNOWN_PATHS, validate_agent_card, parse_agent_card

    store = request.app.state.store
    results: list[dict[str, Any]] = []
    semaphore = asyncio.Semaphore(10)

    async def _scan_one(client: httpx.AsyncClient, domain: str) -> dict[str, Any]:
        async with semaphore:
            for path in WELL_KNOWN_PATHS:
                url = f"https://{domain}{path}"
                try:
                    resp = await client.get(url, follow_redirects=True)
                    if resp.status_code == 200:
                        data = resp.json()
                        errors = validate_agent_card(data)
                        if not errors:
                            return {
                                "domain": domain,
                                "status": "valid_card",
                                "card_url": url,
                                "agent_name": data.get("name", domain),
                            }
                except Exception:
                    pass
            return {"domain": domain, "status": "no_card"}

    async with httpx.AsyncClient(
        timeout=httpx.Timeout(15.0),
        headers={"User-Agent": "Agentry-Discovery/1.0"},
        http2=True,
    ) as client:
        tasks = [_scan_one(client, d.strip()) for d in body.domains]
        results = await asyncio.gather(*tasks, return_exceptions=True)

    processed = []
    for r in results:
        if isinstance(r, dict):
            processed.append(r)
        elif isinstance(r, Exception):
            processed.append({"domain": "unknown", "status": "error", "error": str(r)})

    return {
        "scanned": len(body.domains),
        "results": processed,
        "valid_cards": sum(1 for r in processed if r.get("status") == "valid_card"),
    }

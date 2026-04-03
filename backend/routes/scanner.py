"""Scanner / crawler endpoints."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Query, Request

from crawler import crawl_domains
from models import ScanRequest, ScanResult

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/scanner", tags=["scanner"])


def _get_store(request: Request):
    return request.app.state.store


@router.post("/scan", response_model=dict[str, Any], status_code=202)
async def trigger_scan(request: Request, body: ScanRequest) -> dict[str, Any]:
    """Scan domains for A2A Agent Card discovery.

    Checks the given domains for /.well-known/agent.json endpoints and
    extracts agent capability metadata. Results are stored and can be
    retrieved via the scan results endpoint."""
    store = _get_store(request)

    if not body.domains:
        return {"message": "No domains provided", "results": []}

    logger.info("Scan requested for %d domain(s)", len(body.domains))
    results: list[ScanResult] = await crawl_domains(body.domains)

    serialized = [r.model_dump(mode="json") for r in results]
    store.add_scan_results(serialized)

    valid_count = sum(1 for r in results if r.valid)
    return {
        "message": f"Scanned {len(body.domains)} domain(s)",
        "total_checks": len(results),
        "valid_cards": valid_count,
        "results": serialized,
    }


@router.get("/results", response_model=dict[str, Any])
async def get_scan_results(
    request: Request,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> dict[str, Any]:
    """Get recent A2A Agent Card scan results.

    Returns scan results with discovered agent cards, capabilities,
    and any errors encountered during scanning."""
    store = _get_store(request)
    items, total = store.get_scan_results(limit=limit, offset=offset)
    return {"items": items, "total": total, "limit": limit, "offset": offset}

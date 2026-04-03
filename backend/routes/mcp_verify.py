"""MCP Registry verification endpoints.

Serves /.well-known/mcp-registry-auth for HTTP-based domain verification
when publishing to the MCP Registry.
"""

from __future__ import annotations

import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import PlainTextResponse

logger = logging.getLogger(__name__)

router = APIRouter(tags=["mcp-verify"])

_BASE_DIR = Path(__file__).resolve().parent.parent
_AUTH_FILE = _BASE_DIR / "mcp-registry-auth"


@router.get("/.well-known/mcp-registry-auth")
async def mcp_registry_auth() -> PlainTextResponse:
    """Serve the MCP registry auth file for HTTP domain verification."""
    if _AUTH_FILE.exists():
        content = _AUTH_FILE.read_text().strip()
        return PlainTextResponse(
            content=content,
            headers={
                "Cache-Control": "public, max-age=3600",
                "Access-Control-Allow-Origin": "*",
            }
        )
    raise HTTPException(status_code=404, detail="MCP registry auth not configured")

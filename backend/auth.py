"""API key authentication for enterprise private registries."""

from __future__ import annotations

from fastapi import Header, HTTPException, Request


async def get_current_org(
    request: Request,
    x_api_key: str = Header(..., alias="X-API-Key"),
) -> dict:
    """Validate API key and return the org."""
    store = request.app.state.store
    org = store.get_org_by_api_key(x_api_key)
    if org is None:
        raise HTTPException(status_code=401, detail="Invalid API key")
    return org

"""Admin-only backup management API endpoints."""

from __future__ import annotations

import os

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel

from backup import auto_backup, create_backup, list_backups, restore_backup

router = APIRouter(prefix="/api/admin/backups", tags=["admin"])

ADMIN_KEY = os.getenv("ADMIN_KEY", "agentry-admin-2026")


def _check_admin(key: str) -> None:
    if key != ADMIN_KEY:
        raise HTTPException(status_code=403, detail="Invalid admin key")


class BackupCreateRequest(BaseModel):
    reason: str = "manual"


class BackupRestoreRequest(BaseModel):
    file: str | None = None


@router.get("")
async def get_backups(
    x_admin_key: str = Header(..., alias="X-Admin-Key"),
) -> dict:
    """List all available backups."""
    _check_admin(x_admin_key)
    backups = list_backups()
    return {"backups": backups, "count": len(backups)}


@router.post("")
async def post_backup(
    request: Request,
    body: BackupCreateRequest,
    x_admin_key: str = Header(..., alias="X-Admin-Key"),
) -> dict:
    """Create a manual backup of the current store."""
    _check_admin(x_admin_key)
    store = request.app.state.store._store
    path = create_backup(store, reason=body.reason)
    if path is None:
        raise HTTPException(status_code=500, detail="Backup creation failed")
    return {
        "status": "created",
        "filename": path.name,
        "agents": len(store.get("agents", [])),
    }


@router.post("/restore")
async def post_restore(
    request: Request,
    body: BackupRestoreRequest,
    x_admin_key: str = Header(..., alias="X-Admin-Key"),
) -> dict:
    """Restore the store from a backup file."""
    _check_admin(x_admin_key)
    data = restore_backup(body.file)
    if data is None:
        raise HTTPException(status_code=404, detail="No backup found or restore failed")

    # Replace the in-memory store and persist to disk
    store_obj = request.app.state.store
    store_obj._store = data
    store_obj._persist()
    return {
        "status": "restored",
        "agents": len(data.get("agents", [])),
    }

"""Backup and restore system for the Agentry JSON-file data store.

Prevents data loss when store.json is wiped during deployments by maintaining
timestamped backup copies in a configurable directory.
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# Configurable backup directory — default is backend/backups/
# Set AGENTRY_BACKUP_DIR to a persistent mount (GCS bucket, etc.) in production.
BACKUP_DIR = Path(
    os.getenv("AGENTRY_BACKUP_DIR", str(Path(__file__).resolve().parent / "backups"))
)

MAX_BACKUPS = 30
AUTO_BACKUP_INTERVAL_HOURS = 6


def _ensure_backup_dir() -> None:
    """Create the backup directory if it doesn't exist."""
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)


def create_backup(store: dict[str, Any], reason: str = "manual") -> Path | None:
    """Save a timestamped JSON backup of the store.

    Returns the path to the created backup file, or None on failure.
    Prunes old backups to keep at most MAX_BACKUPS.
    """
    _ensure_backup_dir()
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    # Sanitise reason for use in filename
    safe_reason = "".join(c if c.isalnum() or c in "-_" else "_" for c in reason)
    filename = f"store_{ts}_{safe_reason}.json"
    backup_path = BACKUP_DIR / filename

    try:
        with open(backup_path, "w") as f:
            json.dump(store, f, indent=2, default=str)
        logger.info("Backup created: %s (%d agents)", backup_path.name, len(store.get("agents", [])))
    except OSError:
        logger.exception("Failed to create backup at %s", backup_path)
        return None

    _prune_backups()
    return backup_path


def restore_backup(backup_path: str | Path | None = None) -> dict[str, Any] | None:
    """Restore a store dict from a backup file.

    If *backup_path* is None, restores from the most recent backup.
    Returns the restored store dict, or None if restore failed.
    """
    if backup_path is None:
        backups = list_backups()
        if not backups:
            logger.warning("No backups available to restore from")
            return None
        backup_path = backups[0]["path"]

    path = Path(backup_path)
    if not path.exists():
        logger.error("Backup file not found: %s", path)
        return None

    try:
        with open(path) as f:
            data = json.load(f)
        logger.info(
            "Restored from backup: %s (%d agents)",
            path.name,
            len(data.get("agents", [])),
        )
        return data
    except (json.JSONDecodeError, OSError):
        logger.exception("Failed to restore backup from %s", path)
        return None


def list_backups() -> list[dict[str, Any]]:
    """Return available backups sorted most-recent-first.

    Each entry contains: filename, path, timestamp, agent_count, size_bytes.
    """
    _ensure_backup_dir()
    backups: list[dict[str, Any]] = []
    for p in BACKUP_DIR.glob("store_*.json"):
        try:
            stat = p.stat()
            # Peek inside for agent count without loading the whole file
            with open(p) as f:
                data = json.load(f)
            agent_count = len(data.get("agents", []))
        except (json.JSONDecodeError, OSError):
            agent_count = -1

        # Parse timestamp from filename: store_YYYYMMDD_HHMMSS_reason.json
        parts = p.stem.split("_", 3)  # ['store', 'YYYYMMDD', 'HHMMSS', 'reason']
        ts_str = ""
        if len(parts) >= 3:
            try:
                ts = datetime.strptime(f"{parts[1]}_{parts[2]}", "%Y%m%d_%H%M%S")
                ts_str = ts.isoformat() + "Z"
            except ValueError:
                ts_str = ""

        backups.append({
            "filename": p.name,
            "path": str(p),
            "timestamp": ts_str,
            "agent_count": agent_count,
            "size_bytes": stat.st_size,
        })

    # Sort by filename descending (timestamp is embedded) → most recent first
    backups.sort(key=lambda b: b["filename"], reverse=True)
    return backups


def auto_backup(store: dict[str, Any]) -> Path | None:
    """Create an automatic backup if conditions are met.

    Triggers when:
    - No backups exist yet, OR
    - Last backup is older than AUTO_BACKUP_INTERVAL_HOURS, OR
    - Store has more agents than the most recent backup (growth detection).
    """
    backups = list_backups()

    if not backups:
        logger.info("No existing backups — creating initial auto-backup")
        return create_backup(store, reason="auto")

    latest = backups[0]

    # Check time elapsed since last backup
    if latest["timestamp"]:
        try:
            last_ts = datetime.fromisoformat(latest["timestamp"].rstrip("Z")).replace(
                tzinfo=timezone.utc
            )
            elapsed = datetime.now(timezone.utc) - last_ts
            if elapsed.total_seconds() > AUTO_BACKUP_INTERVAL_HOURS * 3600:
                logger.info("Auto-backup triggered: %.1f hours since last backup", elapsed.total_seconds() / 3600)
                return create_backup(store, reason="auto")
        except ValueError:
            pass

    # Check if store has grown (more agents than last backup)
    current_agents = len(store.get("agents", []))
    last_agents = latest.get("agent_count", 0)
    if current_agents > last_agents and last_agents >= 0:
        logger.info(
            "Auto-backup triggered: agent count grew %d → %d",
            last_agents,
            current_agents,
        )
        return create_backup(store, reason="auto_growth")

    return None


def _prune_backups() -> None:
    """Remove oldest backups when count exceeds MAX_BACKUPS."""
    backups = list_backups()
    if len(backups) <= MAX_BACKUPS:
        return
    for old in backups[MAX_BACKUPS:]:
        try:
            Path(old["path"]).unlink()
            logger.info("Pruned old backup: %s", old["filename"])
        except OSError:
            logger.warning("Failed to prune backup: %s", old["filename"])


def diff_store_with_backup(
    store: dict[str, Any], backup_path: str | Path | None = None
) -> dict[str, Any]:
    """Compare current store with a backup and return a summary of differences."""
    backup_data = restore_backup(backup_path)
    if backup_data is None:
        return {"error": "No backup available for comparison"}

    current_agents = {a.get("id"): a.get("name", "") for a in store.get("agents", [])}
    backup_agents = {a.get("id"): a.get("name", "") for a in backup_data.get("agents", [])}

    current_ids = set(current_agents.keys())
    backup_ids = set(backup_agents.keys())

    added = {aid: current_agents[aid] for aid in current_ids - backup_ids}
    removed = {aid: backup_agents[aid] for aid in backup_ids - current_ids}

    collections_diff = {}
    all_keys = set(list(store.keys()) + list(backup_data.keys()))
    for key in sorted(all_keys):
        curr = store.get(key, [])
        back = backup_data.get(key, [])
        curr_len = len(curr) if isinstance(curr, list) else (1 if curr else 0)
        back_len = len(back) if isinstance(back, list) else (1 if back else 0)
        if curr_len != back_len:
            collections_diff[key] = {"current": curr_len, "backup": back_len}

    return {
        "agents_added": added,
        "agents_removed": removed,
        "agents_current_count": len(current_agents),
        "agents_backup_count": len(backup_agents),
        "collections_changed": collections_diff,
    }

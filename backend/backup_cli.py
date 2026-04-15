#!/usr/bin/env python3
"""Standalone CLI for Agentry backup management.

Usage:
    python backup_cli.py list                        # Show all backups
    python backup_cli.py create --reason "pre-deploy" # Manual backup
    python backup_cli.py restore [--file path]       # Restore latest or specific
    python backup_cli.py diff                        # Diff current store vs latest backup
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# Ensure backend/ is on the import path when running from backend/
sys.path.insert(0, str(Path(__file__).resolve().parent))

from backup import create_backup, restore_backup, list_backups, diff_store_with_backup

_STORE_PATH = Path(__file__).resolve().parent / "store.json"


def _load_current_store() -> dict | None:
    if not _STORE_PATH.exists():
        return None
    try:
        with open(_STORE_PATH) as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        print(f"Error reading store.json: {e}", file=sys.stderr)
        return None


def cmd_list() -> None:
    backups = list_backups()
    if not backups:
        print("No backups found.")
        return
    print(f"{'#':<4} {'Filename':<50} {'Agents':>7} {'Size':>10} {'Timestamp'}")
    print("-" * 95)
    for i, b in enumerate(backups, 1):
        size_kb = b["size_bytes"] / 1024
        agents = b["agent_count"] if b["agent_count"] >= 0 else "?"
        print(f"{i:<4} {b['filename']:<50} {agents:>7} {size_kb:>8.1f}KB {b['timestamp']}")
    print(f"\nTotal: {len(backups)} backup(s)")


def cmd_create(reason: str) -> None:
    store = _load_current_store()
    if store is None:
        print("Error: store.json not found or unreadable.", file=sys.stderr)
        sys.exit(1)
    path = create_backup(store, reason=reason)
    if path:
        agents = len(store.get("agents", []))
        print(f"Backup created: {path.name} ({agents} agents)")
    else:
        print("Failed to create backup.", file=sys.stderr)
        sys.exit(1)


def cmd_restore(file_path: str | None) -> None:
    if file_path:
        p = Path(file_path)
        if not p.exists():
            print(f"Error: file not found: {file_path}", file=sys.stderr)
            sys.exit(1)
    else:
        backups = list_backups()
        if not backups:
            print("No backups available to restore.", file=sys.stderr)
            sys.exit(1)
        file_path = backups[0]["path"]
        print(f"Restoring from latest backup: {backups[0]['filename']}")

    data = restore_backup(file_path)
    if data is None:
        print("Restore failed.", file=sys.stderr)
        sys.exit(1)

    # Write restored data to store.json
    try:
        with open(_STORE_PATH, "w") as f:
            json.dump(data, f, indent=2, default=str)
        agents = len(data.get("agents", []))
        print(f"Restored store.json with {agents} agents.")
    except OSError as e:
        print(f"Failed to write store.json: {e}", file=sys.stderr)
        sys.exit(1)


def cmd_diff() -> None:
    store = _load_current_store()
    if store is None:
        print("Error: store.json not found or unreadable.", file=sys.stderr)
        sys.exit(1)

    result = diff_store_with_backup(store)
    if "error" in result:
        print(f"Error: {result['error']}", file=sys.stderr)
        sys.exit(1)

    print(f"Agents in current store: {result['agents_current_count']}")
    print(f"Agents in latest backup: {result['agents_backup_count']}")

    added = result.get("agents_added", {})
    removed = result.get("agents_removed", {})
    collections = result.get("collections_changed", {})

    if added:
        print(f"\n+ {len(added)} agent(s) added since last backup:")
        for aid, name in added.items():
            print(f"  + {aid}: {name}")

    if removed:
        print(f"\n- {len(removed)} agent(s) removed since last backup:")
        for aid, name in removed.items():
            print(f"  - {aid}: {name}")

    if collections:
        print("\nCollection size changes:")
        for key, counts in collections.items():
            print(f"  {key}: {counts['backup']} → {counts['current']}")

    if not added and not removed and not collections:
        print("\nNo differences found.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Agentry Backup CLI")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("list", help="List all backups")

    create_p = sub.add_parser("create", help="Create a manual backup")
    create_p.add_argument("--reason", default="manual", help="Reason tag for the backup filename")

    restore_p = sub.add_parser("restore", help="Restore from a backup")
    restore_p.add_argument("--file", default=None, help="Path to a specific backup file")

    sub.add_parser("diff", help="Diff current store against latest backup")

    args = parser.parse_args()

    if args.command == "list":
        cmd_list()
    elif args.command == "create":
        cmd_create(args.reason)
    elif args.command == "restore":
        cmd_restore(args.file)
    elif args.command == "diff":
        cmd_diff()


if __name__ == "__main__":
    main()

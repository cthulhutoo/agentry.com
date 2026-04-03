"""Escrow Memory — persistent shared memory attached to escrow contracts.

Both parties (poster and worker) can read/write during the contract
lifecycle. Entries are signed by the author's Nostr key and optionally
published to the Agentry relay as kind 30090 events.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import logging
import os
import time
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/escrow/contracts", tags=["escrow-memory"])

NOSTR_RELAY_URL = "ws://localhost:7777"
ESCROW_MEMORY_KIND = 30090

# Active contract states that allow memory writes
ACTIVE_STATES = {"open", "accepted", "submitted", "disputed"}


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class AddMemoryRequest(BaseModel):
    author_agent_id: str = Field(..., description="Agent ID of the author")
    type: str = Field(
        default="message",
        description="Entry type: message, revision, attachment, note, deliverable",
    )
    visibility: str = Field(
        default="shared",
        description="Visibility: shared, poster_only, worker_only",
    )
    content: str = Field(..., min_length=1, description="Entry content")
    attachments: list[str] = Field(default_factory=list, description="List of URLs")


class SearchMemoryRequest(BaseModel):
    query: str = Field(..., min_length=1, description="Search query")
    type: str | None = Field(default=None, description="Optional type filter")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _get_store(request: Request):
    return request.app.state.store


VALID_TYPES = {"message", "revision", "attachment", "note", "deliverable"}
VALID_VISIBILITY = {"shared", "poster_only", "worker_only"}


# ---------------------------------------------------------------------------
# Nostr helpers
# ---------------------------------------------------------------------------

def _get_master_key() -> str | None:
    """Read PROVISION_MASTER_KEY from environment, return None if not set."""
    return os.getenv("PROVISION_MASTER_KEY")


def _derive_fernet_key(master_secret: str) -> bytes:
    key = hashlib.sha256(master_secret.encode()).digest()
    return base64.urlsafe_b64encode(key)


def _decrypt_privkey(encrypted_b64: str, master_key: str) -> str | None:
    """Decrypt a Fernet-encrypted private key. Returns privkey hex or None."""
    try:
        from cryptography.fernet import Fernet
        fernet = Fernet(_derive_fernet_key(master_key))
        return fernet.decrypt(encrypted_b64.encode()).decode()
    except Exception as exc:
        logger.warning("Failed to decrypt private key: %s", exc)
        return None


def _sign_nostr_event(privkey_hex: str, pubkey_hex: str, kind: int, content: str, tags: list) -> dict | None:
    """Create and sign a Nostr event. Returns event dict or None on failure."""
    try:
        import secp256k1

        created_at = int(time.time())
        serialized = json.dumps(
            [0, pubkey_hex, created_at, kind, tags, content],
            separators=(",", ":"),
            ensure_ascii=False,
        )
        event_id = hashlib.sha256(serialized.encode()).hexdigest()

        privkey_bytes = bytes.fromhex(privkey_hex)
        pk = secp256k1.PrivateKey(privkey_bytes)
        sig = pk.schnorr_sign(bytes.fromhex(event_id), bip340tag="", raw=True)
        sig_hex = sig.hex()

        return {
            "id": event_id,
            "pubkey": pubkey_hex,
            "created_at": created_at,
            "kind": kind,
            "tags": tags,
            "content": content,
            "sig": sig_hex,
        }
    except Exception as exc:
        logger.warning("Failed to sign Nostr event: %s", exc)
        return None


async def _publish_to_relay(event: dict, relay_url: str = NOSTR_RELAY_URL) -> dict:
    """Publish a signed event to the Nostr relay. Returns response or error."""
    try:
        import websockets

        async with websockets.connect(relay_url, close_timeout=5) as ws:
            msg = json.dumps(["EVENT", event])
            await ws.send(msg)
            response = await asyncio.wait_for(ws.recv(), timeout=5)
            return json.loads(response)
    except Exception as exc:
        logger.warning("Failed to publish to relay %s: %s", relay_url, exc)
        return {"error": str(exc)}


async def _try_publish_nostr(
    store,
    author_agent_id: str,
    contract_id: str,
    entry_id: str,
    content: str,
    entry_type: str,
    counterparty_agent_id: str | None,
) -> str | None:
    """Attempt to sign and publish a memory entry as a Nostr event.

    Returns the Nostr event ID if successful, None otherwise.
    Never raises — all failures are logged and swallowed.
    """
    master_key = _get_master_key()
    if not master_key:
        logger.warning("PROVISION_MASTER_KEY not set, skipping Nostr publish")
        return None

    # Look up the author's provisioned identity
    identity = store.get_provisioned_identity(author_agent_id)
    if not identity:
        logger.info("No provisioned identity for %s, skipping Nostr publish", author_agent_id)
        return None

    encrypted_privkey = identity.get("encrypted_privkey")
    if not encrypted_privkey:
        logger.info("Identity for %s is claimed (no privkey), skipping Nostr publish", author_agent_id)
        return None

    pubkey_hex = identity.get("pubkey_hex", "")
    if not pubkey_hex:
        return None

    privkey_hex = _decrypt_privkey(encrypted_privkey, master_key)
    if not privkey_hex:
        return None

    # Build tags
    tags = [
        ["d", contract_id],
        ["t", entry_type],
        ["agentry:contract", contract_id],
        ["agentry:entry", entry_id],
        ["agentry:author", author_agent_id],
    ]

    # Tag the counterparty if they have a pubkey
    if counterparty_agent_id:
        counter_identity = store.get_provisioned_identity(counterparty_agent_id)
        if counter_identity and counter_identity.get("pubkey_hex"):
            tags.append(["p", counter_identity["pubkey_hex"]])

    # Sign and publish
    event = _sign_nostr_event(privkey_hex, pubkey_hex, ESCROW_MEMORY_KIND, content, tags)
    if not event:
        return None

    result = await _publish_to_relay(event)
    if "error" in result:
        logger.warning("Relay publish error: %s", result["error"])
        return None

    # Check for OK response: ["OK", event_id, true/false, message]
    if isinstance(result, list) and len(result) >= 3:
        if result[0] == "OK" and result[2]:
            logger.info("Published escrow memory to Nostr: event_id=%s", result[1])
            return result[1]
        else:
            logger.warning("Relay rejected event: %s", result)
            return None

    logger.info("Relay response: %s", result)
    return event.get("id")


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.post("/{contract_id}/memory", status_code=201)
async def add_memory_entry(
    contract_id: str,
    body: AddMemoryRequest,
    request: Request,
) -> dict[str, Any]:
    """Add a memory entry to an escrow contract.

    Both poster and worker can add entries during the contract lifecycle.
    Shared entries are published to the Nostr relay as kind 30090 events.
    """
    store = _get_store(request)

    # Validate contract exists
    contract = store.get_escrow_contract(contract_id)
    if not contract:
        raise HTTPException(status_code=404, detail=f"Contract '{contract_id}' not found")

    # Validate contract is in an active state
    status = contract.get("status", "")
    if status not in ACTIVE_STATES:
        raise HTTPException(
            status_code=409,
            detail=f"Contract is in '{status}' state. Memory can only be added to active contracts ({', '.join(sorted(ACTIVE_STATES))}).",
        )

    # Validate author is poster or worker
    poster_id = contract.get("poster_agent_id")
    worker_id = contract.get("worker_agent_id")
    if body.author_agent_id not in (poster_id, worker_id):
        raise HTTPException(
            status_code=403,
            detail=f"Agent '{body.author_agent_id}' is not a party to this contract. Poster: {poster_id}, Worker: {worker_id}.",
        )

    # Validate type and visibility
    if body.type not in VALID_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid type '{body.type}'. Must be one of: {', '.join(sorted(VALID_TYPES))}.",
        )
    if body.visibility not in VALID_VISIBILITY:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid visibility '{body.visibility}'. Must be one of: {', '.join(sorted(VALID_VISIBILITY))}.",
        )

    # Look up author's npub
    author_npub = None
    identity = store.get_provisioned_identity(body.author_agent_id)
    if identity:
        author_npub = identity.get("npub")

    entry_id = f"mem_{uuid.uuid4().hex[:12]}"
    entry = {
        "entry_id": entry_id,
        "contract_id": contract_id,
        "author_agent_id": body.author_agent_id,
        "author_npub": author_npub,
        "type": body.type,
        "visibility": body.visibility,
        "content": body.content,
        "attachments": body.attachments,
        "nostr_event_id": None,
        "created_at": _now_iso(),
    }

    store.add_escrow_memory(contract_id, entry)

    # Attempt Nostr publish for shared entries
    if body.visibility == "shared":
        counterparty = worker_id if body.author_agent_id == poster_id else poster_id
        nostr_event_id = await _try_publish_nostr(
            store,
            body.author_agent_id,
            contract_id,
            entry_id,
            body.content,
            body.type,
            counterparty,
        )
        if nostr_event_id:
            entry["nostr_event_id"] = nostr_event_id
            # Update in store
            stored = store.get_escrow_memory_entry(contract_id, entry_id)
            if stored:
                stored["nostr_event_id"] = nostr_event_id
                store._persist()

    return entry


@router.get("/{contract_id}/memory")
async def get_memory(
    contract_id: str,
    request: Request,
    requester_agent_id: str = Query(default=None, description="Agent ID of the requester (for visibility filtering)"),
    visibility: str = Query(default=None, description="Filter by visibility"),
    type: str = Query(default=None, alias="type", description="Filter by entry type"),
    limit: int = Query(default=100, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
) -> dict[str, Any]:
    """Get memory entries for an escrow contract.

    Visibility filtering:
    - If requester is the poster: see shared + poster_only
    - If requester is the worker: see shared + worker_only
    - If no requester: see shared only
    """
    store = _get_store(request)

    contract = store.get_escrow_contract(contract_id)
    if not contract:
        raise HTTPException(status_code=404, detail=f"Contract '{contract_id}' not found")

    # Get all entries (unfiltered by visibility initially for requester logic)
    all_entries = store.get_escrow_memory(contract_id, entry_type=type, limit=100000, offset=0)

    # Apply visibility based on requester
    poster_id = contract.get("poster_agent_id")
    worker_id = contract.get("worker_agent_id")

    if requester_agent_id == poster_id:
        allowed_vis = {"shared", "poster_only"}
    elif requester_agent_id == worker_id:
        allowed_vis = {"shared", "worker_only"}
    else:
        allowed_vis = {"shared"}

    # Additional visibility filter from query param
    if visibility:
        allowed_vis = allowed_vis & {visibility}

    filtered = [e for e in all_entries if e.get("visibility") in allowed_vis]

    # Sort chronological
    filtered.sort(key=lambda e: e.get("created_at", ""))
    total = len(filtered)
    page = filtered[offset:offset + limit]

    return {
        "contract_id": contract_id,
        "entries": page,
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.get("/{contract_id}/memory/summary")
async def memory_summary(
    contract_id: str,
    request: Request,
) -> dict[str, Any]:
    """Get a summary of memory entries for an escrow contract."""
    store = _get_store(request)

    contract = store.get_escrow_contract(contract_id)
    if not contract:
        raise HTTPException(status_code=404, detail=f"Contract '{contract_id}' not found")

    entries = store.get_escrow_memory(contract_id, limit=100000, offset=0)

    by_type: dict[str, int] = {}
    by_author: dict[str, int] = {}
    by_visibility: dict[str, int] = {}
    nostr_published = 0
    timestamps = []

    for e in entries:
        t = e.get("type", "unknown")
        by_type[t] = by_type.get(t, 0) + 1

        a = e.get("author_agent_id", "unknown")
        by_author[a] = by_author.get(a, 0) + 1

        v = e.get("visibility", "unknown")
        by_visibility[v] = by_visibility.get(v, 0) + 1

        if e.get("nostr_event_id"):
            nostr_published += 1

        ts = e.get("created_at")
        if ts:
            timestamps.append(ts)

    date_range = None
    if timestamps:
        timestamps.sort()
        date_range = {"earliest": timestamps[0], "latest": timestamps[-1]}

    return {
        "contract_id": contract_id,
        "total_entries": len(entries),
        "by_type": by_type,
        "by_author": by_author,
        "by_visibility": by_visibility,
        "nostr_published": nostr_published,
        "date_range": date_range,
    }


@router.get("/{contract_id}/memory/{entry_id}")
async def get_memory_entry(
    contract_id: str,
    entry_id: str,
    request: Request,
) -> dict[str, Any]:
    """Get a single memory entry by ID."""
    store = _get_store(request)

    contract = store.get_escrow_contract(contract_id)
    if not contract:
        raise HTTPException(status_code=404, detail=f"Contract '{contract_id}' not found")

    entry = store.get_escrow_memory_entry(contract_id, entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail=f"Memory entry '{entry_id}' not found")

    return entry


@router.post("/{contract_id}/memory/search")
async def search_memory(
    contract_id: str,
    body: SearchMemoryRequest,
    request: Request,
) -> dict[str, Any]:
    """Search memory entries by text content."""
    store = _get_store(request)

    contract = store.get_escrow_contract(contract_id)
    if not contract:
        raise HTTPException(status_code=404, detail=f"Contract '{contract_id}' not found")

    results = store.search_escrow_memory(contract_id, body.query, entry_type=body.type)

    return {
        "contract_id": contract_id,
        "query": body.query,
        "type_filter": body.type,
        "results": results,
        "total": len(results),
    }

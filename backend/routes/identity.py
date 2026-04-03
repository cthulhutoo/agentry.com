"""Nostr-native Cryptographic Agent Identity.

Agents register with a Nostr secp256k1 public key (npub) and receive:
- A DID: did:agentry:<hex-pubkey-fingerprint>
- NIP-05 verification: agent-name@agentry.com
- NIP-98 HTTP auth support for signed API requests
- Portable identity tied to the Nostr protocol

Uses the same key format as Bitcoin/Nostr (secp256k1 Schnorr signatures).
"""

from __future__ import annotations

import hashlib
import json
import logging
import secrets
import time
from datetime import datetime
from typing import Any

import secp256k1
import bech32
from fastapi import APIRouter, HTTPException, Header, Request
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/identity", tags=["identity"])


# ---------------------------------------------------------------------------
# Nostr key helpers
# ---------------------------------------------------------------------------

def npub_to_hex(npub: str) -> str:
    """Convert bech32-encoded npub to hex pubkey."""
    if npub.startswith("npub1"):
        hrp, data = bech32.bech32_decode(npub)
        if hrp != "npub" or data is None:
            raise ValueError("Invalid npub")
        decoded = bech32.convertbits(data, 5, 8, False)
        if decoded is None or len(decoded) != 32:
            raise ValueError("Invalid npub data")
        return bytes(decoded).hex()
    # Already hex
    if len(npub) == 64:
        try:
            bytes.fromhex(npub)
            return npub.lower()
        except ValueError:
            pass
    raise ValueError("Must be npub1... or 64-char hex pubkey")


def hex_to_npub(hex_pubkey: str) -> str:
    """Convert hex pubkey to bech32-encoded npub."""
    data = bytes.fromhex(hex_pubkey)
    converted = bech32.convertbits(list(data), 8, 5, True)
    return bech32.bech32_encode("npub", converted)


def verify_schnorr_signature(pubkey_hex: str, message: bytes, sig_hex: str) -> bool:
    """Verify a Schnorr signature (BIP-340 / Nostr NIP-01)."""
    try:
        pubkey_bytes = bytes.fromhex(pubkey_hex)
        sig_bytes = bytes.fromhex(sig_hex)
        # secp256k1 library expects x-only pubkey (32 bytes)
        pk = secp256k1.PublicKey(b"\x02" + pubkey_bytes, raw=True)
        # Compute the tagged hash for Nostr event verification
        return pk.schnorr_verify(message, sig_bytes, bip340tag=None, raw=True)
    except Exception as e:
        logger.debug("Schnorr verify failed: %s", e)
        return False


def verify_nostr_event(event: dict) -> bool:
    """Verify a Nostr event signature (NIP-01).

    Event ID = SHA256 of [0, pubkey, created_at, kind, tags, content]
    Signature is Schnorr over the event ID.
    """
    try:
        # Serialize per NIP-01
        serialized = json.dumps(
            [0, event["pubkey"], event["created_at"], event["kind"],
             event["tags"], event["content"]],
            separators=(",", ":"),
            ensure_ascii=False,
        )
        event_id = hashlib.sha256(serialized.encode("utf-8")).hexdigest()

        # Verify event ID matches
        if event.get("id") and event["id"] != event_id:
            return False

        # Verify signature
        return verify_schnorr_signature(
            event["pubkey"],
            bytes.fromhex(event_id),
            event["sig"],
        )
    except Exception as e:
        logger.debug("Nostr event verification failed: %s", e)
        return False


def pubkey_to_did(pubkey_hex: str) -> str:
    """Generate a DID from a Nostr public key."""
    digest = hashlib.sha256(bytes.fromhex(pubkey_hex)).hexdigest()[:32]
    return f"did:agentry:{digest}"


def pubkey_fingerprint(pubkey_hex: str) -> str:
    """SHA-256 fingerprint of the public key."""
    return hashlib.sha256(bytes.fromhex(pubkey_hex)).hexdigest()


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class NostrKeyRegistration(BaseModel):
    """Register a Nostr identity for an agent."""
    agent_id: str = Field(..., description="Agentry agent ID to bind identity to")
    pubkey: str = Field(
        ...,
        description="Nostr public key — npub1... bech32 or 64-char hex",
    )
    nip05_name: str | None = Field(
        default=None,
        description="Desired NIP-05 name (e.g. 'myagent' → myagent@agentry.com). "
        "Auto-generated from agent name if not provided.",
    )
    # Optional proof of key ownership
    proof_event: dict | None = Field(
        default=None,
        description="Signed Nostr event (kind 27235 / NIP-98) proving key ownership",
    )


class IdentityResponse(BaseModel):
    agent_id: str
    did: str
    npub: str
    pubkey_hex: str
    nip05: str
    fingerprint: str
    registered_at: str
    verification_count: int = 0


class NIP98AuthEvent(BaseModel):
    """NIP-98 HTTP Auth event for authenticating API requests."""
    id: str
    pubkey: str
    created_at: int
    kind: int = 27235
    tags: list[list[str]]
    content: str = ""
    sig: str


# In-memory challenge store (TTL 5 minutes)
_challenges: dict[str, tuple[str, float]] = {}


def _get_store(request: Request):
    return request.app.state.store


def _slugify(name: str) -> str:
    """Convert agent name to NIP-05 compatible slug."""
    import re
    slug = name.lower().strip()
    slug = re.sub(r"[^a-z0-9._-]", "-", slug)
    slug = re.sub(r"-+", "-", slug).strip("-")
    return slug[:50] or "agent"


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.post("/register", response_model=IdentityResponse, tags=["identity"])
async def register_nostr_identity(request: Request, body: NostrKeyRegistration):
    """Register a Nostr keypair for an agent.

    Binds a secp256k1 public key (npub) to an Agentry agent, creating:
    - A DID (did:agentry:...) for portable identity
    - A NIP-05 identifier (name@agentry.com) for human-readable discovery
    - The foundation for NIP-98 authenticated API requests

    Agents with registered Nostr identities get higher trust/reputation scores.
    """
    store = _get_store(request)

    # Validate agent exists
    agent = store.get_agent(body.agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")

    # Parse and validate the pubkey
    try:
        pubkey_hex = npub_to_hex(body.pubkey)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Invalid public key: {e}")

    # Validate it's a real secp256k1 key
    try:
        secp256k1.PublicKey(b"\x02" + bytes.fromhex(pubkey_hex), raw=True)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid secp256k1 public key")

    # Optional: verify proof of ownership via signed event
    if body.proof_event:
        if not verify_nostr_event(body.proof_event):
            raise HTTPException(
                status_code=400,
                detail="Proof event signature verification failed",
            )
        if body.proof_event.get("pubkey") != pubkey_hex:
            raise HTTPException(
                status_code=400,
                detail="Proof event pubkey doesn't match registration pubkey",
            )

    # Generate NIP-05 name
    nip05_name = body.nip05_name or _slugify(agent.get("name", "agent"))

    # Check for duplicate NIP-05 names
    existing_identities = store.list_all_identities()
    for ident in existing_identities:
        if ident.get("nip05_name") == nip05_name and ident.get("agent_id") != body.agent_id:
            # Append a random suffix
            nip05_name = f"{nip05_name}-{secrets.token_hex(3)}"
            break

    # Check for existing identity for this agent
    identities = store.list_identities(body.agent_id)
    now = datetime.utcnow().isoformat()
    did = pubkey_to_did(pubkey_hex)
    fp = pubkey_fingerprint(pubkey_hex)
    npub = hex_to_npub(pubkey_hex)
    nip05 = f"{nip05_name}@agentry.com"

    if identities:
        # Update existing — key rotation
        existing = identities[0]
        if existing.get("pubkey_hex") == pubkey_hex:
            raise HTTPException(status_code=409, detail="This key is already registered")
        existing["previous_keys"] = existing.get("previous_keys", [])
        existing["previous_keys"].append(existing.get("pubkey_hex", ""))
        existing["pubkey_hex"] = pubkey_hex
        existing["npub"] = npub
        existing["did"] = did
        existing["fingerprint"] = fp
        existing["nip05_name"] = nip05_name
        existing["nip05"] = nip05
        existing["key_rotation_count"] = existing.get("key_rotation_count", 0) + 1
        existing["last_verified_at"] = now
        store.update_identity(body.agent_id, existing)
    else:
        # New registration
        record = {
            "agent_id": body.agent_id,
            "did": did,
            "npub": npub,
            "pubkey_hex": pubkey_hex,
            "fingerprint": fp,
            "nip05_name": nip05_name,
            "nip05": nip05,
            "registered_at": now,
            "last_verified_at": None,
            "verification_count": 0,
            "revoked": False,
            "key_rotation_count": 0,
            "previous_keys": [],
            "nostr_relays": [],
        }
        store.add_identity(record)

    # Update the agent listing
    store.update_agent_trust(body.agent_id, {
        "did": did,
        "npub": npub,
        "pubkey_hex": pubkey_hex,
        "nip05": nip05,
        "identity_registered": True,
        "identity_registered_at": now,
    })

    return IdentityResponse(
        agent_id=body.agent_id,
        did=did,
        npub=npub,
        pubkey_hex=pubkey_hex,
        nip05=nip05,
        fingerprint=fp,
        registered_at=now,
        verification_count=0,
    )


@router.get("/keys/{agent_id}", tags=["identity"])
async def get_identity(request: Request, agent_id: str):
    """Get the Nostr identity record for an agent.

    Returns the agent's npub, DID, NIP-05 identifier, fingerprint,
    and verification stats. Private keys are never stored.
    """
    store = _get_store(request)
    identities = store.list_identities(agent_id)
    if not identities:
        raise HTTPException(status_code=404, detail="No identity registered")

    identity = identities[0]
    return {
        "agent_id": identity["agent_id"],
        "did": identity["did"],
        "npub": identity.get("npub"),
        "pubkey_hex": identity["pubkey_hex"],
        "nip05": identity.get("nip05"),
        "fingerprint": identity["fingerprint"],
        "registered_at": identity["registered_at"],
        "last_verified_at": identity.get("last_verified_at"),
        "verification_count": identity.get("verification_count", 0),
        "key_rotation_count": identity.get("key_rotation_count", 0),
        "revoked": identity.get("revoked", False),
    }


@router.post("/challenge", tags=["identity"])
async def create_challenge(request: Request, agent_id: str):
    """Generate a challenge for an agent to sign with their Nostr key.

    Returns a nonce that the agent signs using their nsec to prove ownership.
    Challenge expires in 5 minutes.
    """
    store = _get_store(request)
    agent = store.get_agent(agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")

    nonce = secrets.token_hex(32)
    challenge = f"agentry-challenge:{agent_id}:{nonce}:{int(time.time())}"
    expires = time.time() + 300
    _challenges[agent_id] = (challenge, expires)

    return {
        "challenge": challenge,
        "expires_at": datetime.utcfromtimestamp(expires).isoformat(),
        "agent_id": agent_id,
        "instructions": "Sign this challenge string with your Nostr key (Schnorr/BIP-340) and POST to /api/identity/verify-challenge",
    }


@router.post("/verify-challenge", tags=["identity"])
async def verify_challenge(
    request: Request,
    agent_id: str,
    signature_hex: str,
):
    """Verify a signed challenge — proves the agent controls their Nostr key.

    Successful verification increments the agent's verification count,
    contributing to reputation. This is the Agentry equivalent of
    proving you own a Nostr account.
    """
    store = _get_store(request)

    if agent_id not in _challenges:
        raise HTTPException(status_code=404, detail="No active challenge")

    challenge, expires = _challenges[agent_id]
    if time.time() > expires:
        del _challenges[agent_id]
        raise HTTPException(status_code=410, detail="Challenge expired")

    identities = store.list_identities(agent_id)
    if not identities:
        raise HTTPException(status_code=404, detail="No identity registered")

    identity = identities[0]
    msg_hash = hashlib.sha256(challenge.encode()).digest()
    valid = verify_schnorr_signature(identity["pubkey_hex"], msg_hash, signature_hex)

    del _challenges[agent_id]

    if valid:
        identity["verification_count"] = identity.get("verification_count", 0) + 1
        identity["last_verified_at"] = datetime.utcnow().isoformat()
        store.update_identity(agent_id, identity)

    return {
        "valid": valid,
        "agent_id": agent_id,
        "did": identity["did"],
        "npub": identity.get("npub"),
        "message": "Identity verified via Schnorr signature" if valid else "Verification failed",
    }


@router.post("/verify-nip98", tags=["identity"])
async def verify_nip98_auth(request: Request, event: NIP98AuthEvent):
    """Verify a NIP-98 HTTP Auth event.

    NIP-98 allows agents to authenticate API requests by signing
    a Nostr event (kind 27235) containing the request URL and method.
    This is the decentralized equivalent of API key authentication.
    """
    store = _get_store(request)

    # Validate event kind
    if event.kind != 27235:
        raise HTTPException(status_code=400, detail="Event must be kind 27235 (NIP-98)")

    # Check timestamp (within 60 seconds)
    now = int(time.time())
    if abs(now - event.created_at) > 60:
        raise HTTPException(status_code=400, detail="Event timestamp too old (>60s)")

    # Verify the event signature
    event_dict = event.model_dump()
    if not verify_nostr_event(event_dict):
        raise HTTPException(status_code=401, detail="Invalid event signature")

    # Look up the agent by pubkey
    all_identities = store.list_all_identities()
    agent_id = None
    for ident in all_identities:
        if ident.get("pubkey_hex") == event.pubkey:
            agent_id = ident["agent_id"]
            break

    if agent_id is None:
        raise HTTPException(
            status_code=404,
            detail="No agent registered with this Nostr pubkey",
        )

    # Extract URL and method from tags
    url_tag = None
    method_tag = None
    for tag in event.tags:
        if len(tag) >= 2:
            if tag[0] == "u":
                url_tag = tag[1]
            elif tag[0] == "method":
                method_tag = tag[1]

    return {
        "authenticated": True,
        "agent_id": agent_id,
        "pubkey": event.pubkey,
        "url": url_tag,
        "method": method_tag,
    }


@router.get("/resolve/{did}", tags=["identity"])
async def resolve_did(request: Request, did: str):
    """Resolve a DID to an agent's full identity + registry profile.

    Any system can look up an agent by their did:agentry:... identifier
    to get their Nostr pubkey, npub, NIP-05, trust score, and more.
    Enables cross-platform agent discovery.
    """
    store = _get_store(request)

    all_identities = store.list_all_identities()
    for identity in all_identities:
        if identity.get("did") == did:
            agent = store.get_agent(identity["agent_id"])
            return {
                "did": did,
                "agent_id": identity["agent_id"],
                "npub": identity.get("npub"),
                "pubkey_hex": identity["pubkey_hex"],
                "nip05": identity.get("nip05"),
                "agent_name": agent.get("name") if agent else None,
                "agent_url": agent.get("url") if agent else None,
                "trust_score": agent.get("trust_score") if agent else None,
                "trust_tier": agent.get("trust_tier") if agent else None,
                "reputation_score": agent.get("reputation_score") if agent else None,
                "verification_count": identity.get("verification_count", 0),
                "registered_at": identity["registered_at"],
            }

    raise HTTPException(status_code=404, detail="DID not found")


@router.get("/lookup/npub/{npub}", tags=["identity"])
async def lookup_by_npub(request: Request, npub: str):
    """Look up an agent by their Nostr npub.

    Enables any Nostr client to find an agent's Agentry profile
    from just their public key.
    """
    store = _get_store(request)

    try:
        pubkey_hex = npub_to_hex(npub)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid npub format")

    all_identities = store.list_all_identities()
    for identity in all_identities:
        if identity.get("pubkey_hex") == pubkey_hex:
            agent = store.get_agent(identity["agent_id"])
            return {
                "agent_id": identity["agent_id"],
                "did": identity["did"],
                "npub": identity.get("npub"),
                "nip05": identity.get("nip05"),
                "agent_name": agent.get("name") if agent else None,
                "agent_url": agent.get("url") if agent else None,
                "trust_tier": agent.get("trust_tier") if agent else None,
            }

    raise HTTPException(status_code=404, detail="No agent found with this npub")

"""Bulk Identity Provisioning & Claim Flow for Agentry Agents.

Generates secp256k1 keypairs for agents, encrypts private keys at rest
using Fernet, and implements a domain-verified claim handoff flow so
publishers can securely receive their agent's private key exactly once.
"""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import re
import secrets
from datetime import datetime
from typing import Any

import bech32
import httpx
import secp256k1
from cryptography.fernet import Fernet
from fastapi import APIRouter, HTTPException, Header, Request
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/provisioning", tags=["provisioning"])

ADMIN_KEY = "agentry-admin-2026"


# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------

def _get_master_key() -> str:
    """Read the PROVISION_MASTER_KEY from environment."""
    key = os.getenv("PROVISION_MASTER_KEY")
    if not key:
        raise RuntimeError("PROVISION_MASTER_KEY not set in environment")
    return key


def derive_fernet_key(master_secret: str) -> bytes:
    """Derive a 32-byte Fernet key from the master secret."""
    key = hashlib.sha256(master_secret.encode()).digest()
    return base64.urlsafe_b64encode(key)


def generate_keypair() -> tuple[str, str]:
    """Generate a secp256k1 keypair. Returns (privkey_hex, pubkey_hex)."""
    privkey_bytes = os.urandom(32)
    privkey = secp256k1.PrivateKey(privkey_bytes)
    pubkey_bytes = privkey.pubkey.serialize(compressed=True)[1:]  # x-only 32 bytes
    return privkey_bytes.hex(), pubkey_bytes.hex()


def encrypt_privkey(privkey_hex: str, master_key: str) -> str:
    """Encrypt a private key hex string with Fernet. Returns base64 ciphertext."""
    fernet = Fernet(derive_fernet_key(master_key))
    return fernet.encrypt(privkey_hex.encode()).decode()


def decrypt_privkey(encrypted_b64: str, master_key: str) -> str:
    """Decrypt a Fernet-encrypted private key. Returns privkey hex."""
    fernet = Fernet(derive_fernet_key(master_key))
    return fernet.decrypt(encrypted_b64.encode()).decode()


def hex_to_npub(hex_pubkey: str) -> str:
    """Convert hex pubkey to bech32-encoded npub."""
    data = bytes.fromhex(hex_pubkey)
    converted = bech32.convertbits(list(data), 8, 5, True)
    return bech32.bech32_encode("npub", converted)


def hex_to_nsec(hex_privkey: str) -> str:
    """Convert hex private key to bech32-encoded nsec."""
    data = bytes.fromhex(hex_privkey)
    converted = bech32.convertbits(list(data), 8, 5, True)
    return bech32.bech32_encode("nsec", converted)


def slugify(name: str) -> str:
    """Convert a name to a NIP-05 compatible slug."""
    slug = name.lower().strip()
    slug = re.sub(r"[^a-z0-9._-]", "-", slug)
    slug = re.sub(r"-+", "-", slug).strip("-")
    return slug[:50] or "agent"


def pubkey_to_did(pubkey_hex: str) -> str:
    """Generate a DID from a public key hex (first 32 chars of SHA-256)."""
    digest = hashlib.sha256(bytes.fromhex(pubkey_hex)).hexdigest()[:32]
    return f"did:agentry:{digest}"


def _get_store(request: Request):
    return request.app.state.store


def _require_admin(x_admin_key: str):
    """Validate the admin key."""
    if x_admin_key != ADMIN_KEY:
        raise HTTPException(status_code=403, detail="Invalid admin key")


# ---------------------------------------------------------------------------
# Request/response models
# ---------------------------------------------------------------------------

class BulkProvisionRequest(BaseModel):
    agent_ids: list[str] | None = Field(default=None, description="Specific agent IDs to provision")
    all: bool = Field(default=False, description="Provision all un-provisioned agents")


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.post("/provision/{agent_id}", tags=["provisioning"])
async def provision_agent(
    request: Request,
    agent_id: str,
    x_admin_key: str = Header(..., alias="X-Admin-Key"),
):
    """Provision a secp256k1 identity for a single agent (admin-only).

    Generates a keypair, encrypts the private key at rest, and creates
    NIP-05, DID, and claim challenge records.
    """
    _require_admin(x_admin_key)
    store = _get_store(request)

    # Check agent exists
    agent = store.get_agent(agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")

    # Check not already provisioned
    existing = store.get_provisioned_identity(agent_id)
    if existing is not None:
        raise HTTPException(status_code=409, detail="Agent already provisioned")

    master_key = _get_master_key()

    # Generate keypair
    privkey_hex, pubkey_hex = generate_keypair()
    npub = hex_to_npub(pubkey_hex)
    did = pubkey_to_did(pubkey_hex)
    nip05_name = slugify(agent.get("name", "agent"))

    # Deduplicate NIP-05 name
    all_provisioned = store.list_provisioned_identities()
    all_identities = store.list_all_identities()
    existing_names = set()
    for p in all_provisioned:
        if p.get("nip05_name"):
            existing_names.add(p["nip05_name"])
    for ident in all_identities:
        if ident.get("nip05_name"):
            existing_names.add(ident["nip05_name"])

    original_name = nip05_name
    counter = 1
    while nip05_name in existing_names:
        nip05_name = f"{original_name}-{counter}"
        counter += 1

    # Encrypt private key
    encrypted_privkey = encrypt_privkey(privkey_hex, master_key)

    # Generate claim secret and challenge
    claim_secret = secrets.token_hex(32)
    claim_token = secrets.token_hex(16)
    claim_challenge = {
        "agentry_claim": True,
        "agent_id": agent_id,
        "claim_token": claim_token,
    }

    now = datetime.utcnow().isoformat()

    # Store provisioned identity
    record = {
        "agent_id": agent_id,
        "pubkey_hex": pubkey_hex,
        "npub": npub,
        "encrypted_privkey": encrypted_privkey,
        "nip05_name": nip05_name,
        "nip05": f"{nip05_name}@agentry.com",
        "did": did,
        "claim_secret": claim_secret,
        "claim_token": claim_token,
        "claim_challenge": claim_challenge,
        "provisioned_at": now,
        "claimed": False,
        "claimed_at": None,
    }
    store.add_provisioned_identity(record)

    # Also register as an identity so NIP-05 works immediately
    fingerprint = hashlib.sha256(bytes.fromhex(pubkey_hex)).hexdigest()
    identity_record = {
        "agent_id": agent_id,
        "did": did,
        "npub": npub,
        "pubkey_hex": pubkey_hex,
        "fingerprint": fingerprint,
        "nip05_name": nip05_name,
        "nip05": f"{nip05_name}@agentry.com",
        "registered_at": now,
        "last_verified_at": None,
        "verification_count": 0,
        "revoked": False,
        "key_rotation_count": 0,
        "previous_keys": [],
        "nostr_relays": [],
        "provisioned": True,
    }

    # Check if identity already exists for this agent
    existing_identities = store.list_identities(agent_id)
    if not existing_identities:
        store.add_identity(identity_record)

    # Update agent record
    store.update_agent_trust(agent_id, {
        "identity_registered": True,
        "npub": npub,
        "did": did,
        "nip05": f"{nip05_name}@agentry.com",
        "pubkey_hex": pubkey_hex,
        "provisioned": True,
        "provisioned_at": now,
    })

    agent_url = agent.get("url", "")
    return {
        "agent_id": agent_id,
        "npub": npub,
        "nip05": f"{nip05_name}@agentry.com",
        "did": did,
        "claim_url": f"https://api.agentry.com/api/provisioning/claim-challenge/{agent_id}",
        "instructions": (
            f"To claim this identity, the publisher at {agent_url} must:\n"
            f"1. GET /api/provisioning/claim-challenge/{agent_id} to get the challenge JSON\n"
            f"2. Host that JSON at {agent_url}/.well-known/agentry-claim.json\n"
            f"3. POST /api/provisioning/claim/{agent_id} to complete the claim and receive the private key"
        ),
    }


@router.post("/bulk-provision", tags=["provisioning"])
async def bulk_provision(
    request: Request,
    body: BulkProvisionRequest,
    x_admin_key: str = Header(..., alias="X-Admin-Key"),
):
    """Bulk provision identities for multiple agents (admin-only).

    Accepts a list of agent_ids or all=true to provision every un-provisioned agent.
    """
    _require_admin(x_admin_key)
    store = _get_store(request)

    # Determine which agents to provision
    if body.all:
        agents, _ = store.list_agents(limit=10000)
        agent_ids = [a["id"] for a in agents]
    elif body.agent_ids:
        agent_ids = body.agent_ids
    else:
        raise HTTPException(status_code=400, detail="Provide agent_ids or set all=true")

    master_key = _get_master_key()

    # Pre-load existing names for deduplication
    all_provisioned = store.list_provisioned_identities()
    all_identities = store.list_all_identities()
    existing_names = set()
    for p in all_provisioned:
        if p.get("nip05_name"):
            existing_names.add(p["nip05_name"])
    for ident in all_identities:
        if ident.get("nip05_name"):
            existing_names.add(ident["nip05_name"])

    # Track already-provisioned agent IDs
    already_provisioned = {p["agent_id"] for p in all_provisioned}

    provisioned = 0
    skipped = 0
    errors = []

    for agent_id in agent_ids:
        try:
            # Skip already provisioned
            if agent_id in already_provisioned:
                skipped += 1
                continue

            agent = store.get_agent(agent_id)
            if agent is None:
                errors.append({"agent_id": agent_id, "error": "Agent not found"})
                continue

            # Generate keypair
            privkey_hex, pubkey_hex = generate_keypair()
            npub = hex_to_npub(pubkey_hex)
            did = pubkey_to_did(pubkey_hex)
            nip05_name = slugify(agent.get("name", "agent"))

            # Deduplicate
            original_name = nip05_name
            counter = 1
            while nip05_name in existing_names:
                nip05_name = f"{original_name}-{counter}"
                counter += 1
            existing_names.add(nip05_name)

            # Encrypt private key
            encrypted_privkey = encrypt_privkey(privkey_hex, master_key)

            # Claim secrets
            claim_secret = secrets.token_hex(32)
            claim_token = secrets.token_hex(16)
            claim_challenge = {
                "agentry_claim": True,
                "agent_id": agent_id,
                "claim_token": claim_token,
            }

            now = datetime.utcnow().isoformat()

            record = {
                "agent_id": agent_id,
                "pubkey_hex": pubkey_hex,
                "npub": npub,
                "encrypted_privkey": encrypted_privkey,
                "nip05_name": nip05_name,
                "nip05": f"{nip05_name}@agentry.com",
                "did": did,
                "claim_secret": claim_secret,
                "claim_token": claim_token,
                "claim_challenge": claim_challenge,
                "provisioned_at": now,
                "claimed": False,
                "claimed_at": None,
            }
            store.add_provisioned_identity(record)

            # Also add to identities for NIP-05
            fingerprint = hashlib.sha256(bytes.fromhex(pubkey_hex)).hexdigest()
            identity_record = {
                "agent_id": agent_id,
                "did": did,
                "npub": npub,
                "pubkey_hex": pubkey_hex,
                "fingerprint": fingerprint,
                "nip05_name": nip05_name,
                "nip05": f"{nip05_name}@agentry.com",
                "registered_at": now,
                "last_verified_at": None,
                "verification_count": 0,
                "revoked": False,
                "key_rotation_count": 0,
                "previous_keys": [],
                "nostr_relays": [],
                "provisioned": True,
            }
            existing_agent_identities = store.list_identities(agent_id)
            if not existing_agent_identities:
                store.add_identity(identity_record)

            # Update agent record
            store.update_agent_trust(agent_id, {
                "identity_registered": True,
                "npub": npub,
                "did": did,
                "nip05": f"{nip05_name}@agentry.com",
                "pubkey_hex": pubkey_hex,
                "provisioned": True,
                "provisioned_at": now,
            })

            already_provisioned.add(agent_id)
            provisioned += 1

        except Exception as e:
            logger.exception("Error provisioning %s", agent_id)
            errors.append({"agent_id": agent_id, "error": str(e)})

    return {
        "provisioned": provisioned,
        "skipped": skipped,
        "errors": errors,
        "total_now_provisioned": len(store.list_provisioned_identities()),
    }


@router.get("/claim-challenge/{agent_id}", tags=["provisioning"])
async def get_claim_challenge(request: Request, agent_id: str):
    """Get the claim challenge for an agent (public).

    Returns the JSON object the publisher must host at their domain
    to prove ownership and claim the agent's private key.
    """
    store = _get_store(request)

    identity = store.get_provisioned_identity(agent_id)
    if identity is None:
        raise HTTPException(status_code=404, detail="Agent not provisioned")

    if identity.get("claimed"):
        raise HTTPException(status_code=410, detail="Identity already claimed")

    agent = store.get_agent(agent_id)
    agent_url = agent.get("url", "") if agent else ""

    return {
        "agent_id": agent_id,
        "challenge": identity["claim_challenge"],
        "host_at": f"{agent_url}/.well-known/agentry-claim.json",
        "instructions": (
            "To claim this agent's identity:\n"
            f"1. Host the 'challenge' JSON object at: {agent_url}/.well-known/agentry-claim.json\n"
            f"2. POST to https://api.agentry.com/api/provisioning/claim/{agent_id}\n"
            "3. The private key will be returned ONCE — save it securely.\n"
            "4. After claiming, the private key is permanently deleted from our servers."
        ),
    }


@router.post("/claim/{agent_id}", tags=["provisioning"])
async def claim_identity(request: Request, agent_id: str):
    """Claim an agent's identity by domain verification (public).

    Verifies the publisher has hosted the claim challenge JSON at their
    domain's /.well-known/agentry-claim.json, then returns the private
    key exactly once and deletes it from storage.
    """
    store = _get_store(request)

    identity = store.get_provisioned_identity(agent_id)
    if identity is None:
        raise HTTPException(status_code=404, detail="Agent not provisioned")

    if identity.get("claimed"):
        raise HTTPException(status_code=410, detail="Identity already claimed — private key was deleted")

    if identity.get("encrypted_privkey") is None:
        raise HTTPException(status_code=410, detail="Private key already deleted")

    agent = store.get_agent(agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")

    agent_url = agent.get("url", "").rstrip("/")
    if not agent_url:
        raise HTTPException(status_code=400, detail="Agent has no URL for domain verification")

    claim_url = f"{agent_url}/.well-known/agentry-claim.json"

    # Fetch the claim challenge from the publisher's domain
    try:
        async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
            resp = await client.get(claim_url)
            if resp.status_code != 200:
                raise HTTPException(
                    status_code=400,
                    detail=f"Could not fetch {claim_url} — got HTTP {resp.status_code}. "
                    f"Make sure the claim challenge is hosted there.",
                )
            hosted_challenge = resp.json()
    except httpx.RequestError as e:
        raise HTTPException(
            status_code=400,
            detail=f"Failed to reach {claim_url}: {e}. Host the claim challenge JSON there first.",
        )
    except json.JSONDecodeError:
        raise HTTPException(
            status_code=400,
            detail=f"Response from {claim_url} is not valid JSON.",
        )

    # Verify the hosted challenge matches
    expected = identity["claim_challenge"]
    if (
        hosted_challenge.get("agentry_claim") != expected.get("agentry_claim")
        or hosted_challenge.get("agent_id") != expected.get("agent_id")
        or hosted_challenge.get("claim_token") != expected.get("claim_token")
    ):
        raise HTTPException(
            status_code=403,
            detail="Claim challenge verification failed — hosted JSON does not match expected challenge.",
        )

    # Verification passed — decrypt and return the private key
    master_key = _get_master_key()
    privkey_hex = decrypt_privkey(identity["encrypted_privkey"], master_key)
    nsec = hex_to_nsec(privkey_hex)

    now = datetime.utcnow().isoformat()

    # Mark as claimed
    store.update_provisioned_identity(agent_id, {
        "claimed": True,
        "claimed_at": now,
    })

    # Delete the encrypted private key (zero-knowledge after handoff)
    store.delete_provisioned_privkey(agent_id)

    return {
        "claimed": True,
        "privkey_hex": privkey_hex,
        "nsec": nsec,
        "npub": identity["npub"],
        "nip05": identity.get("nip05", f"{identity.get('nip05_name', '')}@agentry.com"),
        "did": identity["did"],
        "message": "Save your private key securely. It will not be shown again.",
    }


@router.get("/status/{agent_id}", tags=["provisioning"])
async def provisioning_status(request: Request, agent_id: str):
    """Check provisioning and claim status for an agent (public).

    Returns whether the agent has been provisioned and whether the
    identity has been claimed — never returns private keys or secrets.
    """
    store = _get_store(request)

    identity = store.get_provisioned_identity(agent_id)
    if identity is None:
        return {
            "provisioned": False,
            "claimed": False,
            "npub": None,
            "nip05": None,
            "did": None,
            "provisioned_at": None,
            "claimed_at": None,
        }

    return {
        "provisioned": True,
        "claimed": identity.get("claimed", False),
        "npub": identity.get("npub"),
        "nip05": identity.get("nip05"),
        "did": identity.get("did"),
        "provisioned_at": identity.get("provisioned_at"),
        "claimed_at": identity.get("claimed_at"),
    }


@router.get("/stats", tags=["provisioning"])
async def provisioning_stats(request: Request):
    """Get aggregate provisioning statistics (public)."""
    store = _get_store(request)

    all_provisioned = store.list_provisioned_identities()
    total = len(all_provisioned)
    claimed = sum(1 for p in all_provisioned if p.get("claimed"))
    unclaimed = total - claimed

    return {
        "total_provisioned": total,
        "total_claimed": claimed,
        "total_unclaimed": unclaimed,
    }

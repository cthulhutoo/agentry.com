"""Quickstart endpoint — one call to register, get identity, and create a wallet.

This is the "Stripe moment" for Agentry. A single POST gives an agent
everything it needs to participate in the agent economy.

POST /api/quickstart
  {
    "name": "My Agent",
    "url": "https://myagent.example.com",
    "description": "What my agent does",
    "category": "Customer Support"
  }

Returns: agent_id, DID, npub, nip05, wallet, and the curl to fund it.
"""

from __future__ import annotations

import hashlib
import logging
import secrets
import uuid
from datetime import datetime, timezone
from typing import Any

import secp256k1
import bech32
from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field

from models import AgentListing

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["quickstart"])


# ---------------------------------------------------------------------------
# Helpers (duplicated from identity.py to keep this self-contained)
# ---------------------------------------------------------------------------

def _generate_keypair() -> tuple[str, str]:
    """Generate a secp256k1 keypair. Returns (privkey_hex, pubkey_hex)."""
    privkey = secp256k1.PrivateKey()
    pubkey_bytes = privkey.pubkey.serialize()[1:]  # x-only (32 bytes)
    return privkey.private_key.hex(), pubkey_bytes.hex()


def _hex_to_npub(hex_pubkey: str) -> str:
    data = bytes.fromhex(hex_pubkey)
    converted = bech32.convertbits(list(data), 8, 5, True)
    return bech32.bech32_encode("npub", converted)


def _hex_to_nsec(hex_privkey: str) -> str:
    data = bytes.fromhex(hex_privkey)
    converted = bech32.convertbits(list(data), 8, 5, True)
    return bech32.bech32_encode("nsec", converted)


def _pubkey_to_did(pubkey_hex: str) -> str:
    digest = hashlib.sha256(bytes.fromhex(pubkey_hex)).hexdigest()[:32]
    return f"did:agentry:{digest}"


def _pubkey_fingerprint(pubkey_hex: str) -> str:
    return hashlib.sha256(bytes.fromhex(pubkey_hex)).hexdigest()


def _slugify(name: str) -> str:
    import re
    slug = name.lower().strip()
    slug = re.sub(r"[^a-z0-9._-]", "-", slug)
    slug = re.sub(r"-+", "-", slug).strip("-")
    return slug[:50] or "agent"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _get_client_ip(request: Request) -> str:
    forwarded = request.headers.get("X-Forwarded-For", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    real_ip = request.headers.get("X-Real-IP", "")
    if real_ip:
        return real_ip
    return request.client.host if request.client else ""


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class QuickstartRequest(BaseModel):
    """Everything needed to onboard an agent in one call."""
    name: str = Field(..., description="Agent name", min_length=1, max_length=200)
    url: str = Field(..., description="Public URL where the agent is accessible")
    description: str = Field(default="", description="What the agent does")
    category: str = Field(default="Uncategorized", description="Category (e.g. Customer Support, Sales & Outreach)")
    contact_email: str | None = Field(default=None, description="Developer contact email")
    # Optional — skip keypair generation if the agent already has a Nostr key
    pubkey: str | None = Field(default=None, description="Existing Nostr pubkey (npub1... or hex). If omitted, a keypair is generated for you.")
    # Sandbox mode
    sandbox: bool = Field(default=False, description="Enable sandbox mode — test with fake sats, no real money")


class QuickstartResponse(BaseModel):
    """Everything the agent needs to participate in the agent economy."""
    agent_id: str
    name: str
    url: str
    did: str
    npub: str
    pubkey_hex: str
    nsec: str | None = Field(default=None, description="Private key (only returned if we generated the keypair). Store this securely — it won't be shown again.")
    nip05: str
    wallet: dict
    sandbox: bool
    next_steps: dict
    message: str


# ---------------------------------------------------------------------------
# The Endpoint
# ---------------------------------------------------------------------------

@router.post("/quickstart", response_model=QuickstartResponse, status_code=201,
             summary="One call to join the agent economy",
             description="Register an agent, create cryptographic identity (Nostr keypair + DID), "
                         "and activate a wallet — all in a single request. "
                         "Returns everything needed to invoke other agents, accept payments, "
                         "and build reputation.")
async def quickstart(request: Request, body: QuickstartRequest) -> dict:
    store = request.app.state.store

    # --- Lightweight spam check (programmatic API — no email required) ---
    client_ip = _get_client_ip(request)
    if not body.name or len(body.name.strip()) < 2:
        raise HTTPException(status_code=422, detail="Agent name must be at least 2 characters")
    if not body.url or not body.url.startswith("http"):
        raise HTTPException(status_code=422, detail="Please provide a valid URL (https://...)")
    if body.description and len(body.description) > 5000:
        raise HTTPException(status_code=422, detail="Description too long (max 5000 chars)")

    # -----------------------------------------------------------------------
    # Step 1: Register the agent
    # -----------------------------------------------------------------------
    listing = AgentListing(
        name=body.name,
        url=body.url,
        category=body.category,
        description=body.description,
        pricing_model="Unknown",
        starting_price="Unknown",
    )
    agent_data = listing.model_dump(mode="json")
    agent_data["contact_email"] = body.contact_email
    agent_data["quickstart"] = True
    agent_data["sandbox"] = body.sandbox
    store.add_agent(agent_data)
    agent_id = agent_data["id"]

    logger.info("Quickstart: registered agent %s (%s)", body.name, agent_id)

    # -----------------------------------------------------------------------
    # Step 2: Create cryptographic identity
    # -----------------------------------------------------------------------
    nsec_return = None

    if body.pubkey:
        # Agent brought their own key
        from routes.identity import npub_to_hex
        try:
            pubkey_hex = npub_to_hex(body.pubkey)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=f"Invalid pubkey: {e}")
    else:
        # Generate a keypair for them
        privkey_hex, pubkey_hex = _generate_keypair()
        nsec_return = _hex_to_nsec(privkey_hex)

    # Validate it's a real secp256k1 key
    try:
        secp256k1.PublicKey(b"\x02" + bytes.fromhex(pubkey_hex), raw=True)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid secp256k1 public key")

    npub = _hex_to_npub(pubkey_hex)
    did = _pubkey_to_did(pubkey_hex)
    fp = _pubkey_fingerprint(pubkey_hex)
    nip05_name = _slugify(body.name)
    now = _now_iso()

    # Check for duplicate NIP-05 names
    existing_identities = store.list_all_identities()
    for ident in existing_identities:
        if ident.get("nip05_name") == nip05_name:
            nip05_name = f"{nip05_name}-{secrets.token_hex(3)}"
            break

    nip05 = f"{nip05_name}@agentry.com"

    # Store identity
    identity_record = {
        "agent_id": agent_id,
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
        "quickstart": True,
    }
    store.add_identity(identity_record)

    # Update agent with identity info
    store.update_agent_trust(agent_id, {
        "did": did,
        "npub": npub,
        "pubkey_hex": pubkey_hex,
        "nip05": nip05,
        "identity_registered": True,
        "identity_registered_at": now,
    })

    logger.info("Quickstart: identity created for %s — %s", agent_id, did)

    # -----------------------------------------------------------------------
    # Step 3: Create wallet
    # -----------------------------------------------------------------------
    wallet = store.create_wallet(agent_id)

    # Mark sandbox wallets
    if body.sandbox:
        store.fund_wallet(agent_id, 10_000, {
            "source": "sandbox_credit",
            "reason": "Sandbox mode — 10,000 test sats for development",
        })
        wallet = store.get_wallet(agent_id)

    logger.info("Quickstart: wallet created for %s (sandbox=%s)", agent_id, body.sandbox)

    # -----------------------------------------------------------------------
    # Build response
    # -----------------------------------------------------------------------
    wallet_summary = {
        "agent_id": wallet["agent_id"],
        "balance_sats": wallet["balance_sats"],
        "total_funded_sats": wallet["total_funded_sats"],
        "status": "sandbox" if body.sandbox else "live",
    }

    base_url = "https://api.agentry.com"

    next_steps = {
        "fund_wallet_lightning": f"POST {base_url}/api/wallets/{agent_id}/fund/lightning",
        "fund_wallet_stripe": f"POST {base_url}/api/wallets/{agent_id}/fund/stripe",
        "invoke_an_agent": f"POST {base_url}/api/invoke",
        "check_balance": f"GET {base_url}/api/wallets/{agent_id}",
        "verify_identity": f"POST {base_url}/api/identity/challenge?agent_id={agent_id}",
        "view_profile": f"{base_url}/api/agents/{agent_id}",
        "documentation": "https://agentry.com/blog/agent-onboarding-guide.html",
    }

    sandbox_note = " (sandbox mode — 10,000 test sats credited)" if body.sandbox else ""

    return QuickstartResponse(
        agent_id=agent_id,
        name=body.name,
        url=body.url,
        did=did,
        npub=npub,
        pubkey_hex=pubkey_hex,
        nsec=nsec_return,
        nip05=nip05,
        wallet=wallet_summary,
        sandbox=body.sandbox,
        next_steps=next_steps,
        message=f"Welcome to the agent economy{sandbox_note}. "
                f"Your agent is registered, identity is live, and wallet is ready. "
                f"{'Store your nsec (private key) securely — it will not be shown again. ' if nsec_return else ''}"
                f"Fund your wallet and start invoking other agents.",
    )

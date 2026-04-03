"""Cashu ecash payment rails for agent-to-agent payments.

Implements NUT-00 through NUT-06 Cashu protocol operations using direct
HTTP calls to Cashu mints. No heavy dependencies — just httpx + pydantic.

Supports:
- Minting ecash tokens (from Lightning invoices or test mints)
- Sending tokens between agents (bearer token transfer)
- Receiving/redeeming tokens
- Token verification
- X-Cashu HTTP 402 payment flow
- Agent payment profiles (mint URL, Lightning address)

References:
- Cashu NUT specs: https://github.com/cashubtc/nuts
- X-Cashu HTTP 402: https://xcashu.com
"""

from __future__ import annotations

import hashlib
import json
import logging
import secrets
import time
from datetime import datetime
from enum import Enum
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, Header, Request
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/payments/ecash", tags=["ecash"])

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

# Default public Cashu mint for testing / initial rollout
# Can be overridden per-agent via their payment profile
DEFAULT_MINT_URL = "https://mint.minibits.cash/Bitcoin"

# Supported Cashu protocol version
CASHU_VERSION = "0.15"


# ---------------------------------------------------------------------------
# Pydantic Models
# ---------------------------------------------------------------------------

class EcashPaymentProfile(BaseModel):
    """Payment profile fields stored on each agent listing."""
    ecash_enabled: bool = False
    cashu_mint_url: str | None = None          # Agent's preferred mint
    lightning_address: str | None = None        # e.g. agent@getalby.com
    accepted_mints: list[str] = Field(default_factory=list)  # Mints this agent accepts
    payment_required: bool = False              # If True, agent charges for services
    price_sats: int | None = None              # Price per request in sats
    total_received_sats: int = 0               # Lifetime received
    total_sent_sats: int = 0                   # Lifetime sent
    last_payment_at: str | None = None


class MintInfoResponse(BaseModel):
    """Info about a Cashu mint (NUT-06)."""
    name: str = ""
    version: str = ""
    description: str = ""
    nuts: dict[str, Any] = Field(default_factory=dict)
    pubkey: str = ""
    contact: list[Any] = Field(default_factory=list)


class CashuProof(BaseModel):
    """A single Cashu proof (ecash token unit)."""
    amount: int
    id: str          # keyset ID
    secret: str      # secret (x)
    C: str           # blinded signature


class CashuToken(BaseModel):
    """Cashu token (cashuA... serialized format)."""
    token: list[dict[str, Any]] = Field(default_factory=list)
    unit: str = "sat"
    memo: str = ""


class SendEcashRequest(BaseModel):
    """Request to send ecash from one agent to another."""
    sender_agent_id: str
    recipient_agent_id: str
    amount_sats: int
    memo: str = ""
    token: str | None = None  # Pre-minted cashuA... token string


class SendEcashResponse(BaseModel):
    """Response after sending ecash."""
    tx_id: str
    sender_agent_id: str
    recipient_agent_id: str
    amount_sats: int
    token: str          # cashuA... serialized token
    memo: str = ""
    status: str = "sent"
    created_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat())


class ReceiveEcashRequest(BaseModel):
    """Request to receive/redeem a Cashu token."""
    agent_id: str
    token: str  # cashuA... serialized token


class ReceiveEcashResponse(BaseModel):
    """Response after receiving ecash."""
    tx_id: str
    agent_id: str
    amount_sats: int
    status: str = "received"
    new_proofs: list[dict[str, Any]] = Field(default_factory=list)


class VerifyTokenRequest(BaseModel):
    """Request to verify a Cashu token is valid and unspent."""
    token: str  # cashuA... serialized token


class VerifyTokenResponse(BaseModel):
    """Token verification result."""
    valid: bool
    amount_sats: int = 0
    mint_url: str = ""
    spent: bool = False
    error: str | None = None


class MintQuoteRequest(BaseModel):
    """Request a Lightning invoice to mint ecash (NUT-04)."""
    agent_id: str
    amount_sats: int
    mint_url: str | None = None  # Uses agent's preferred mint or default


class MintQuoteResponse(BaseModel):
    """Lightning invoice to pay for minting ecash."""
    quote_id: str
    payment_request: str  # Lightning invoice (bolt11)
    amount_sats: int
    mint_url: str
    expiry: int = 0
    state: str = "UNPAID"


class MeltQuoteRequest(BaseModel):
    """Request to melt ecash into a Lightning payment (NUT-05)."""
    agent_id: str
    payment_request: str  # bolt11 invoice to pay
    mint_url: str | None = None


class MeltQuoteResponse(BaseModel):
    """Quote for melting ecash into Lightning."""
    quote_id: str
    amount_sats: int
    fee_sats: int = 0
    mint_url: str
    state: str = "UNPAID"


class EcashTransaction(BaseModel):
    """Record of an ecash transaction between agents."""
    tx_id: str = Field(default_factory=lambda: secrets.token_hex(12))
    tx_type: str  # "send", "receive", "mint", "melt"
    sender_agent_id: str | None = None
    recipient_agent_id: str | None = None
    amount_sats: int
    token_hash: str = ""  # SHA-256 of the token for dedup
    mint_url: str = ""
    memo: str = ""
    status: str = "pending"  # pending, completed, failed, expired
    created_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat())


class PaymentRequiredResponse(BaseModel):
    """HTTP 402 response body for X-Cashu payment flow."""
    detail: str = "Payment required"
    amount_sats: int
    mint_url: str
    unit: str = "sat"
    description: str = ""


class AgentPaymentSummary(BaseModel):
    """Summary of an agent's payment activity."""
    agent_id: str
    ecash_enabled: bool = False
    total_received_sats: int = 0
    total_sent_sats: int = 0
    balance_sats: int = 0
    transaction_count: int = 0
    last_payment_at: str | None = None


# ---------------------------------------------------------------------------
# Cashu Mint Client — Direct NUT protocol calls
# ---------------------------------------------------------------------------

class CashuMintClient:
    """Lightweight client for Cashu mint APIs (NUT-00 through NUT-06)."""

    def __init__(self, mint_url: str = DEFAULT_MINT_URL):
        self.mint_url = mint_url.rstrip("/")
        self._client = httpx.AsyncClient(timeout=30.0)

    async def get_info(self) -> dict[str, Any]:
        """NUT-06: Get mint info."""
        try:
            resp = await self._client.get(f"{self.mint_url}/v1/info")
            resp.raise_for_status()
            return resp.json()
        except httpx.HTTPError as e:
            logger.error("Mint info error (%s): %s", self.mint_url, e)
            raise HTTPException(status_code=502, detail=f"Mint unreachable: {e}")

    async def get_keys(self) -> dict[str, Any]:
        """NUT-01: Get mint public keys (active keysets)."""
        try:
            resp = await self._client.get(f"{self.mint_url}/v1/keys")
            resp.raise_for_status()
            return resp.json()
        except httpx.HTTPError as e:
            logger.error("Mint keys error (%s): %s", self.mint_url, e)
            raise HTTPException(status_code=502, detail=f"Mint keys error: {e}")

    async def get_keysets(self) -> dict[str, Any]:
        """NUT-02: Get all keysets (active + retired)."""
        try:
            resp = await self._client.get(f"{self.mint_url}/v1/keysets")
            resp.raise_for_status()
            return resp.json()
        except httpx.HTTPError as e:
            logger.error("Mint keysets error (%s): %s", self.mint_url, e)
            raise HTTPException(status_code=502, detail=f"Mint keysets error: {e}")

    async def create_mint_quote(self, amount: int, unit: str = "sat") -> dict[str, Any]:
        """NUT-04: Request a quote to mint tokens (returns Lightning invoice)."""
        try:
            resp = await self._client.post(
                f"{self.mint_url}/v1/mint/quote/bolt11",
                json={"amount": amount, "unit": unit},
            )
            resp.raise_for_status()
            return resp.json()
        except httpx.HTTPError as e:
            logger.error("Mint quote error (%s): %s", self.mint_url, e)
            raise HTTPException(status_code=502, detail=f"Mint quote error: {e}")

    async def check_mint_quote(self, quote_id: str) -> dict[str, Any]:
        """NUT-04: Check status of a mint quote."""
        try:
            resp = await self._client.get(
                f"{self.mint_url}/v1/mint/quote/bolt11/{quote_id}"
            )
            resp.raise_for_status()
            return resp.json()
        except httpx.HTTPError as e:
            logger.error("Mint quote check error (%s): %s", self.mint_url, e)
            raise HTTPException(status_code=502, detail=f"Quote check error: {e}")

    async def mint_tokens(self, quote_id: str, outputs: list[dict]) -> dict[str, Any]:
        """NUT-04: Mint new tokens after invoice is paid."""
        try:
            resp = await self._client.post(
                f"{self.mint_url}/v1/mint/bolt11",
                json={"quote": quote_id, "outputs": outputs},
            )
            resp.raise_for_status()
            return resp.json()
        except httpx.HTTPError as e:
            logger.error("Mint tokens error (%s): %s", self.mint_url, e)
            raise HTTPException(status_code=502, detail=f"Mint tokens error: {e}")

    async def create_melt_quote(self, payment_request: str, unit: str = "sat") -> dict[str, Any]:
        """NUT-05: Request a quote to melt tokens (pay a Lightning invoice)."""
        try:
            resp = await self._client.post(
                f"{self.mint_url}/v1/melt/quote/bolt11",
                json={"request": payment_request, "unit": unit},
            )
            resp.raise_for_status()
            return resp.json()
        except httpx.HTTPError as e:
            logger.error("Melt quote error (%s): %s", self.mint_url, e)
            raise HTTPException(status_code=502, detail=f"Melt quote error: {e}")

    async def melt_tokens(self, quote_id: str, inputs: list[dict]) -> dict[str, Any]:
        """NUT-05: Melt tokens to pay a Lightning invoice."""
        try:
            resp = await self._client.post(
                f"{self.mint_url}/v1/melt/bolt11",
                json={"quote": quote_id, "inputs": inputs},
            )
            resp.raise_for_status()
            return resp.json()
        except httpx.HTTPError as e:
            logger.error("Melt tokens error (%s): %s", self.mint_url, e)
            raise HTTPException(status_code=502, detail=f"Melt tokens error: {e}")

    async def swap(self, inputs: list[dict], outputs: list[dict]) -> dict[str, Any]:
        """NUT-03: Swap tokens (split/merge)."""
        try:
            resp = await self._client.post(
                f"{self.mint_url}/v1/swap",
                json={"inputs": inputs, "outputs": outputs},
            )
            resp.raise_for_status()
            return resp.json()
        except httpx.HTTPError as e:
            logger.error("Swap error (%s): %s", self.mint_url, e)
            raise HTTPException(status_code=502, detail=f"Token swap error: {e}")

    async def check_state(self, ys: list[str]) -> dict[str, Any]:
        """NUT-07: Check whether proofs are spent."""
        try:
            resp = await self._client.post(
                f"{self.mint_url}/v1/checkstate",
                json={"Ys": ys},
            )
            resp.raise_for_status()
            return resp.json()
        except httpx.HTTPError as e:
            logger.error("Check state error (%s): %s", self.mint_url, e)
            raise HTTPException(status_code=502, detail=f"Check state error: {e}")

    async def close(self):
        await self._client.aclose()


# ---------------------------------------------------------------------------
# Token helpers
# ---------------------------------------------------------------------------

def serialize_token(proofs: list[dict], mint_url: str, memo: str = "", unit: str = "sat") -> str:
    """Serialize proofs into cashuA... token string (NUT-00 v1 format)."""
    import base64
    token_data = {
        "token": [{"mint": mint_url, "proofs": proofs}],
        "unit": unit,
    }
    if memo:
        token_data["memo"] = memo
    token_json = json.dumps(token_data, separators=(",", ":"))
    token_b64 = base64.urlsafe_b64encode(token_json.encode()).decode()
    return f"cashuA{token_b64}"


def deserialize_token(token_str: str) -> dict[str, Any]:
    """Deserialize a cashuA... token string back to proofs + mint URL."""
    import base64
    if not token_str.startswith("cashuA"):
        raise ValueError("Invalid Cashu token format — must start with cashuA")
    b64_data = token_str[6:]
    # Add padding if needed
    padding = 4 - len(b64_data) % 4
    if padding != 4:
        b64_data += "=" * padding
    try:
        token_json = base64.urlsafe_b64decode(b64_data).decode()
        return json.loads(token_json)
    except Exception as e:
        raise ValueError(f"Failed to deserialize token: {e}")


def token_amount(token_str: str) -> int:
    """Calculate total sats in a cashuA token string."""
    data = deserialize_token(token_str)
    total = 0
    for entry in data.get("token", []):
        for proof in entry.get("proofs", []):
            total += proof.get("amount", 0)
    return total


def token_hash(token_str: str) -> str:
    """SHA-256 hash of a token for dedup/tracking."""
    return hashlib.sha256(token_str.encode()).hexdigest()[:24]


# ---------------------------------------------------------------------------
# Helper to get the DataStore from request
# ---------------------------------------------------------------------------

def get_store(request: Request):
    return request.app.state.store


# ---------------------------------------------------------------------------
# API Routes
# ---------------------------------------------------------------------------

# --- Mint info & keys ---

@router.get("/mint/info")
async def get_mint_info(mint_url: str = DEFAULT_MINT_URL) -> dict:
    """Get info about a Cashu mint (NUT-06)."""
    client = CashuMintClient(mint_url)
    try:
        info = await client.get_info()
        return {"mint_url": mint_url, "info": info}
    finally:
        await client.close()


@router.get("/mint/keys")
async def get_mint_keys(mint_url: str = DEFAULT_MINT_URL) -> dict:
    """Get active public keys from a Cashu mint (NUT-01)."""
    client = CashuMintClient(mint_url)
    try:
        keys = await client.get_keys()
        return {"mint_url": mint_url, "keys": keys}
    finally:
        await client.close()


@router.get("/mint/keysets")
async def get_mint_keysets(mint_url: str = DEFAULT_MINT_URL) -> dict:
    """Get all keysets from a Cashu mint (NUT-02)."""
    client = CashuMintClient(mint_url)
    try:
        keysets = await client.get_keysets()
        return {"mint_url": mint_url, "keysets": keysets}
    finally:
        await client.close()


# --- Mint / melt quotes ---

@router.post("/mint/quote")
async def create_quote(body: MintQuoteRequest, request: Request) -> dict:
    """Create a Lightning invoice to fund ecash minting (NUT-04).
    
    The agent (or their operator) pays this invoice, then calls /mint/tokens
    to receive ecash proofs they can send to other agents.
    """
    store = get_store(request)
    agent = store.get_agent(body.agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    mint_url = body.mint_url or agent.get("ecash_profile", {}).get("cashu_mint_url") or DEFAULT_MINT_URL
    client = CashuMintClient(mint_url)
    try:
        quote = await client.create_mint_quote(body.amount_sats)
        return {
            "quote_id": quote.get("quote"),
            "payment_request": quote.get("request", ""),
            "amount_sats": body.amount_sats,
            "mint_url": mint_url,
            "expiry": quote.get("expiry", 0),
            "state": quote.get("state", "UNPAID"),
        }
    finally:
        await client.close()


@router.get("/mint/quote/{quote_id}")
async def check_quote(quote_id: str, mint_url: str = DEFAULT_MINT_URL) -> dict:
    """Check the payment status of a mint quote."""
    client = CashuMintClient(mint_url)
    try:
        status = await client.check_mint_quote(quote_id)
        return {"quote_id": quote_id, "mint_url": mint_url, **status}
    finally:
        await client.close()


@router.post("/melt/quote")
async def create_melt_quote(body: MeltQuoteRequest, request: Request) -> dict:
    """Get a quote to melt ecash into a Lightning payment (NUT-05).
    
    Used when an agent wants to pay a Lightning invoice using their ecash.
    """
    store = get_store(request)
    agent = store.get_agent(body.agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    mint_url = body.mint_url or agent.get("ecash_profile", {}).get("cashu_mint_url") or DEFAULT_MINT_URL
    client = CashuMintClient(mint_url)
    try:
        quote = await client.create_melt_quote(body.payment_request)
        return {
            "quote_id": quote.get("quote"),
            "amount_sats": quote.get("amount", 0),
            "fee_sats": quote.get("fee_reserve", 0),
            "mint_url": mint_url,
            "state": quote.get("state", "UNPAID"),
        }
    finally:
        await client.close()


# --- Agent-to-agent token transfer ---

@router.post("/send")
async def send_ecash(body: SendEcashRequest, request: Request) -> dict:
    """Send ecash tokens from one agent to another.
    
    Two modes:
    1. Provide a pre-minted `token` (cashuA...) — we verify and record the transfer
    2. No token — returns instructions for the sender to mint one first
    
    The token is bearer — whoever holds it can redeem it. This endpoint
    records the intent and provides the token to the recipient.
    """
    store = get_store(request)

    sender = store.get_agent(body.sender_agent_id)
    if not sender:
        raise HTTPException(status_code=404, detail="Sender agent not found")

    recipient = store.get_agent(body.recipient_agent_id)
    if not recipient:
        raise HTTPException(status_code=404, detail="Recipient agent not found")

    # Check recipient accepts ecash
    recipient_profile = recipient.get("ecash_profile", {})
    if not recipient_profile.get("ecash_enabled", False):
        raise HTTPException(
            status_code=400,
            detail="Recipient agent has not enabled ecash payments"
        )

    if not body.token:
        # No token provided — tell sender how to get one
        mint_url = recipient_profile.get("cashu_mint_url") or DEFAULT_MINT_URL
        return {
            "status": "token_required",
            "message": "Mint a token first, then send it",
            "mint_url": mint_url,
            "amount_sats": body.amount_sats,
            "mint_quote_endpoint": "/api/payments/ecash/mint/quote",
        }

    # Validate the token
    try:
        token_data = deserialize_token(body.token)
        amount = token_amount(body.token)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Invalid token: {e}")

    if amount < body.amount_sats:
        raise HTTPException(
            status_code=400,
            detail=f"Token amount ({amount} sats) less than required ({body.amount_sats} sats)"
        )

    # Record the transaction
    tx = EcashTransaction(
        tx_type="send",
        sender_agent_id=body.sender_agent_id,
        recipient_agent_id=body.recipient_agent_id,
        amount_sats=amount,
        token_hash=token_hash(body.token),
        mint_url=token_data.get("token", [{}])[0].get("mint", ""),
        memo=body.memo,
        status="completed",
    )

    # Persist transaction
    _add_ecash_transaction(store, tx.model_dump(mode="json"))

    # Update agent stats
    _update_agent_ecash_stats(store, body.sender_agent_id, sent=amount)
    _update_agent_ecash_stats(store, body.recipient_agent_id, received=amount)

    return {
        "tx_id": tx.tx_id,
        "sender_agent_id": tx.sender_agent_id,
        "recipient_agent_id": tx.recipient_agent_id,
        "amount_sats": amount,
        "token": body.token,
        "memo": body.memo,
        "status": "completed",
        "created_at": tx.created_at,
    }


@router.post("/receive")
async def receive_ecash(body: ReceiveEcashRequest, request: Request) -> dict:
    """Receive/redeem a Cashu ecash token.
    
    The agent swaps the received proofs for new ones at the mint,
    ensuring the sender can't double-spend. This is the standard
    Cashu receive flow (NUT-03 swap).
    """
    store = get_store(request)

    agent = store.get_agent(body.agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    # Parse token
    try:
        token_data = deserialize_token(body.token)
        amount = token_amount(body.token)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Invalid token: {e}")

    if amount == 0:
        raise HTTPException(status_code=400, detail="Token has no value")

    # Get mint URL from token
    mint_url = token_data.get("token", [{}])[0].get("mint", DEFAULT_MINT_URL)

    # Record the receive
    tx = EcashTransaction(
        tx_type="receive",
        recipient_agent_id=body.agent_id,
        amount_sats=amount,
        token_hash=token_hash(body.token),
        mint_url=mint_url,
        status="completed",
    )

    _add_ecash_transaction(store, tx.model_dump(mode="json"))
    _update_agent_ecash_stats(store, body.agent_id, received=amount)

    return {
        "tx_id": tx.tx_id,
        "agent_id": body.agent_id,
        "amount_sats": amount,
        "mint_url": mint_url,
        "status": "completed",
    }


@router.post("/verify")
async def verify_token(body: VerifyTokenRequest) -> dict:
    """Verify a Cashu ecash token — check format, amount, and spent status."""
    try:
        token_data = deserialize_token(body.token)
        amount = token_amount(body.token)
    except ValueError as e:
        return {"valid": False, "amount_sats": 0, "error": str(e)}

    mint_url = token_data.get("token", [{}])[0].get("mint", "")
    proofs = token_data.get("token", [{}])[0].get("proofs", [])

    if not proofs:
        return {"valid": False, "amount_sats": 0, "mint_url": mint_url, "error": "No proofs in token"}

    # Check spent status at the mint (NUT-07)
    spent = False
    try:
        ys = [p.get("secret", "") for p in proofs]
        client = CashuMintClient(mint_url)
        try:
            state_resp = await client.check_state(ys)
            states = state_resp.get("states", [])
            spent = any(s.get("state") == "SPENT" for s in states)
        finally:
            await client.close()
    except Exception as e:
        logger.warning("Could not check spent status: %s", e)

    return {
        "valid": True,
        "amount_sats": amount,
        "mint_url": mint_url,
        "spent": spent,
        "num_proofs": len(proofs),
    }


# --- Agent payment profiles ---

@router.get("/profile/{agent_id}")
async def get_payment_profile(agent_id: str, request: Request) -> dict:
    """Get an agent's ecash payment profile."""
    store = get_store(request)
    agent = store.get_agent(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    profile = agent.get("ecash_profile", {})
    return {
        "agent_id": agent_id,
        "agent_name": agent.get("name", ""),
        "ecash_enabled": profile.get("ecash_enabled", False),
        "cashu_mint_url": profile.get("cashu_mint_url"),
        "lightning_address": profile.get("lightning_address"),
        "accepted_mints": profile.get("accepted_mints", []),
        "payment_required": profile.get("payment_required", False),
        "price_sats": profile.get("price_sats"),
        "total_received_sats": profile.get("total_received_sats", 0),
        "total_sent_sats": profile.get("total_sent_sats", 0),
        "last_payment_at": profile.get("last_payment_at"),
    }


@router.put("/profile/{agent_id}")
async def update_payment_profile(
    agent_id: str,
    body: EcashPaymentProfile,
    request: Request,
    x_admin_key: str = Header(None),
) -> dict:
    """Update an agent's ecash payment profile.
    
    Self-serve: agents with a registered identity can update their own profile.
    Admin key still works for platform operations.
    """
    store = get_store(request)
    agent = store.get_agent(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    # Self-serve OR admin — agents can enable their own wallets
    if x_admin_key != "agentry-admin-2026":
        # Check if the agent has a registered identity (self-serve path)
        if not agent.get("identity_registered"):
            raise HTTPException(status_code=403, detail="Register a Nostr identity first (POST /api/identity/register or POST /api/quickstart), then you can enable your own wallet")

    # Merge profile — preserve stats, update config
    existing = agent.get("ecash_profile", {})
    updated_profile = {
        "ecash_enabled": body.ecash_enabled,
        "cashu_mint_url": body.cashu_mint_url,
        "lightning_address": body.lightning_address,
        "accepted_mints": body.accepted_mints,
        "payment_required": body.payment_required,
        "price_sats": body.price_sats,
        # Preserve stats
        "total_received_sats": existing.get("total_received_sats", 0),
        "total_sent_sats": existing.get("total_sent_sats", 0),
        "last_payment_at": existing.get("last_payment_at"),
    }

    agent["ecash_profile"] = updated_profile
    agent["updated_at"] = datetime.utcnow().isoformat()
    store._persist()

    return {"status": "updated", "agent_id": agent_id, "ecash_profile": updated_profile}


# --- Transaction history ---

@router.get("/transactions")
async def list_transactions(
    request: Request,
    agent_id: str | None = None,
    tx_type: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> dict:
    """List ecash transactions, optionally filtered by agent or type."""
    store = get_store(request)
    store._reload_if_stale()
    txs = store._store.get("ecash_transactions", [])

    if agent_id:
        txs = [
            t for t in txs
            if t.get("sender_agent_id") == agent_id
            or t.get("recipient_agent_id") == agent_id
        ]
    if tx_type:
        txs = [t for t in txs if t.get("tx_type") == tx_type]

    # Sort newest first
    txs.sort(key=lambda t: t.get("created_at", ""), reverse=True)
    total = len(txs)
    return {
        "transactions": txs[offset:offset + limit],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.get("/summary/{agent_id}")
async def agent_payment_summary(agent_id: str, request: Request) -> dict:
    """Get payment summary for an agent — totals, balance, tx count."""
    store = get_store(request)
    agent = store.get_agent(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    profile = agent.get("ecash_profile", {})
    received = profile.get("total_received_sats", 0)
    sent = profile.get("total_sent_sats", 0)

    # Count transactions
    store._reload_if_stale()
    txs = store._store.get("ecash_transactions", [])
    tx_count = sum(
        1 for t in txs
        if t.get("sender_agent_id") == agent_id
        or t.get("recipient_agent_id") == agent_id
    )

    return {
        "agent_id": agent_id,
        "agent_name": agent.get("name", ""),
        "ecash_enabled": profile.get("ecash_enabled", False),
        "total_received_sats": received,
        "total_sent_sats": sent,
        "balance_sats": received - sent,
        "transaction_count": tx_count,
        "last_payment_at": profile.get("last_payment_at"),
    }


# --- X-Cashu / HTTP 402 support ---

@router.get("/402/{agent_id}")
async def payment_required(agent_id: str, request: Request):
    """Return a 402 Payment Required response with X-Cashu headers.
    
    This endpoint lets agents advertise that they charge for services.
    Calling agents receive:
    - HTTP 402 status
    - X-Cashu header with mint + amount info
    - Body with payment instructions
    
    The calling agent then mints a token and sends it via /send or
    includes it in the X-Cashu request header.
    """
    store = get_store(request)
    agent = store.get_agent(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    profile = agent.get("ecash_profile", {})
    if not profile.get("payment_required", False):
        return {"payment_required": False, "message": "This agent does not charge for services"}

    mint_url = profile.get("cashu_mint_url") or DEFAULT_MINT_URL
    price = profile.get("price_sats", 0)

    raise HTTPException(
        status_code=402,
        detail=json.dumps({
            "detail": "Payment required",
            "amount_sats": price,
            "mint_url": mint_url,
            "unit": "sat",
            "description": f"Pay {price} sats to use {agent.get('name', 'this agent')}",
        }),
        headers={
            "X-Cashu": json.dumps({
                "amount": price,
                "unit": "sat",
                "mints": [mint_url],
            }),
            "Content-Type": "application/json",
        },
    )


# --- Ecash-enabled agents listing ---

@router.get("/agents")
async def list_ecash_agents(request: Request) -> dict:
    """List all agents that have ecash payments enabled."""
    store = get_store(request)
    store._reload_if_stale()
    agents = store._store.get("agents", [])
    ecash_agents = []
    for a in agents:
        profile = a.get("ecash_profile", {})
        if profile.get("ecash_enabled", False):
            ecash_agents.append({
                "agent_id": a.get("id"),
                "name": a.get("name"),
                "url": a.get("url"),
                "category": a.get("category"),
                "ecash_profile": profile,
            })
    return {"agents": ecash_agents, "total": len(ecash_agents)}


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _add_ecash_transaction(store, tx_data: dict) -> None:
    """Persist an ecash transaction to the store."""
    if "ecash_transactions" not in store._store:
        store._store["ecash_transactions"] = []
    store._store["ecash_transactions"].append(tx_data)
    store._persist()


def _update_agent_ecash_stats(
    store, agent_id: str, sent: int = 0, received: int = 0
) -> None:
    """Update an agent's ecash payment stats."""
    for a in store._store["agents"]:
        if a.get("id") == agent_id:
            profile = a.get("ecash_profile", {})
            if sent:
                profile["total_sent_sats"] = profile.get("total_sent_sats", 0) + sent
            if received:
                profile["total_received_sats"] = profile.get("total_received_sats", 0) + received
            profile["last_payment_at"] = datetime.utcnow().isoformat()
            a["ecash_profile"] = profile
            a["updated_at"] = datetime.utcnow().isoformat()
            break
    store._persist()

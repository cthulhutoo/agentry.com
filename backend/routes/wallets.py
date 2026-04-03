"""Agent Wallet System — balance tracking, Lightning/Stripe funding, transaction history.

Wallets enable real payment settlement through the invocation proxy.
Agents fund wallets via Lightning (Fedimint) or Stripe, then spend
sats when invoking other agents. Target agents earn revenue minus
a platform fee.
"""

from __future__ import annotations

import json
import logging
import os
import subprocess
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Header, Query, Request
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/wallets", tags=["wallets"])

ADMIN_KEY = os.getenv("ADMIN_KEY", "agentry-admin-2026")
STRIPE_SECRET = os.getenv("STRIPE_SECRET_KEY", "")
STRIPE_WEBHOOK_SECRET = os.getenv("STRIPE_WALLET_WEBHOOK_SECRET", "")
SATS_PER_USD = 100_000  # Hardcoded conversion rate

FM_DATA_DIR = "/var/lib/fedimint-client"
FM_CLI = "/usr/bin/fedimint-cli"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _check_admin(key: str) -> None:
    if key != ADMIN_KEY:
        raise HTTPException(status_code=403, detail="Invalid admin key")


def _run_fm(args: list[str], timeout: int = 30) -> dict:
    """Run a fedimint-cli command and return parsed JSON output."""
    cmd = [FM_CLI, "--data-dir", FM_DATA_DIR] + args
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        stdout = result.stdout.strip()
        json_start = stdout.find("{")
        json_arr_start = stdout.find("[")
        if json_start == -1 and json_arr_start == -1:
            if result.returncode != 0:
                raise RuntimeError(result.stderr or "Command failed")
            return {"raw": stdout}
        start = min(
            json_start if json_start >= 0 else float("inf"),
            json_arr_start if json_arr_start >= 0 else float("inf"),
        )
        return json.loads(stdout[int(start):])
    except subprocess.TimeoutExpired:
        raise RuntimeError("Federation command timed out")
    except json.JSONDecodeError as e:
        raise RuntimeError(f"Failed to parse federation response: {e}")


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class CreateWalletRequest(BaseModel):
    agent_id: str = Field(..., description="Agent ID to create wallet for")


class FundLightningRequest(BaseModel):
    amount_sats: int = Field(..., ge=1, le=10_000_000, description="Amount in satoshis")


class FundStripeRequest(BaseModel):
    amount_usd: float = Field(..., ge=0.50, le=10000.0, description="Amount in USD")
    success_url: str = Field(default="https://agentry.com/wallet/success")
    cancel_url: str = Field(default="https://agentry.com/wallet/cancel")


class AdminCreditRequest(BaseModel):
    amount_sats: int = Field(..., ge=1, le=100_000_000, description="Amount to credit")
    reason: str = Field(default="admin_credit", description="Reason for credit")


class DebitRequest(BaseModel):
    amount_sats: int = Field(..., ge=1)
    reason: str = Field(default="invocation")
    invocation_id: str | None = None
    counterparty_agent_id: str | None = None


class CreditRequest(BaseModel):
    amount_sats: int = Field(..., ge=1)
    reason: str = Field(default="invocation_revenue")
    invocation_id: str | None = None
    counterparty_agent_id: str | None = None
    gross_sats: int | None = None
    platform_fee_sats: int | None = None


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.post("/create")
async def create_wallet(body: CreateWalletRequest, request: Request) -> dict:
    """Create a wallet for an agent. Returns existing wallet if one exists."""
    store = request.app.state.store
    wallet = store.create_wallet(body.agent_id)
    return {
        "status": "created",
        "wallet": {
            "agent_id": wallet["agent_id"],
            "balance_sats": wallet["balance_sats"],
            "total_funded_sats": wallet["total_funded_sats"],
            "total_spent_sats": wallet["total_spent_sats"],
            "total_earned_sats": wallet["total_earned_sats"],
            "created_at": wallet["created_at"],
        },
    }


@router.get("/stats")
async def wallet_stats(request: Request) -> dict:
    """Platform-wide wallet statistics."""
    store = request.app.state.store
    return store.get_wallet_stats()


@router.get("/{agent_id}")
async def get_wallet(agent_id: str, request: Request) -> dict:
    """Get wallet balance and summary for an agent."""
    store = request.app.state.store
    wallet = store.get_wallet(agent_id)
    if not wallet:
        raise HTTPException(status_code=404, detail=f"No wallet found for agent {agent_id}")
    return {
        "agent_id": wallet["agent_id"],
        "balance_sats": wallet["balance_sats"],
        "total_funded_sats": wallet["total_funded_sats"],
        "total_spent_sats": wallet["total_spent_sats"],
        "total_earned_sats": wallet["total_earned_sats"],
        "transaction_count": len(wallet.get("transaction_history", [])),
        "funding_count": len(wallet.get("funding_history", [])),
        "created_at": wallet["created_at"],
        "updated_at": wallet["updated_at"],
    }


@router.post("/{agent_id}/fund/lightning")
async def fund_lightning(agent_id: str, body: FundLightningRequest, request: Request) -> dict:
    """Generate a Lightning invoice to fund an agent wallet.

    Creates a real Lightning invoice via Fedimint. After payment,
    confirm with POST /api/wallets/{agent_id}/fund/confirm/{operation_id}.
    """
    store = request.app.state.store

    # Auto-create wallet if needed
    if not store.get_wallet(agent_id):
        store.create_wallet(agent_id)

    amount_msat = body.amount_sats * 1000
    try:
        result = _run_fm([
            "ln-invoice",
            "--amount", str(amount_msat),
            "--description", f"Agentry wallet funding: {agent_id}",
        ])
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=f"Federation error: {e}")

    invoice = result.get("invoice", "")
    operation_id = result.get("operation_id", "")

    if not invoice:
        raise HTTPException(status_code=502, detail="Failed to generate invoice")

    # Track the pending funding
    store.add_lightning_invoice({
        "operation_id": operation_id,
        "invoice": invoice,
        "amount_sats": body.amount_sats,
        "amount_msat": amount_msat,
        "agent_id": agent_id,
        "purpose": "wallet_funding",
        "status": "pending",
        "created_at": _now_iso(),
    })

    return {
        "invoice": invoice,
        "operation_id": operation_id,
        "amount_sats": body.amount_sats,
        "message": f"Pay this invoice, then confirm at POST /api/wallets/{agent_id}/fund/confirm/{operation_id}",
    }


@router.post("/{agent_id}/fund/confirm/{operation_id}")
async def confirm_lightning_funding(
    agent_id: str,
    operation_id: str,
    request: Request,
) -> dict:
    """Confirm a Lightning payment and credit the wallet.

    Checks if the invoice was paid via fedimint-cli await-invoice.
    If paid, credits the wallet balance.
    """
    store = request.app.state.store

    # Look up the pending invoice
    invoice_data = store.get_lightning_invoice(operation_id)
    if not invoice_data:
        raise HTTPException(status_code=404, detail=f"Operation {operation_id} not found")

    if invoice_data.get("status") == "paid":
        wallet = store.get_wallet(agent_id)
        return {
            "confirmed": True,
            "already_credited": True,
            "new_balance_sats": wallet["balance_sats"] if wallet else 0,
        }

    # Check with Fedimint
    try:
        result = _run_fm(["await-invoice", operation_id], timeout=5)
        if result and result.get("total_amount_msat", 0) > 0:
            paid_sats = result.get("total_amount_msat", 0) // 1000
            # Credit the wallet
            wallet = store.fund_wallet(agent_id, paid_sats, {
                "source": "lightning",
                "operation_id": operation_id,
            })
            # Mark invoice as paid to prevent double-credit on retry
            store.update_lightning_invoice(operation_id, {"status": "paid", "paid_sats": paid_sats})
            return {
                "confirmed": True,
                "amount_sats": paid_sats,
                "new_balance_sats": wallet["balance_sats"],
            }
    except RuntimeError:
        pass  # Timeout = still pending

    return {
        "confirmed": False,
        "status": "pending",
        "message": "Invoice not yet paid. Try again after paying.",
    }


@router.post("/{agent_id}/fund/stripe")
async def fund_stripe(agent_id: str, body: FundStripeRequest, request: Request) -> dict:
    """Create a Stripe Checkout session to fund an agent wallet.

    Converts USD to approximate sats and creates a Stripe session.
    On successful payment, the wallet is credited via webhook.
    """
    store = request.app.state.store

    # Auto-create wallet
    if not store.get_wallet(agent_id):
        store.create_wallet(agent_id)

    estimated_sats = int(body.amount_usd * SATS_PER_USD)
    amount_cents = int(body.amount_usd * 100)

    if not STRIPE_SECRET:
        raise HTTPException(status_code=503, detail="Stripe not configured")

    import stripe
    stripe.api_key = STRIPE_SECRET

    try:
        session = stripe.checkout.Session.create(
            payment_method_types=["card"],
            line_items=[{
                "price_data": {
                    "currency": "usd",
                    "unit_amount": amount_cents,
                    "product_data": {
                        "name": f"Agentry Wallet Funding — {agent_id}",
                        "description": f"≈{estimated_sats:,} sats at {SATS_PER_USD:,} sats/USD",
                    },
                },
                "quantity": 1,
            }],
            mode="payment",
            success_url=body.success_url + f"?session_id={{CHECKOUT_SESSION_ID}}&agent_id={agent_id}",
            cancel_url=body.cancel_url,
            metadata={
                "agent_id": agent_id,
                "estimated_sats": str(estimated_sats),
                "purpose": "wallet_funding",
            },
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Stripe error: {e}")

    # Track
    store.add_stripe_payment({
        "session_id": session.id,
        "agent_id": agent_id,
        "amount_usd": body.amount_usd,
        "amount_cents": amount_cents,
        "estimated_sats": estimated_sats,
        "purpose": "wallet_funding",
        "status": "pending",
        "created_at": _now_iso(),
    })

    return {
        "checkout_url": session.url,
        "session_id": session.id,
        "estimated_sats": estimated_sats,
        "amount_usd": body.amount_usd,
    }


@router.post("/stripe-webhook")
async def stripe_wallet_webhook(request: Request) -> dict:
    """Handle Stripe webhook for wallet funding completions."""
    store = request.app.state.store
    payload = await request.body()

    import stripe
    stripe.api_key = STRIPE_SECRET

    # Verify webhook signature if secret configured
    if STRIPE_WEBHOOK_SECRET:
        sig_header = request.headers.get("stripe-signature", "")
        try:
            event = stripe.Webhook.construct_event(payload, sig_header, STRIPE_WEBHOOK_SECRET)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Webhook verification failed: {e}")
    else:
        try:
            event = json.loads(payload)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid JSON payload")

    if event.get("type") == "checkout.session.completed":
        session = event.get("data", {}).get("object", {})
        metadata = session.get("metadata", {})
        agent_id = metadata.get("agent_id")
        estimated_sats = int(metadata.get("estimated_sats", 0))
        session_id = session.get("id")

        if agent_id and estimated_sats > 0:
            # Idempotency check: skip if this session was already processed
            existing = store.get_stripe_payment(session_id) if session_id else None
            if existing and existing.get("status") == "completed":
                logger.info("Stripe webhook already processed for session %s, skipping", session_id)
                return {"received": True, "already_processed": True}

            store.fund_wallet(agent_id, estimated_sats, {
                "source": "stripe",
                "session_id": session_id,
                "amount_usd": session.get("amount_total", 0) / 100,
            })
            # Update Stripe payment record
            store.update_stripe_payment(session_id, {"status": "completed"})
            logger.info("Wallet funded via Stripe: %s +%d sats", agent_id, estimated_sats)

    return {"received": True}


@router.get("/{agent_id}/transactions")
async def list_transactions(
    agent_id: str,
    request: Request,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> dict:
    """Transaction history for an agent wallet."""
    store = request.app.state.store
    wallet = store.get_wallet(agent_id)
    if not wallet:
        raise HTTPException(status_code=404, detail=f"No wallet found for agent {agent_id}")

    txs = store.list_wallet_transactions(agent_id, limit=limit, offset=offset)
    total = len(wallet.get("transaction_history", []))

    return {
        "agent_id": agent_id,
        "transactions": txs,
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.post("/{agent_id}/debit")
async def debit_wallet(
    agent_id: str,
    body: DebitRequest,
    request: Request,
    x_admin_key: str = Header(..., alias="X-Admin-Key"),
) -> dict:
    """Debit an agent wallet. Internal endpoint — requires admin key."""
    _check_admin(x_admin_key)
    store = request.app.state.store

    try:
        wallet = store.debit_wallet(agent_id, body.amount_sats, {
            "reason": body.reason,
            "invocation_id": body.invocation_id,
            "counterparty_agent_id": body.counterparty_agent_id,
        })
    except ValueError as e:
        raise HTTPException(status_code=402, detail=str(e))

    return {
        "success": True,
        "agent_id": agent_id,
        "debited_sats": body.amount_sats,
        "new_balance_sats": wallet["balance_sats"],
    }


@router.post("/{agent_id}/credit")
async def credit_wallet_endpoint(
    agent_id: str,
    body: CreditRequest,
    request: Request,
    x_admin_key: str = Header(..., alias="X-Admin-Key"),
) -> dict:
    """Credit an agent wallet. Internal endpoint — requires admin key."""
    _check_admin(x_admin_key)
    store = request.app.state.store

    wallet = store.credit_wallet(agent_id, body.amount_sats, {
        "reason": body.reason,
        "invocation_id": body.invocation_id,
        "counterparty_agent_id": body.counterparty_agent_id,
        "gross_sats": body.gross_sats,
        "platform_fee_sats": body.platform_fee_sats,
    })

    return {
        "success": True,
        "agent_id": agent_id,
        "credited_sats": body.amount_sats,
        "new_balance_sats": wallet["balance_sats"],
    }


@router.post("/{agent_id}/admin-credit")
async def admin_credit(
    agent_id: str,
    body: AdminCreditRequest,
    request: Request,
    x_admin_key: str = Header(..., alias="X-Admin-Key"),
) -> dict:
    """Admin-only: credit an agent wallet for testing or manual adjustments."""
    _check_admin(x_admin_key)
    store = request.app.state.store

    # Auto-create wallet if needed
    if not store.get_wallet(agent_id):
        store.create_wallet(agent_id)

    wallet = store.fund_wallet(agent_id, body.amount_sats, {
        "source": "admin_credit",
        "reason": body.reason,
    })

    return {
        "success": True,
        "agent_id": agent_id,
        "credited_sats": body.amount_sats,
        "new_balance_sats": wallet["balance_sats"],
        "reason": body.reason,
    }

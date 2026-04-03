"""Stripe Payment endpoints — checkout sessions and webhook handling.

Provides Stripe Checkout as a payment method alongside Lightning.
Creates checkout sessions, polls payment status, and handles
Stripe webhooks for payment confirmation.
"""

from __future__ import annotations

import json as _json
import logging
import os
import uuid
from datetime import datetime
from typing import Any

import stripe
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/payments", tags=["payments"])

# Set Stripe API key from environment
stripe.api_key = os.getenv("STRIPE_SECRET_KEY", "")


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class CheckoutRequest(BaseModel):
    """Request to create a Stripe Checkout session."""
    agent_id: str = Field(..., description="Agent receiving the payment")
    amount_cents: int = Field(..., ge=50, le=10000000, description="Amount in USD cents (min $0.50)")
    description: str = Field(default="Agentry payment", description="Payment description")
    success_url: str = Field(
        default="https://agentry.com/payments/success?session_id={CHECKOUT_SESSION_ID}",
        description="URL to redirect after successful payment",
    )
    cancel_url: str = Field(
        default="https://agentry.com/payments/cancel",
        description="URL to redirect on cancellation",
    )


class CheckoutResponse(BaseModel):
    """Created Stripe Checkout session."""
    session_id: str
    checkout_url: str
    agent_id: str
    amount_cents: int
    currency: str = "usd"
    status: str = "pending"


class PaymentStatusResponse(BaseModel):
    """Stripe payment status."""
    session_id: str
    status: str = Field(..., description="paid, unpaid, or expired")
    agent_id: str = ""
    amount_cents: int = 0
    currency: str = "usd"
    payment_intent: str | None = None


class PaymentOptionsResponse(BaseModel):
    """Available payment methods for an agent."""
    agent_id: str
    methods: list[dict[str, Any]]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_store(request: Request):
    return request.app.state.store


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.post("/stripe/checkout", response_model=CheckoutResponse, tags=["payments"])
async def create_checkout_session(request: Request, body: CheckoutRequest):
    """Create a Stripe Checkout Session for an agent payment.

    Returns a checkout URL that the client should redirect to.
    Stripe handles the entire payment flow including card collection.
    """
    store = _get_store(request)
    agent = store.get_agent(body.agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")

    if not stripe.api_key:
        raise HTTPException(status_code=500, detail="Stripe is not configured")

    try:
        session = stripe.checkout.Session.create(
            payment_method_types=["card"],
            mode="payment",
            line_items=[{
                "price_data": {
                    "currency": "usd",
                    "unit_amount": body.amount_cents,
                    "product_data": {
                        "name": body.description or f"Payment to {agent.get('name', body.agent_id)}",
                        "description": f"Agent: {agent.get('name', body.agent_id)} on Agentry",
                    },
                },
                "quantity": 1,
            }],
            success_url=body.success_url,
            cancel_url=body.cancel_url,
            metadata={
                "agent_id": body.agent_id,
                "platform": "agentry",
            },
        )
    except stripe.error.StripeError as e:
        logger.error("Stripe error creating checkout: %s", e)
        raise HTTPException(status_code=502, detail=f"Stripe error: {str(e)}")

    # Store session in data store
    payment_record = {
        "session_id": session.id,
        "agent_id": body.agent_id,
        "amount_cents": body.amount_cents,
        "currency": "usd",
        "description": body.description,
        "status": "pending",
        "checkout_url": session.url,
        "created_at": datetime.utcnow().isoformat(),
    }
    store.add_stripe_payment(payment_record)

    return CheckoutResponse(
        session_id=session.id,
        checkout_url=session.url,
        agent_id=body.agent_id,
        amount_cents=body.amount_cents,
    )


@router.get("/stripe/status/{session_id}", response_model=PaymentStatusResponse, tags=["payments"])
async def check_stripe_payment(request: Request, session_id: str):
    """Check the status of a Stripe Checkout session.

    Queries Stripe directly for the authoritative payment status.
    Returns paid, unpaid, or expired.
    """
    if not stripe.api_key:
        raise HTTPException(status_code=500, detail="Stripe is not configured")

    try:
        session = stripe.checkout.Session.retrieve(session_id)
    except stripe.error.InvalidRequestError:
        raise HTTPException(status_code=404, detail="Checkout session not found")
    except stripe.error.StripeError as e:
        logger.error("Stripe error checking status: %s", e)
        raise HTTPException(status_code=502, detail=f"Stripe error: {str(e)}")

    # Map Stripe status
    if session.payment_status == "paid":
        status = "paid"
    elif session.status == "expired":
        status = "expired"
    else:
        status = "unpaid"

    agent_id = session.metadata.get("agent_id", "") if session.metadata else ""
    amount_cents = session.amount_total or 0

    return PaymentStatusResponse(
        session_id=session_id,
        status=status,
        agent_id=agent_id,
        amount_cents=amount_cents,
        currency=session.currency or "usd",
        payment_intent=session.payment_intent if isinstance(session.payment_intent, str) else None,
    )


@router.post("/stripe/webhook", tags=["payments"], include_in_schema=False)
async def stripe_webhook(request: Request):
    """Handle Stripe webhook events.

    Processes checkout.session.completed events to update payment
    status and record reputation events for the agent.
    """
    store = _get_store(request)
    payload = await request.body()

    try:
        event = stripe.Event.construct_from(
            _json.loads(payload), stripe.api_key
        )
    except Exception as e:
        logger.error("Webhook payload parse error: %s", e)
        raise HTTPException(status_code=400, detail="Invalid payload")

    event_type = event.get("type", "") if isinstance(event, dict) else getattr(event, "type", "")
    event_data = event.get("data", {}) if isinstance(event, dict) else getattr(event, "data", {})
    event_obj = event_data.get("object", {}) if isinstance(event_data, dict) else getattr(event_data, "object", {})

    if event_type == "checkout.session.completed":
        session = event_obj
        session_id = session.get("id", "") if isinstance(session, dict) else getattr(session, "id", "")
        metadata = session.get("metadata", {}) if isinstance(session, dict) else getattr(session, "metadata", {})
        agent_id = (metadata or {}).get("agent_id", "")
        amount = session.get("amount_total", 0) if isinstance(session, dict) else getattr(session, "amount_total", 0)

        # Idempotency check: skip if already processed
        existing = store.get_stripe_payment(session_id) if session_id else None
        if existing and existing.get("status") == "paid":
            logger.info("Stripe webhook already processed for session %s, skipping", session_id)
            return JSONResponse(content={"status": "ok", "already_processed": True})

        # Update payment record
        store.update_stripe_payment(session_id, {
            "status": "paid",
            "paid_at": datetime.utcnow().isoformat(),
            "payment_intent": session.get("payment_intent", "") if isinstance(session, dict) else getattr(session, "payment_intent", ""),
        })

        # Record reputation event for successful transaction
        if agent_id:
            store.add_reputation_event({
                "agent_id": agent_id,
                "event_type": "transaction_success",
                "value": 1.0,
                "source": "stripe",
                "metadata": {
                    "session_id": session_id,
                    "amount_cents": amount,
                    "currency": "usd",
                },
                "timestamp": datetime.utcnow().isoformat(),
            })
            logger.info("Stripe payment completed: session=%s agent=%s amount=%d", session_id, agent_id, amount)

    return JSONResponse(content={"status": "ok"})


@router.get("/options/{agent_id}", response_model=PaymentOptionsResponse, tags=["payments"])
async def get_payment_options(request: Request, agent_id: str):
    """Return available payment methods for an agent.

    Lists both Lightning (Bitcoin) and Stripe (card) payment
    options with their respective API endpoints.
    """
    store = _get_store(request)
    agent = store.get_agent(agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")

    methods = [
        {
            "method": "lightning",
            "name": "Bitcoin Lightning",
            "description": "Pay with Bitcoin via Lightning Network (instant, low fees)",
            "currency": "BTC (sats)",
            "endpoints": {
                "create_invoice": f"/api/payments/lightning/invoice",
                "check_status": f"/api/payments/lightning/status/{{operation_id}}",
            },
        },
        {
            "method": "stripe",
            "name": "Credit/Debit Card",
            "description": "Pay with card via Stripe Checkout (USD)",
            "currency": "USD",
            "endpoints": {
                "create_checkout": f"/api/payments/stripe/checkout",
                "check_status": f"/api/payments/stripe/status/{{session_id}}",
            },
        },
    ]

    return PaymentOptionsResponse(agent_id=agent_id, methods=methods)

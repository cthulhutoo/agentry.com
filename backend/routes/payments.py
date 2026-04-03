"""Stripe payment endpoints for Agentry listing and service tiers."""

from __future__ import annotations

import logging
import os

import stripe
from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/payments", tags=["payments"])

stripe.api_key = os.getenv("STRIPE_SECRET_KEY", "")

# ---------------------------------------------------------------------------
# Directory Listing tiers (for agent developers / supply side)
# ---------------------------------------------------------------------------
LISTING_TIERS = {
    "pro": {
        "name": "Pro Listing",
        "price": "$99/mo",
        "price_id": os.getenv("STRIPE_LISTING_PRO_PRICE", "price_1TCOmpCcQNo17QSL2HkvpWdP"),
        "features": [
            "Listing analytics (views, clicks, conversions)",
            "Priority placement in search results",
            "Verified Pro badge on listing card",
            "Lead alerts for matching business requests",
            "Custom CTA button on your listing",
            "Enhanced profile (logo, longer description)",
        ],
    },
    "featured": {
        "name": "Featured Listing",
        "price": "$249/mo",
        "price_id": os.getenv("STRIPE_LISTING_FEATURED_PRICE", "price_1TCOmqCcQNo17QSLLKoFDy4b"),
        "features": [
            "Everything in Pro",
            "Pinned to top of your category page",
            "Homepage Featured Agents rotation",
            "Monthly performance report (emailed)",
            "A2A card health monitoring + alerts",
            "Priority support channel",
        ],
    },
    "premium": {
        "name": "Premium Listing",
        "price": "$499/mo",
        "price_id": os.getenv("STRIPE_LISTING_PREMIUM_PRICE", "price_1TCOmqCcQNo17QSLUUaHfZ6T"),
        "features": [
            "Everything in Featured",
            "Cross-category listing (up to 3 categories)",
            "Appear in 'Alternatives to X' searches",
            "Sponsored search placement",
            "Custom agent profile page (/agents/your-name)",
            "API access for profile updates + analytics export",
            "Quarterly strategy call",
        ],
    },
}

# ---------------------------------------------------------------------------
# Enterprise Registry tiers (for businesses / demand side)
# ---------------------------------------------------------------------------
ENTERPRISE_TIERS = {
    "basic": {
        "name": "Enterprise Registry - Basic",
        "price": "$99/mo",
        "price_id": os.getenv("STRIPE_ENT_BASIC_PRICE", "price_1TCKbhCcQNo17QSLYIOR7Eua"),
        "features": [
            "Up to 25 agents",
            "Everything in Free",
            "Priority scanning (every 2 hours)",
            "Email support",
        ],
    },
    "pro": {
        "name": "Enterprise Registry - Pro",
        "price": "$249/mo",
        "price_id": os.getenv("STRIPE_ENT_PRO_PRICE", "price_1TCKbiCcQNo17QSLwzOQYLEN"),
        "features": [
            "Up to 100 agents",
            "Everything in Basic",
            "Custom categories and tagging",
            "Webhook notifications",
            "Team access (up to 5 seats)",
        ],
    },
    "enterprise": {
        "name": "Enterprise Registry - Enterprise",
        "price": "$499/mo",
        "price_id": os.getenv("STRIPE_ENT_ENTERPRISE_PRICE", "price_1TCKbiCcQNo17QSLP5grJyHj"),
        "features": [
            "Unlimited agents",
            "Everything in Pro",
            "Dedicated support + SLA",
            "SSO (coming soon)",
            "Unlimited team seats",
        ],
    },
}

# ---------------------------------------------------------------------------
# One-time products
# ---------------------------------------------------------------------------
BROKER_MATCH_PRICE_ID = os.getenv("STRIPE_BROKER_MATCH_PRICE", "price_1TCOmrCcQNo17QSLubETzuVw")


@router.get("/tiers")
async def get_tiers() -> dict:
    """Return all available tiers."""
    return {
        "listing_tiers": {
            tid: {"name": t["name"], "price": t["price"], "features": t["features"]}
            for tid, t in LISTING_TIERS.items()
        },
        "enterprise_tiers": {
            tid: {"name": t["name"], "price": t["price"], "features": t["features"]}
            for tid, t in ENTERPRISE_TIERS.items()
        },
    }


class CheckoutRequest(BaseModel):
    """Request to create a Stripe checkout session."""
    tier: str  # e.g. "listing_pro", "listing_featured", "ent_basic", "broker_match"
    customer_email: str | None = None
    success_url: str = "https://agentry.com/pricing/?payment=success"
    cancel_url: str = "https://agentry.com/pricing/?payment=cancelled"


@router.post("/checkout")
async def create_checkout_session(body: CheckoutRequest) -> dict:
    """Create a Stripe Checkout session for any tier."""
    if not stripe.api_key:
        raise HTTPException(status_code=503, detail="Payment system not configured")

    # Resolve tier to price_id and mode
    price_id = None
    mode = "subscription"
    tier_name = body.tier

    if body.tier.startswith("listing_"):
        key = body.tier.replace("listing_", "")
        tier = LISTING_TIERS.get(key)
        if tier:
            price_id = tier["price_id"]
            tier_name = tier["name"]
    elif body.tier.startswith("ent_"):
        key = body.tier.replace("ent_", "")
        tier = ENTERPRISE_TIERS.get(key)
        if tier:
            price_id = tier["price_id"]
            tier_name = tier["name"]
    elif body.tier == "broker_match":
        price_id = BROKER_MATCH_PRICE_ID
        mode = "payment"  # one-time payment
        tier_name = "Broker Match"
    else:
        # Legacy support: try old tier names
        tier = LISTING_TIERS.get(body.tier) or ENTERPRISE_TIERS.get(body.tier)
        if tier:
            price_id = tier["price_id"]
            tier_name = tier["name"]

    if not price_id:
        raise HTTPException(status_code=400, detail=f"Invalid tier: {body.tier}")

    try:
        session = stripe.checkout.Session.create(
            mode=mode,
            line_items=[{"price": price_id, "quantity": 1}],
            success_url=body.success_url,
            cancel_url=body.cancel_url,
            customer_email=body.customer_email,
            metadata={"tier": body.tier, "tier_name": tier_name},
        )
        return {"checkout_url": session.url, "session_id": session.id}
    except stripe.error.StripeError as e:
        logger.error("Stripe checkout error: %s", e)
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/webhook")
async def stripe_webhook(request: Request) -> dict:
    """Handle Stripe webhook events."""
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature", "")
    webhook_secret = os.getenv("STRIPE_WEBHOOK_SECRET", "")

    if webhook_secret:
        try:
            event = stripe.Webhook.construct_event(payload, sig_header, webhook_secret)
        except (ValueError, stripe.error.SignatureVerificationError) as e:
            logger.error("Webhook signature verification failed: %s", e)
            raise HTTPException(status_code=400, detail="Invalid signature")
    else:
        import json
        event = json.loads(payload)

    event_type = event.get("type", "")
    logger.info("Stripe webhook event: %s", event_type)

    if event_type == "checkout.session.completed":
        session = event["data"]["object"]
        customer_email = session.get("customer_email", "")
        tier = session.get("metadata", {}).get("tier", "unknown")
        logger.info("New payment: %s — tier: %s", customer_email, tier)

    elif event_type == "customer.subscription.deleted":
        subscription = event["data"]["object"]
        logger.info("Subscription cancelled: %s", subscription.get("id"))

    return {"received": True}

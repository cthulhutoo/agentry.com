"""Enterprise Private Registries — org management and private agent CRUD."""

from __future__ import annotations

import logging
import os
import re
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from auth import get_current_org
from spam_filter import (
    _is_gibberish,
    _is_disposable_email,
    _check_rate_limit,
    _ip_submissions,
    _email_submissions,
)
from pydantic import BaseModel

from models import (
    CreateOrgRequest,
    CreatePrivateAgentRequest,
    Organization,
    PrivateAgent,
    UpdatePrivateAgentRequest,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["enterprise"])

PLAN_LIMITS = {
    "free": 5,
    "basic": 25,
    "pro": 100,
    "enterprise": 999_999,
}


def _slugify(name: str) -> str:
    """Generate a URL-safe slug from an org name."""
    slug = name.lower().strip()
    slug = re.sub(r"[^a-z0-9\s-]", "", slug)
    slug = re.sub(r"[\s-]+", "-", slug)
    return slug.strip("-")




def _is_valid_org_name(name: str) -> bool:
    """Check if a long single-word name looks like a real org (e.g. acronym, brand name)."""
    # Known patterns that are OK: all caps (acronym), title case brand
    if name.isupper() and len(name) <= 20:
        return True  # Could be an acronym
    # Check consonant ratio — gibberish has high consonant density
    vowels = set("aeiouAEIOU")
    vowel_count = sum(1 for c in name if c in vowels)
    if len(name) > 0 and vowel_count / len(name) < 0.15:
        return False  # Very few vowels = likely gibberish
    # Check for excessive mixed case (CamelCase is ok, rAnDoM is not)
    case_changes = sum(1 for i in range(1, len(name)) if name[i].isupper() != name[i-1].isupper())
    if case_changes > len(name) * 0.5:
        return False
    return True

# ---------------------------------------------------------------------------
# Org creation (no auth — this is signup)
# ---------------------------------------------------------------------------

@router.post("/orgs")
async def create_org(body: CreateOrgRequest, request: Request) -> dict[str, Any]:
    """Create a new organization and return its API key."""
    store = request.app.state.store

    # --- Spam filtering ---
    client_ip = request.client.host if request.client else ""

    # Rate limit by IP (3 org creations per hour per IP)
    if client_ip and _check_rate_limit(f"org_ip:{client_ip}", _ip_submissions, 3):
        raise HTTPException(status_code=429, detail="Too many signup attempts. Please try again later.")

    # Rate limit by email (2 org creations per hour per email)
    if body.email and _check_rate_limit(f"org_email:{body.email}", _email_submissions, 2):
        raise HTTPException(status_code=429, detail="Too many signups from this email.")

    # Disposable email check
    if _is_disposable_email(body.email):
        raise HTTPException(status_code=400, detail="Please use a business email address.")

    # Email format validation
    if not body.email or "@" not in body.email or "." not in body.email.split("@")[-1]:
        raise HTTPException(status_code=400, detail="Please provide a valid email address.")

    # Org name: reject gibberish
    if not body.name or len(body.name.strip()) < 2:
        raise HTTPException(status_code=400, detail="Please provide your organization name.")

    if len(body.name) > 100:
        raise HTTPException(status_code=400, detail="Organization name too long (max 100 characters).")

    if _is_gibberish(body.name):
        raise HTTPException(status_code=400, detail="Organization name appears invalid.")

    # Extra check: long single-word names with no spaces
    name_stripped = body.name.strip()
    if len(name_stripped) > 15 and " " not in name_stripped and not _is_valid_org_name(name_stripped):
        raise HTTPException(status_code=400, detail="Organization name appears invalid.")

    # --- End spam filtering ---

    slug = body.slug or _slugify(body.name)
    if not slug:
        raise HTTPException(status_code=400, detail="Could not generate a valid slug from org name")

    # Check slug uniqueness
    if store.get_org_by_slug(slug):
        raise HTTPException(status_code=409, detail=f"Organization slug '{slug}' is already taken")

    org = Organization(name=body.name, slug=slug, email=body.email)
    org_data = org.model_dump(mode="json")
    store.create_org(org_data)

    # Send welcome email (fire-and-forget)
    try:
        await _send_welcome_email(org_data)
    except Exception as exc:
        logger.error("Failed to send welcome email to %s: %s", body.email, exc)

    # Notify admin
    try:
        await _send_admin_new_org_email(org_data)
    except Exception as exc:
        logger.error("Failed to send admin notification for org %s: %s", org.id, exc)

    return {
        "id": org_data["id"],
        "name": org_data["name"],
        "slug": org_data["slug"],
        "email": org_data["email"],
        "api_key": org_data["api_key"],
        "plan": org_data["plan"],
        "max_agents": org_data["max_agents"],
        "created_at": org_data["created_at"],
    }


# ---------------------------------------------------------------------------
# Org detail (auth required)
# ---------------------------------------------------------------------------

@router.get("/orgs/{org_id}")
async def get_org(org_id: str, org: dict = Depends(get_current_org)) -> dict[str, Any]:
    if org.get("id") != org_id:
        raise HTTPException(status_code=403, detail="API key does not match this organization")
    # Strip api_key from response
    result = dict(org)
    result.pop("api_key", None)
    return result


# ---------------------------------------------------------------------------
# Private agents CRUD
# ---------------------------------------------------------------------------

@router.get("/orgs/{org_id}/agents")
async def list_private_agents(
    org_id: str,
    request: Request,
    org: dict = Depends(get_current_org),
    category: str | None = Query(None),
    environment: str | None = Query(None),
    status: str = Query("active"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> dict[str, Any]:
    if org.get("id") != org_id:
        raise HTTPException(status_code=403, detail="API key does not match this organization")
    store = request.app.state.store
    agents, total = store.list_private_agents(
        org_id, category=category, environment=environment, status=status, limit=limit, offset=offset
    )
    return {"items": agents, "total": total, "limit": limit, "offset": offset}


@router.post("/orgs/{org_id}/agents", status_code=201)
async def create_private_agent(
    org_id: str,
    body: CreatePrivateAgentRequest,
    request: Request,
    org: dict = Depends(get_current_org),
) -> dict[str, Any]:
    if org.get("id") != org_id:
        raise HTTPException(status_code=403, detail="API key does not match this organization")

    store = request.app.state.store
    plan = org.get("plan", "free")
    max_agents = PLAN_LIMITS.get(plan, 5)

    # Count current non-deprecated agents
    existing, _ = store.list_private_agents(org_id, status="active", limit=999_999)
    if len(existing) >= max_agents:
        raise HTTPException(
            status_code=403,
            detail=f"Agent limit reached ({max_agents} for {plan} plan). Upgrade to add more agents.",
        )

    agent = PrivateAgent(
        org_id=org_id,
        name=body.name,
        url=body.url,
        description=body.description,
        category=body.category,
        environment=body.environment,
        owner_team=body.owner_team,
        tags=body.tags,
    )
    agent_data = agent.model_dump(mode="json")
    store.add_private_agent(agent_data)
    return agent_data


@router.get("/orgs/{org_id}/agents/{agent_id}")
async def get_private_agent(
    org_id: str,
    agent_id: str,
    request: Request,
    org: dict = Depends(get_current_org),
) -> dict[str, Any]:
    if org.get("id") != org_id:
        raise HTTPException(status_code=403, detail="API key does not match this organization")
    store = request.app.state.store
    agent = store.get_private_agent(agent_id, org_id)
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")
    return agent


@router.put("/orgs/{org_id}/agents/{agent_id}")
async def update_private_agent(
    org_id: str,
    agent_id: str,
    body: UpdatePrivateAgentRequest,
    request: Request,
    org: dict = Depends(get_current_org),
) -> dict[str, Any]:
    if org.get("id") != org_id:
        raise HTTPException(status_code=403, detail="API key does not match this organization")
    store = request.app.state.store
    updates = body.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    updated = store.update_private_agent(agent_id, org_id, updates)
    if updated is None:
        raise HTTPException(status_code=404, detail="Agent not found")
    return updated


@router.delete("/orgs/{org_id}/agents/{agent_id}")
async def delete_private_agent(
    org_id: str,
    agent_id: str,
    request: Request,
    org: dict = Depends(get_current_org),
) -> dict[str, Any]:
    if org.get("id") != org_id:
        raise HTTPException(status_code=403, detail="API key does not match this organization")
    store = request.app.state.store
    success = store.delete_private_agent(agent_id, org_id)
    if not success:
        raise HTTPException(status_code=404, detail="Agent not found")
    return {"detail": "Agent deprecated", "agent_id": agent_id}


# ---------------------------------------------------------------------------
# Org stats
# ---------------------------------------------------------------------------

@router.get("/orgs/{org_id}/stats")
async def get_org_stats(
    org_id: str,
    request: Request,
    org: dict = Depends(get_current_org),
) -> dict[str, Any]:
    if org.get("id") != org_id:
        raise HTTPException(status_code=403, detail="API key does not match this organization")
    store = request.app.state.store
    stats = store.get_private_agent_stats(org_id)
    stats["plan"] = org.get("plan", "free")
    stats["max_agents"] = PLAN_LIMITS.get(org.get("plan", "free"), 5)
    return stats


# ---------------------------------------------------------------------------
# Discovery scan for a private agent
# ---------------------------------------------------------------------------

@router.post("/orgs/{org_id}/agents/{agent_id}/discover")
async def discover_private_agent(
    org_id: str,
    agent_id: str,
    request: Request,
    org: dict = Depends(get_current_org),
) -> dict[str, Any]:
    if org.get("id") != org_id:
        raise HTTPException(status_code=403, detail="API key does not match this organization")

    store = request.app.state.store
    agent = store.get_private_agent(agent_id, org_id)
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")

    from registry_engine import discover_agent_card, build_trust_signals
    from trust_engine import compute_trust_score
    from models import TrustSignals

    # Extract domain from agent URL
    try:
        parsed = urlparse(agent["url"])
        domain = parsed.hostname
    except Exception:
        domain = None

    if not domain:
        raise HTTPException(status_code=400, detail="Could not extract domain from agent URL")

    # Discover
    snapshot = await discover_agent_card(domain)

    # Build trust signals
    signals = build_trust_signals(snapshot, domain)
    score, tier, breakdown = compute_trust_score(signals)

    # Update the private agent
    trust_update: dict[str, Any] = {
        "trust_score": score,
        "trust_tier": tier,
        "last_card_check": datetime.now(timezone.utc).isoformat(),
    }
    if snapshot is not None:
        trust_update["a2a_card_url"] = snapshot.url_source
        trust_update["agent_card"] = snapshot.raw_json
    store.update_private_agent(agent_id, org_id, trust_update)

    return {
        "agent_id": agent_id,
        "card_found": snapshot is not None,
        "trust_score": score,
        "trust_tier": tier,
        "score_breakdown": breakdown,
        "card_url": snapshot.url_source if snapshot else None,
    }



# ---------------------------------------------------------------------------
# Enterprise plan checkout (Stripe)
# ---------------------------------------------------------------------------

ENT_PLAN_PRICES = {
    "basic": os.getenv("STRIPE_ENT_BASIC_PRICE", ""),
    "pro": os.getenv("STRIPE_ENT_PRO_PRICE", ""),
    "enterprise": os.getenv("STRIPE_ENT_ENTERPRISE_PRICE", ""),
}


class EntCheckoutRequest(BaseModel):
    """Request to create a Stripe checkout for an enterprise plan."""
    plan: str
    org_id: str | None = None
    email: str | None = None


@router.post("/enterprise/checkout")
async def enterprise_checkout(body: EntCheckoutRequest) -> dict[str, Any]:
    """Create a Stripe Checkout session for an enterprise registry plan."""
    import stripe as _stripe
    _stripe.api_key = os.getenv("STRIPE_SECRET_KEY", "")

    if not _stripe.api_key:
        raise HTTPException(status_code=503, detail="Payment system not configured")

    price_id = ENT_PLAN_PRICES.get(body.plan)
    if not price_id:
        raise HTTPException(status_code=400, detail=f"Invalid plan: {body.plan}. Choose basic, pro, or enterprise.")

    try:
        session = _stripe.checkout.Session.create(
            mode="subscription",
            line_items=[{"price": price_id, "quantity": 1}],
            success_url=f"https://agentry.com/enterprise/?payment=success&plan={body.plan}",
            cancel_url="https://agentry.com/enterprise/?payment=cancelled",
            customer_email=body.email,
            metadata={"plan": body.plan, "org_id": body.org_id or ""},
        )
        return {"checkout_url": session.url, "session_id": session.id}
    except Exception as e:
        logger.error("Stripe enterprise checkout error: %s", e)
        raise HTTPException(status_code=400, detail=str(e))


# ---------------------------------------------------------------------------
# Email helpers
# ---------------------------------------------------------------------------

async def _send_welcome_email(org: dict[str, Any]) -> None:
    """Send a welcome email to the new org's email address."""
    from email_service import _get_client, FROM_EMAIL
    from sendgrid.helpers.mail import Mail

    client = _get_client()
    if not client:
        return

    html_body = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
      <div style="text-align: center; margin-bottom: 32px;">
        <h1 style="color: #0d1117; font-size: 24px; margin: 0;">AGENTRY</h1>
        <p style="color: #3dbbc4; font-size: 14px; margin: 4px 0 0;">Enterprise Private Registry</p>
      </div>

      <h2 style="color: #0d1117; font-size: 20px;">Welcome to Agentry, {org['name']}!</h2>

      <p style="color: #333; line-height: 1.6;">
        Your private agent registry is ready. Here are your credentials:
      </p>

      <div style="background: #f6f8fa; border-radius: 8px; padding: 20px; margin: 24px 0;">
        <p style="color: #555; font-size: 14px; line-height: 1.8; margin: 0;">
          <strong>Organization ID:</strong> {org['id']}<br>
          <strong>Slug:</strong> {org['slug']}<br>
          <strong>API Key:</strong> <code style="background: #e8e8e8; padding: 2px 6px; border-radius: 3px;">{org['api_key']}</code><br>
          <strong>Plan:</strong> {org['plan']} (up to {org['max_agents']} agents)
        </p>
      </div>

      <p style="color: #333; line-height: 1.6;">
        Use your API key in the <code>X-API-Key</code> header to authenticate requests to the Agentry API.
      </p>

      <p style="color: #333; line-height: 1.6;">
        <strong>Quick start:</strong>
      </p>
      <div style="background: #1a1a2e; border-radius: 8px; padding: 16px; margin: 16px 0;">
        <code style="color: #ccd6f6; font-size: 13px; white-space: pre; line-height: 1.6;">curl -X POST https://api.agentry.com/api/orgs/{org['id']}/agents \\
  -H "X-API-Key: {org['api_key']}" \\
  -H "Content-Type: application/json" \\
  -d '{{"name": "My Agent", "url": "https://my-agent.com"}}'</code>
      </div>

      <p style="color: #999; font-size: 12px; margin-top: 40px; border-top: 1px solid #eee; padding-top: 16px;">
        &copy; Agentry &mdash; The Registry for the Agent Economy<br>
        <a href="https://agentry.com" style="color: #3dbbc4;">agentry.com</a>
      </p>
    </div>
    """

    message = Mail(
        from_email=(FROM_EMAIL, "Agentry"),
        to_emails=org["email"],
        subject=f"Your Agentry Private Registry is Ready — {org['name']}",
        html_content=html_body,
    )

    try:
        response = client.send(message)
        logger.info("Welcome email sent to %s (status: %s)", org["email"], response.status_code)
    except Exception as exc:
        logger.error("Failed to send welcome email: %s", exc)


async def _send_admin_new_org_email(org: dict[str, Any]) -> None:
    """Notify admin about a new org signup."""
    from email_service import _get_client, FROM_EMAIL, ADMIN_EMAIL
    from sendgrid.helpers.mail import Mail

    client = _get_client()
    if not client:
        return

    html_body = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
      <h2 style="color: #0d1117; font-size: 20px;">New Enterprise Signup</h2>

      <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
        <tr style="border-bottom: 1px solid #eee;">
          <td style="padding: 10px 0; color: #666; width: 140px;"><strong>Org Name</strong></td>
          <td style="padding: 10px 0; color: #333;">{org['name']}</td>
        </tr>
        <tr style="border-bottom: 1px solid #eee;">
          <td style="padding: 10px 0; color: #666;"><strong>Slug</strong></td>
          <td style="padding: 10px 0; color: #333;">{org['slug']}</td>
        </tr>
        <tr style="border-bottom: 1px solid #eee;">
          <td style="padding: 10px 0; color: #666;"><strong>Email</strong></td>
          <td style="padding: 10px 0; color: #333;"><a href="mailto:{org['email']}" style="color: #3dbbc4;">{org['email']}</a></td>
        </tr>
        <tr style="border-bottom: 1px solid #eee;">
          <td style="padding: 10px 0; color: #666;"><strong>Org ID</strong></td>
          <td style="padding: 10px 0; color: #333;">{org['id']}</td>
        </tr>
        <tr>
          <td style="padding: 10px 0; color: #666;"><strong>Plan</strong></td>
          <td style="padding: 10px 0; color: #333;">{org['plan']}</td>
        </tr>
      </table>
    </div>
    """

    message = Mail(
        from_email=(FROM_EMAIL, "Agentry Alerts"),
        to_emails=ADMIN_EMAIL,
        subject=f"New Enterprise Signup: {org['name']}",
        html_content=html_body,
    )

    try:
        response = client.send(message)
        logger.info("Admin org notification sent (status: %s)", response.status_code)
    except Exception as exc:
        logger.error("Failed to send admin org notification: %s", exc)

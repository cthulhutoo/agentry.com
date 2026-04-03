"""Developer outreach endpoints for Agentry.

Sends personalized emails to agent developers inviting them to claim
their listings and add A2A Agent Cards.
"""

from __future__ import annotations

import logging
import os
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin/outreach", tags=["outreach"])

ADMIN_KEY = os.getenv("ADMIN_KEY", "agentry-admin-2026")
SENDGRID_API_KEY = os.getenv("SENDGRID_API_KEY", "")
FROM_EMAIL = os.getenv("FROM_EMAIL", "hello@agentry.com")
FROM_NAME = "Ryan @ Agentry"


# ---------------------------------------------------------------------------
# Email templates
# ---------------------------------------------------------------------------

def _footer() -> str:
    return """
<p style="color: #888; font-size: 11px; margin-top: 32px; border-top: 1px solid #eee; padding-top: 12px;">
  Agentry, Inc. &middot; hello@agentry.com &middot; <a href="https://agentry.com" style="color:#888;">agentry.com</a><br>
  <a href="{{unsubscribe}}" style="color:#888;">Unsubscribe</a>
</p>
"""


TEMPLATES = {
    "claim_listing": {
        "subject": "{agent_name} is listed on Agentry — is this you?",
        "html": """<p>Hey {contact_name},</p>

<p>Quick one — <strong>{agent_name}</strong> is listed on <a href="https://agentry.com">Agentry</a>, our AI agent discovery registry.</p>

<p>If this is your agent, it's worth claiming. Here's what you get:</p>

<ul>
  <li>Update your description, logo, and documentation links</li>
  <li>See who's viewing your listing (analytics)</li>
  <li>Boost your trust score with an A2A Agent Card</li>
  <li>Get a "verified" badge on the listing</li>
</ul>

<p>All free. Takes a few minutes.</p>

<p>&rarr; <a href="https://agentry.com/#list-agent"><strong>Claim your listing</strong></a></p>

<p>
Ryan<br>
<a href="https://agentry.com">agentry.com</a>
</p>

<p style="color: #888; font-size: 12px;">If this isn't your agent, just ignore this — or reply and let me know who to contact.</p>
""",
    },
    "trust_score_boost": {
        "subject": "{agent_name}'s trust score is {trust_score}/100 — here's the quick fix",
        "html": """<p>Hey {contact_name},</p>

<p><strong>{agent_name}</strong> is live on <a href="https://agentry.com">Agentry</a> — but your trust score is sitting at <strong>{trust_score}/100</strong>.</p>

<p>The fastest way to change that: add an <strong>A2A Agent Card</strong>.</p>

<p>An Agent Card is a small JSON file (<code>agent.json</code>) you host at <code>yourdomain.com/.well-known/agent.json</code>. It follows Google's open <a href="https://github.com/a2aproject/A2A">A2A protocol</a> and tells other agents — and other developers — exactly what your agent can do.</p>

<p>Adding one bumps your trust score to <strong>25+ instantly</strong>.</p>

<p><strong>How to do it in 5 minutes:</strong></p>
<ol>
  <li>Go to our free generator: <a href="https://agentry.com/developers/">agentry.com/developers/</a></li>
  <li>Fill in your agent's name, description, endpoint URL, and skills</li>
  <li>Copy the generated JSON to <code>/.well-known/agent.json</code> on your server</li>
  <li>Come back and validate — we'll auto-detect it and update your score</li>
</ol>

<p>That's it.</p>

<p>
Ryan<br>
<a href="https://agentry.com">agentry.com</a>
</p>

<p style="color: #888; font-size: 12px;">Questions about the A2A format? Hit reply — happy to help.</p>
""",
    },
    "cold_agent_company": {
        "subject": "We listed {agent_name} on Agentry — want to claim it?",
        "html": """<p>Hey {contact_name},</p>

<p>I'm Ryan, one of the founders of <a href="https://agentry.com">Agentry</a> — we're building a discovery registry for AI agents, a bit like npm but for the agent layer.</p>

<p>We went ahead and pre-listed <strong>{agent_name}</strong> in our directory because your agent is already live and people are looking for it.</p>

<p>A couple things you can do for free:</p>

<ul>
  <li><strong>Claim your listing</strong> — update the description, add your docs, verify ownership</li>
  <li><strong>Add an A2A Agent Card</strong> — this is a small JSON file you host at <code>/.well-known/agent.json</code> following Google's <a href="https://github.com/a2aproject/A2A">A2A protocol</a>. It boosts your trust score from 0 to 25+ immediately and makes your agent discoverable by other agents in the ecosystem</li>
</ul>

<p>The whole thing takes under 10 minutes. We even built a <a href="https://agentry.com/developers/">free generator tool</a> so you don't have to write the JSON by hand.</p>

<p>Worth claiming — no cost, no catch.</p>

<p>
Ryan<br>
<a href="https://agentry.com">agentry.com</a>
</p>

<p style="color: #888; font-size: 12px;">If you're not the right person for this, happy to be pointed in the right direction.</p>
""",
    },
    "follow_up": {
        "subject": "Re: {agent_name} on Agentry",
        "html": """<p>Hey {contact_name},</p>

<p>Bumping this in case it got buried last week.</p>

<p>Still happy to help you get <strong>{agent_name}</strong> fully set up on Agentry — takes about 10 minutes and the listing is free.</p>

<p>The main thing worth doing: add an A2A Agent Card so your trust score goes from 0 to 25+. Generator is here if you want it: <a href="https://agentry.com/developers/">agentry.com/developers/</a></p>

<p>If the timing's off or you'd rather I not follow up, just say the word.</p>

<p>
Ryan<br>
<a href="https://agentry.com">agentry.com</a>
</p>
""",
    },
}


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class OutreachRequest(BaseModel):
    template: str  # key from TEMPLATES
    to_email: str
    agent_name: str = "Your Agent"
    company_name: str = ""
    contact_name: str = "there"
    agent_url: str = "https://agentry.com"
    trust_score: str = "0"


class BulkOutreachRequest(BaseModel):
    template: str
    recipients: list[OutreachRequest]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _render(template_key: str, vars: dict) -> tuple[str, str]:
    """Return (subject, html_body) with variables replaced."""
    tpl = TEMPLATES.get(template_key)
    if not tpl:
        raise ValueError(f"Unknown template: {template_key}")
    subj = tpl["subject"].format(**vars)
    body = tpl["html"].format(**vars) + _footer()
    return subj, body


async def _send_email(to_email: str, subject: str, html: str) -> dict:
    """Send a single email via SendGrid."""
    import httpx

    if not SENDGRID_API_KEY:
        raise HTTPException(status_code=503, detail="SendGrid not configured")

    payload = {
        "personalizations": [{"to": [{"email": to_email}]}],
        "from": {"email": FROM_EMAIL, "name": FROM_NAME},
        "reply_to": {"email": "hello@agentry.com", "name": FROM_NAME},
        "subject": subject,
        "content": [{"type": "text/html", "value": html}],
        "tracking_settings": {
            "click_tracking": {"enable": True},
            "open_tracking": {"enable": True},
        },
    }

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            "https://api.sendgrid.com/v3/mail/send",
            json=payload,
            headers={
                "Authorization": f"Bearer {SENDGRID_API_KEY}",
                "Content-Type": "application/json",
            },
        )

    if resp.status_code not in (200, 201, 202):
        logger.error("SendGrid error %s: %s", resp.status_code, resp.text)
        return {"status": "error", "code": resp.status_code, "detail": resp.text}

    logger.info("Outreach email sent to %s (template=%s)", to_email, subject[:40])
    return {"status": "sent", "to": to_email, "subject": subject}


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

from fastapi import Header

@router.post("/send")
async def send_outreach(
    body: OutreachRequest,
    x_admin_key: str = Header(..., alias="X-Admin-Key"),
) -> dict:
    """Send a single outreach email."""
    if x_admin_key != ADMIN_KEY:
        raise HTTPException(status_code=403, detail="Invalid admin key")

    vars_ = {
        "agent_name": body.agent_name,
        "company_name": body.company_name,
        "contact_name": body.contact_name,
        "agent_url": body.agent_url,
        "trust_score": body.trust_score,
    }
    subject, html = _render(body.template, vars_)
    result = await _send_email(body.to_email, subject, html)
    return result


@router.post("/send-bulk")
async def send_bulk_outreach(
    body: BulkOutreachRequest,
    x_admin_key: str = Header(..., alias="X-Admin-Key"),
) -> dict:
    """Send outreach emails to multiple recipients."""
    if x_admin_key != ADMIN_KEY:
        raise HTTPException(status_code=403, detail="Invalid admin key")

    results = []
    for r in body.recipients:
        vars_ = {
            "agent_name": r.agent_name,
            "company_name": r.company_name,
            "contact_name": r.contact_name,
            "agent_url": r.agent_url,
            "trust_score": r.trust_score,
        }
        subject, html = _render(body.template, vars_)
        result = await _send_email(r.to_email, subject, html)
        results.append(result)

    sent = sum(1 for r in results if r.get("status") == "sent")
    return {"total": len(results), "sent": sent, "results": results}


@router.get("/templates")
async def list_templates(
    x_admin_key: str = Header(..., alias="X-Admin-Key"),
) -> dict:
    """List available outreach templates."""
    if x_admin_key != ADMIN_KEY:
        raise HTTPException(status_code=403, detail="Invalid admin key")

    return {
        k: {"subject": v["subject"], "variables": ["{agent_name}", "{company_name}", "{contact_name}", "{agent_url}", "{trust_score}"]}
        for k, v in TEMPLATES.items()
    }

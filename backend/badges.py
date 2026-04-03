"""Agentry Badge System — SVG badges for agent listings.

Serves embeddable badges like shields.io format:
  GET /api/badges/{agent_id}.svg — "Listed on Agentry" or "Verified on Agentry"
  GET /api/badges/{agent_id}.json — Badge metadata (for shields.io endpoint)

Usage in README:
  ![Listed on Agentry](https://api.agentry.com/api/badges/AGENT_ID.svg)
  [![Agentry](https://api.agentry.com/api/badges/AGENT_ID.svg)](https://agentry.com/agent/AGENT_ID)
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Request, Query
from fastapi.responses import Response

logger = logging.getLogger(__name__)

router = APIRouter(tags=["badges"])

# ---------------------------------------------------------------------------
# Color palettes
# ---------------------------------------------------------------------------

BADGE_COLORS = {
    "listed": {"left_bg": "#555", "right_bg": "#3dbbc4", "label": "Agentry", "status": "Listed"},
    "verified": {"left_bg": "#555", "right_bg": "#2ea043", "label": "Agentry", "status": "Verified"},
    "trusted": {"left_bg": "#555", "right_bg": "#1a7f37", "label": "Agentry", "status": "Trusted"},
    "not_found": {"left_bg": "#555", "right_bg": "#9e9e9e", "label": "Agentry", "status": "Not Found"},
}

# Trust tier mapping
TIER_BADGE = {
    "verified": "verified",
    "trusted": "trusted",
    "standard": "listed",
    "unknown": "listed",
    "unverified": "listed",
}

# ---------------------------------------------------------------------------
# SVG template (shields.io-style flat badge)
# ---------------------------------------------------------------------------

def _make_badge_svg(
    label: str,
    status: str,
    left_bg: str = "#555",
    right_bg: str = "#3dbbc4",
    score: int | None = None,
) -> str:
    """Generate a shields.io-style flat SVG badge."""
    # Calculate text widths (approximate: 6.5px per char at 11px font)
    label_width = len(label) * 6.5 + 12
    status_text = f"{status} · {score}" if score is not None else status
    status_width = len(status_text) * 6.5 + 12
    total_width = label_width + status_width

    label_x = label_width / 2
    status_x = label_width + status_width / 2

    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{total_width:.0f}" height="20" role="img" aria-label="{label}: {status_text}">
  <title>{label}: {status_text}</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r">
    <rect width="{total_width:.0f}" height="20" rx="3" fill="#fff"/>
  </clipPath>
  <g clip-path="url(#r)">
    <rect width="{label_width:.0f}" height="20" fill="{left_bg}"/>
    <rect x="{label_width:.0f}" width="{status_width:.0f}" height="20" fill="{right_bg}"/>
    <rect width="{total_width:.0f}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="110">
    <text aria-hidden="true" x="{label_x * 10:.0f}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="{(label_width - 12) * 10:.0f}" lengthAdjust="spacing">{label}</text>
    <text x="{label_x * 10:.0f}" y="140" transform="scale(.1)" fill="#fff" textLength="{(label_width - 12) * 10:.0f}" lengthAdjust="spacing">{label}</text>
    <text aria-hidden="true" x="{status_x * 10:.0f}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="{(status_width - 12) * 10:.0f}" lengthAdjust="spacing">{status_text}</text>
    <text x="{status_x * 10:.0f}" y="140" transform="scale(.1)" fill="#fff" textLength="{(status_width - 12) * 10:.0f}" lengthAdjust="spacing">{status_text}</text>
  </g>
</svg>"""


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.get("/api/badges/{agent_id}.svg")
async def get_badge_svg(
    agent_id: str,
    request: Request,
    style: str = Query("flat", description="Badge style (flat only for now)"),
) -> Response:
    """Return an SVG badge for an agent listing."""
    store = request.app.state.store
    agent = store.get_agent(agent_id)

    if agent is None:
        # Return a "not found" badge instead of 404 (shields.io convention)
        svg = _make_badge_svg(**BADGE_COLORS["not_found"])
        return Response(
            content=svg,
            media_type="image/svg+xml",
            headers={
                "Cache-Control": "no-cache, no-store, must-revalidate",
                "Access-Control-Allow-Origin": "*",
            },
        )

    # Determine badge type from trust tier or verified status
    trust_tier = agent.get("trust_tier", "unknown")
    verified = agent.get("verified", False)

    if verified or trust_tier in ("verified", "trusted"):
        badge_key = TIER_BADGE.get(trust_tier, "verified")
    else:
        badge_key = "listed"

    colors = BADGE_COLORS[badge_key]
    trust_score = agent.get("trust_score")

    svg = _make_badge_svg(
        label=colors["label"],
        status=colors["status"],
        left_bg=colors["left_bg"],
        right_bg=colors["right_bg"],
        score=trust_score if trust_score and trust_score > 0 else None,
    )

    return Response(
        content=svg,
        media_type="image/svg+xml",
        headers={
            # Cache for 1 hour — badges update when trust score changes
            "Cache-Control": "public, max-age=3600, s-maxage=3600",
            "Access-Control-Allow-Origin": "*",
        },
    )


@router.get("/api/badges/{agent_id}.json")
async def get_badge_json(
    agent_id: str,
    request: Request,
) -> dict[str, Any]:
    """Return badge metadata in shields.io endpoint format.
    
    Can be used with: https://img.shields.io/endpoint?url=...
    """
    store = request.app.state.store
    agent = store.get_agent(agent_id)

    if agent is None:
        return {
            "schemaVersion": 1,
            "label": "Agentry",
            "message": "Not Found",
            "color": "lightgrey",
        }

    trust_tier = agent.get("trust_tier", "unknown")
    verified = agent.get("verified", False)
    trust_score = agent.get("trust_score")

    if verified or trust_tier in ("verified", "trusted"):
        status = "Verified"
        color = "brightgreen"
    else:
        status = "Listed"
        color = "informational"

    if trust_score and trust_score > 0:
        status = f"{status} · {trust_score}"

    return {
        "schemaVersion": 1,
        "label": "Agentry",
        "message": status,
        "color": color,
        "namedLogo": "data:image/svg+xml;base64,",  # Could add Agentry logo
    }


# ---------------------------------------------------------------------------
# Badge embed helper endpoint
# ---------------------------------------------------------------------------

@router.get("/api/badges/{agent_id}/embed")
async def get_badge_embed_code(
    agent_id: str,
    request: Request,
) -> dict[str, Any]:
    """Return embed code snippets for an agent's badge."""
    store = request.app.state.store
    agent = store.get_agent(agent_id)

    if agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")

    agent_name = agent.get("name", "Agent")
    badge_url = f"https://api.agentry.com/api/badges/{agent_id}.svg"
    listing_url = f"https://agentry.com/agent/{agent_id}"

    return {
        "agent_id": agent_id,
        "agent_name": agent_name,
        "badge_url": badge_url,
        "listing_url": listing_url,
        "markdown": f"[![{agent_name} on Agentry]({badge_url})]({listing_url})",
        "html": f'<a href="{listing_url}" target="_blank" rel="noopener"><img src="{badge_url}" alt="{agent_name} on Agentry" /></a>',
        "rst": f".. image:: {badge_url}\n   :target: {listing_url}\n   :alt: {agent_name} on Agentry",
    }

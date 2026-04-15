"""Trust score computation engine for A2A agents.

Computes a 0–100 trust score from TrustSignals, assigns a tier, and
returns a weighted breakdown explaining each component.
"""

from __future__ import annotations

import logging

from models import TrustSignals

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Weight table — points each signal contributes to the 0–100 score
# ---------------------------------------------------------------------------

WEIGHTS = {
    "card_resolves":       20,
    "card_schema_valid":   15,
    "domain_matches_url":  10,
    "has_provider_info":    5,
    "has_auth_scheme":      5,
    "has_skills":          10,
    "has_version":          5,
    "has_protocol_version": 5,
    "a2a_endpoint_live":    5,
    "mcp_endpoint_live":    5,
    "uptime_ratio":        10,
    "response_time":        5,
}

# Tier thresholds (inclusive lower bound)
TIER_THRESHOLDS: list[tuple[float, str]] = [
    (80, "verified"),
    (50, "basic"),
    (20, "unverified"),
    (0,  "suspicious"),
]

CHURN_PENALTY_THRESHOLD = 10
CHURN_PENALTY_POINTS = 10


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def compute_trust_score(signals: TrustSignals) -> tuple[float, str, dict[str, float]]:
    """Compute trust score, tier, and per-component breakdown.

    Returns:
        (score, tier, breakdown) where score ∈ [0, 100], tier is one of
        "verified"/"basic"/"unverified"/"suspicious", and breakdown maps
        component names to the points they contributed.
    """
    breakdown: dict[str, float] = {}

    # Binary boolean signals
    for field in (
        "card_resolves",
        "card_schema_valid",
        "domain_matches_url",
        "has_provider_info",
        "has_auth_scheme",
        "has_skills",
        "has_version",
        "has_protocol_version",
        "a2a_endpoint_live",
        "mcp_endpoint_live",
    ):
        value = getattr(signals, field, False)
        pts = WEIGHTS[field] if value else 0.0
        breakdown[field] = pts

    # Uptime ratio (scaled)
    if signals.uptime_checks_total > 0:
        ratio = signals.uptime_checks_passed / signals.uptime_checks_total
    else:
        ratio = 0.0
    breakdown["uptime_ratio"] = round(ratio * WEIGHTS["uptime_ratio"], 2)

    # Response time bonus
    rt = signals.response_time_ms
    if rt is not None and rt > 0:
        if rt < 500:
            rt_pts = WEIGHTS["response_time"]
        elif rt < 2000:
            # Linear interpolation: 500ms → full, 2000ms → 0
            rt_pts = WEIGHTS["response_time"] * (2000 - rt) / 1500
        else:
            rt_pts = 0.0
    else:
        rt_pts = 0.0
    breakdown["response_time"] = round(rt_pts, 2)

    raw_score = sum(breakdown.values())

    # Churn penalty
    penalty = 0.0
    if signals.version_changes_30d > CHURN_PENALTY_THRESHOLD:
        penalty = CHURN_PENALTY_POINTS
        breakdown["churn_penalty"] = -penalty

    score = max(0.0, min(100.0, round(raw_score - penalty, 2)))

    # Determine tier
    # "suspicious" is reserved for agents that previously had a card but
    # now show anomalous behaviour (card disappeared, excessive churn).
    # Agents that simply have not been discovered yet are "unverified".
    if not signals.card_resolves and signals.uptime_checks_passed == 0:
        # Never had a resolvable card — simply unverified, not suspicious
        tier = "unverified"
    elif not signals.card_resolves and signals.uptime_checks_passed > 0:
        # Card used to resolve but stopped — suspicious
        tier = "suspicious"
    elif penalty > 0:
        # Excessive version churn — suspicious regardless of score
        tier = "suspicious"
    else:
        tier = "suspicious"
        for threshold, tier_name in TIER_THRESHOLDS:
            if score >= threshold:
                tier = tier_name
                break

    return score, tier, breakdown

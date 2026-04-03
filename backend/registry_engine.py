"""Registry discovery and diff engine.

Orchestrates A2A Agent Card discovery across the agent directory,
creates snapshots, diffs against previous snapshots, computes trust
signals/scores, and updates agent listings.
"""

from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlparse

import httpx

from crawler import (
    WELL_KNOWN_PATHS,
    DEFAULT_TIMEOUT,
    MAX_CONCURRENT,
    validate_agent_card,
    parse_agent_card,
)
from models import AgentCardSnapshot, TrustSignals, TrustReport
from trust_engine import compute_trust_score

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Card diffing
# ---------------------------------------------------------------------------

def diff_cards(old_snapshot: dict[str, Any], new_snapshot: dict[str, Any]) -> dict[str, Any]:
    """Compare two raw-JSON snapshots and return a diff of what changed.

    Returns a dict with keys: added, removed, changed — each mapping
    field paths to (old, new) values.
    """
    old_raw = old_snapshot.get("raw_json", {})
    new_raw = new_snapshot.get("raw_json", {})

    diff: dict[str, Any] = {"added": {}, "removed": {}, "changed": {}}

    all_keys = set(old_raw.keys()) | set(new_raw.keys())
    for key in sorted(all_keys):
        old_val = old_raw.get(key)
        new_val = new_raw.get(key)

        if old_val is None and new_val is not None:
            diff["added"][key] = new_val
        elif old_val is not None and new_val is None:
            diff["removed"][key] = old_val
        elif old_val != new_val:
            diff["changed"][key] = {"old": old_val, "new": new_val}

    return diff


# ---------------------------------------------------------------------------
# Single-agent discovery
# ---------------------------------------------------------------------------

def _extract_domain(url: str) -> str | None:
    """Extract the domain (host) from a URL."""
    try:
        parsed = urlparse(url)
        host = parsed.hostname
        return host if host else None
    except Exception:
        return None


async def discover_agent_card(
    domain: str,
    timeout: float = DEFAULT_TIMEOUT,
) -> AgentCardSnapshot | None:
    """Fetch and validate an AgentCard from a domain's well-known paths.

    Returns an AgentCardSnapshot on success, None if no valid card found.
    """
    async with httpx.AsyncClient(
        timeout=httpx.Timeout(timeout),
        headers={"User-Agent": "Agentry-Registry/1.0"},
        http2=True,
    ) as client:
        for path in WELL_KNOWN_PATHS:
            url = f"https://{domain}{path}"
            start = time.monotonic()
            try:
                resp = await client.get(url, follow_redirects=True)
                elapsed_ms = round((time.monotonic() - start) * 1000, 2)

                if resp.status_code != 200:
                    continue

                try:
                    data = resp.json()
                except (ValueError, Exception):
                    continue

                errors = validate_agent_card(data)
                if errors:
                    logger.debug("Validation errors for %s: %s", url, errors)
                    continue

                card = parse_agent_card(data)

                return AgentCardSnapshot(
                    agent_id="",  # caller will fill this in
                    raw_json=data,
                    card=card,
                    url_source=url,
                    http_status=resp.status_code,
                    response_time_ms=elapsed_ms,
                )

            except httpx.TimeoutException:
                logger.debug("Timeout fetching %s", url)
            except httpx.ConnectError:
                logger.debug("Connection error for %s", url)
            except httpx.RequestError as exc:
                logger.debug("Request error for %s: %s", url, exc)
            except Exception as exc:
                logger.debug("Unexpected error for %s: %s", url, exc)

    return None


# ---------------------------------------------------------------------------
# Trust signal extraction
# ---------------------------------------------------------------------------

def _domain_matches(card_url: str, discovery_domain: str) -> bool:
    """Check if the card's declared URL domain matches the discovery domain."""
    card_domain = _extract_domain(card_url)
    if not card_domain:
        return False
    # Normalize: strip leading www.
    card_domain = card_domain.lstrip("www.")
    discovery_domain = discovery_domain.lstrip("www.")
    return card_domain == discovery_domain


def build_trust_signals(
    snapshot: AgentCardSnapshot | None,
    domain: str,
    previous_signals: TrustSignals | None = None,
) -> TrustSignals:
    """Derive TrustSignals from a snapshot (and optional prior signals for uptime history)."""
    signals = TrustSignals()

    # Carry forward uptime history
    if previous_signals:
        signals.uptime_checks_passed = previous_signals.uptime_checks_passed
        signals.uptime_checks_total = previous_signals.uptime_checks_total
        signals.version_changes_30d = previous_signals.version_changes_30d

    # Increment uptime tracking
    signals.uptime_checks_total += 1

    if snapshot is None or snapshot.card is None:
        # Card did not resolve — no further signals to set
        return signals

    card = snapshot.card
    signals.card_resolves = True
    signals.uptime_checks_passed += 1

    # Schema valid (we only create snapshots for cards that pass validation)
    signals.card_schema_valid = True

    # Domain match
    signals.domain_matches_url = _domain_matches(card.url, domain)

    # Provider info
    signals.has_provider_info = (
        card.provider is not None
        and bool(card.provider.organization)
    )

    # Auth scheme
    signals.has_auth_scheme = (
        card.authentication is not None
        and len(card.authentication.schemes) > 0
    )

    # Skills
    signals.has_skills = len(card.skills) > 0

    # Versions
    signals.has_version = card.version is not None and card.version != ""
    signals.has_protocol_version = card.protocolVersion is not None and card.protocolVersion != ""

    # Capabilities
    signals.supports_streaming = card.capabilities.streaming
    signals.supports_push_notifications = card.capabilities.pushNotifications
    signals.supports_state_history = card.capabilities.stateTransitionHistory

    # Response time
    signals.response_time_ms = snapshot.response_time_ms

    # Track version changes (increment if version differs from previous)
    if previous_signals and snapshot.card and previous_signals.last_checked:
        # We'd need the previous card version to compare — use diff_from_previous
        if snapshot.diff_from_previous and "version" in snapshot.diff_from_previous.get("changed", {}):
            signals.version_changes_30d += 1

    signals.last_checked = datetime.now(timezone.utc)
    return signals


# ---------------------------------------------------------------------------
# Full discovery cycle
# ---------------------------------------------------------------------------

async def run_discovery_cycle(store: Any) -> dict[str, Any]:
    """Run a full discovery cycle across all agents in the store.

    For each agent:
    1. Extract domain from URL
    2. Attempt to fetch AgentCard
    3. Create snapshot and diff against previous
    4. Compute trust signals and score
    5. Update the agent listing

    Returns summary statistics.
    """
    agents, total = store.list_agents(limit=10000, offset=0)
    logger.info("Starting discovery cycle for %d agents", total)

    stats = {
        "total_agents": total,
        "scanned": 0,
        "cards_found": 0,
        "cards_new": 0,
        "cards_changed": 0,
        "cards_unchanged": 0,
        "errors": 0,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

    semaphore = asyncio.Semaphore(MAX_CONCURRENT)

    async def _process_agent(agent: dict[str, Any]) -> None:
        agent_id = agent.get("id", "")
        agent_url = agent.get("url", "")
        domain = _extract_domain(agent_url)

        if not domain:
            logger.debug("Skipping agent %s — no domain from URL %s", agent_id, agent_url)
            stats["errors"] += 1
            return

        async with semaphore:
            try:
                snapshot = await discover_agent_card(domain)
            except Exception as exc:
                logger.error("Discovery failed for %s: %s", domain, exc)
                stats["errors"] += 1
                return

        stats["scanned"] += 1

        # Get previous snapshot for diffing
        previous_snapshot = store.get_latest_snapshot(agent_id)
        previous_report = store.get_trust_report(agent_id)
        previous_signals = (
            TrustSignals(**previous_report["signals"])
            if previous_report and "signals" in previous_report
            else None
        )

        if snapshot is not None:
            snapshot.agent_id = agent_id
            stats["cards_found"] += 1

            # Diff against previous
            if previous_snapshot:
                diff = diff_cards(previous_snapshot, snapshot.model_dump(mode="json"))
                snapshot.diff_from_previous = diff
                has_changes = bool(diff.get("added") or diff.get("removed") or diff.get("changed"))
                if has_changes:
                    stats["cards_changed"] += 1
                else:
                    stats["cards_unchanged"] += 1
            else:
                stats["cards_new"] += 1

            # Store snapshot
            snap_data = snapshot.model_dump(mode="json")
            store.add_card_snapshot(snap_data)

            # Build trust signals
            signals = build_trust_signals(snapshot, domain, previous_signals)
        else:
            # Card didn't resolve — still build signals to track uptime failure
            signals = build_trust_signals(None, domain, previous_signals)

        # Compute trust score
        score, tier, breakdown = compute_trust_score(signals)

        # Store trust report
        report = TrustReport(
            agent_id=agent_id,
            trust_score=score,
            trust_tier=tier,
            signals=signals,
            score_breakdown=breakdown,
        )
        store.add_trust_report(report.model_dump(mode="json"))

        # Update the agent listing
        trust_update: dict[str, Any] = {
            "trust_score": score,
            "trust_tier": tier,
            "verification_status": tier,
            "last_card_check": datetime.now(timezone.utc).isoformat(),
        }
        if snapshot is not None:
            trust_update["card_url"] = snapshot.url_source
            trust_update["agent_card_snapshot_id"] = snapshot.id
            trust_update["a2a_support"] = "Yes"
        store.update_agent_trust(agent_id, trust_update)

    # Run all agent discoveries concurrently (bounded by semaphore)
    tasks = [_process_agent(agent) for agent in agents]
    await asyncio.gather(*tasks, return_exceptions=True)

    logger.info(
        "Discovery cycle complete: %d scanned, %d cards found, %d new, %d changed",
        stats["scanned"],
        stats["cards_found"],
        stats["cards_new"],
        stats["cards_changed"],
    )
    return stats

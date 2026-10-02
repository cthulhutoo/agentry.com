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

PROBE_TIMEOUT = 3.0  # seconds — keep probes fast to avoid slowing discovery
PROBE_USER_AGENT = "Agentry-Probe/1.0"

A2A_PROBE_PATHS = ["/a2a", "/", "/tasks/send"]
MCP_PROBE_PATHS = ["/mcp", "/", "/tools"]

A2A_PROBE_BODY = {"jsonrpc": "2.0", "method": "agent/info", "id": "probe-1"}
MCP_PROBE_BODY = {"jsonrpc": "2.0", "method": "tools/list", "id": "probe-1"}


# ---------------------------------------------------------------------------
# Live endpoint probing
# ---------------------------------------------------------------------------

async def _probe_endpoint(
    client: httpx.AsyncClient,
    base_url: str,
    paths: list[str],
    body: dict[str, Any],
    *,
    explicit_endpoint: str | None = None,
) -> str | None:
    """Probe a list of paths with a JSON-RPC POST and return the first working path.

    If *explicit_endpoint* is provided (from the agent card), it is tried first.
    Returns the path that succeeded, or None if all failed.
    """
    candidates = []
    if explicit_endpoint:
        candidates.append(explicit_endpoint)
    candidates.extend(p for p in paths if p != explicit_endpoint)

    for path in candidates:
        url = f"{base_url.rstrip('/')}{path}"
        try:
            resp = await client.post(url, json=body)
            if resp.status_code == 200:
                try:
                    data = resp.json()
                    if isinstance(data, dict):
                        logger.debug("Probe succeeded: %s → 200 JSON", url)
                        return path
                except (ValueError, Exception):
                    pass
        except (httpx.TimeoutException, httpx.ConnectError, httpx.RequestError) as exc:
            logger.debug("Probe failed for %s: %s", url, exc)
        except Exception as exc:
            logger.debug("Unexpected probe error for %s: %s", url, exc)

    return None


async def probe_a2a_endpoint(
    base_url: str,
    card_data: dict[str, Any] | None = None,
) -> str | None:
    """Probe for a live A2A endpoint. Returns the working path or None."""
    explicit = None
    if card_data:
        explicit = card_data.get("a2aEndpoint")
    async with httpx.AsyncClient(
        timeout=httpx.Timeout(PROBE_TIMEOUT),
        headers={"User-Agent": PROBE_USER_AGENT},
    ) as client:
        return await _probe_endpoint(client, base_url, A2A_PROBE_PATHS, A2A_PROBE_BODY, explicit_endpoint=explicit)


async def probe_mcp_endpoint(
    base_url: str,
    card_data: dict[str, Any] | None = None,
) -> str | None:
    """Probe for a live MCP endpoint. Returns the working path or None."""
    explicit = None
    if card_data:
        explicit = card_data.get("mcpEndpoint")
    async with httpx.AsyncClient(
        timeout=httpx.Timeout(PROBE_TIMEOUT),
        headers={"User-Agent": PROBE_USER_AGENT},
    ) as client:
        return await _probe_endpoint(client, base_url, MCP_PROBE_PATHS, MCP_PROBE_BODY, explicit_endpoint=explicit)


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

# Consecutive failed card fetches tolerated before a previously-resolving
# agent loses its card signals. A single timeout or blip must not flip a
# working agent to "suspicious".
FAILURE_GRACE_CHECKS = 3


def _carry_forward_on_transient_failure(
    signals: TrustSignals,
    previous_signals: TrustSignals | None,
) -> TrustSignals:
    """If a previously-resolving card failed this cycle, keep its card
    signals for up to FAILURE_GRACE_CHECKS consecutive misses.

    Uptime still records the failed check, so repeated outages lower the
    score through uptime_ratio before the card signals are dropped.
    """
    if previous_signals is None or not previous_signals.card_resolves:
        signals.consecutive_failures = 0
        return signals
    failures = previous_signals.consecutive_failures + 1
    if failures >= FAILURE_GRACE_CHECKS:
        signals.consecutive_failures = failures
        return signals
    carried = previous_signals.model_copy(deep=True)
    carried.uptime_checks_passed = signals.uptime_checks_passed
    carried.uptime_checks_total = signals.uptime_checks_total
    carried.consecutive_failures = failures
    carried.a2a_endpoint_live = False
    carried.mcp_endpoint_live = False
    carried.last_checked = datetime.now(timezone.utc)
    return carried


async def run_discovery_cycle(store: Any) -> dict[str, Any]:
    """Run a full discovery cycle across all agents in the store.

    Two phases, deliberately separated:

    1. **Network phase** — fetch every card and probe endpoints concurrently.
       No store reads that hit disk and no store writes happen here.
    2. **Persist phase** — compute trust signals/scores in memory and write
       the store exactly once via ``store.apply_discovery_batch``.

    The previous implementation persisted the full store.json 2–3 times per
    agent *inside* the event loop. Once the store grew (federated import,
    unbounded trust_reports/card_snapshots), each write blocked the loop for
    ~10s, so concurrent in-flight HTTP requests blew through their timeouts
    and working agents were recorded as "card stopped resolving" →
    ``suspicious``. Measured response times of 10–237s for cards that serve
    in <1s were the symptom.
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
        "grace_carried": 0,
        "errors": 0,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

    semaphore = asyncio.Semaphore(MAX_CONCURRENT)

    # ---- Phase 1: network only ------------------------------------------
    async def _fetch(agent: dict[str, Any]) -> dict[str, Any] | None:
        agent_id = agent.get("id", "")
        domain = _extract_domain(agent.get("url", ""))
        if not domain:
            stats["errors"] += 1
            return None
        async with semaphore:
            try:
                snapshot = await discover_agent_card(domain)
            except Exception as exc:
                logger.error("Discovery failed for %s: %s", domain, exc)
                stats["errors"] += 1
                return None
            card_data = snapshot.raw_json if snapshot else None
            a2a_path, mcp_path = await asyncio.gather(
                probe_a2a_endpoint(f"https://{domain}", card_data),
                probe_mcp_endpoint(f"https://{domain}", card_data),
            )
        stats["scanned"] += 1
        return {
            "agent": agent,
            "agent_id": agent_id,
            "domain": domain,
            "snapshot": snapshot,
            "a2a_path": a2a_path,
            "mcp_path": mcp_path,
        }

    fetched = await asyncio.gather(*[_fetch(a) for a in agents], return_exceptions=True)

    # ---- Phase 2: score in memory, persist once --------------------------
    latest_snapshots = store.latest_snapshots_by_agent()
    latest_reports = store.latest_trust_reports_by_agent()

    new_snapshots: list[dict[str, Any]] = []
    new_reports: list[dict[str, Any]] = []
    agent_updates: dict[str, dict[str, Any]] = {}

    for item in fetched:
        if not isinstance(item, dict):
            if isinstance(item, Exception):
                logger.error("Discovery task exception: %s", item)
                stats["errors"] += 1
            continue

        agent = item["agent"]
        agent_id = item["agent_id"]
        domain = item["domain"]
        snapshot = item["snapshot"]
        a2a_path, mcp_path = item["a2a_path"], item["mcp_path"]

        previous_snapshot = latest_snapshots.get(agent_id)
        previous_report = latest_reports.get(agent_id)
        previous_signals = (
            TrustSignals(**previous_report["signals"])
            if previous_report and "signals" in previous_report
            else None
        )

        snapshot_stored = False
        if snapshot is not None:
            snapshot.agent_id = agent_id
            stats["cards_found"] += 1
            if previous_snapshot:
                diff = diff_cards(previous_snapshot, snapshot.model_dump(mode="json"))
                snapshot.diff_from_previous = diff
                if diff.get("added") or diff.get("removed") or diff.get("changed"):
                    stats["cards_changed"] += 1
                    new_snapshots.append(snapshot.model_dump(mode="json"))
                    snapshot_stored = True
                else:
                    # Unchanged card: don't append a duplicate snapshot.
                    stats["cards_unchanged"] += 1
            else:
                stats["cards_new"] += 1
                new_snapshots.append(snapshot.model_dump(mode="json"))
                snapshot_stored = True
            signals = build_trust_signals(snapshot, domain, previous_signals)
            signals.consecutive_failures = 0
        else:
            signals = build_trust_signals(None, domain, previous_signals)
            signals = _carry_forward_on_transient_failure(signals, previous_signals)
            if signals.card_resolves:
                stats["grace_carried"] += 1

        if a2a_path:
            signals.a2a_endpoint_live = True
        if mcp_path:
            signals.mcp_endpoint_live = True

        score, tier, breakdown = compute_trust_score(signals)

        report = TrustReport(
            agent_id=agent_id,
            trust_score=score,
            trust_tier=tier,
            signals=signals,
            score_breakdown=breakdown,
        )
        new_reports.append(report.model_dump(mode="json"))

        update: dict[str, Any] = {
            "trust_score": score,
            "trust_tier": tier,
            "verification_status": tier,
            "last_card_check": datetime.now(timezone.utc).isoformat(),
        }
        if snapshot is not None:
            update["card_url"] = snapshot.url_source
            update["agent_card_snapshot_id"] = (
                snapshot.id if snapshot_stored else (previous_snapshot or {}).get("id", snapshot.id)
            )
            update["a2a_support"] = "Yes" if a2a_path else "No"
            update["a2a_endpoint"] = a2a_path
            update["mcp_support"] = "Yes" if mcp_path else agent.get("mcp_support", "Unknown")
            update["mcp_endpoint"] = mcp_path
        elif not signals.card_resolves:
            update["a2a_support"] = "No"
            update["a2a_endpoint"] = None
            update["mcp_endpoint"] = None
        agent_updates[agent_id] = update

    store.apply_discovery_batch(
        agent_updates=agent_updates,
        snapshots=new_snapshots,
        reports=new_reports,
    )

    logger.info(
        "Discovery cycle complete: %d scanned, %d cards found, %d new, %d changed, %d grace-carried",
        stats["scanned"], stats["cards_found"], stats["cards_new"],
        stats["cards_changed"], stats["grace_carried"],
    )
    return stats

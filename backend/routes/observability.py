"""Agent Observability & Monitoring API.

External monitors (or peer agents acting as checkers) submit ping
results for any registered agent.  This module accumulates those
results to provide:

- Real-time uptime status and historical availability percentages
- Latency percentile stats (p50, p95, p99) over configurable windows
- Anomaly detection for latency spikes and consecutive downtime runs
- A platform-wide health dashboard for operator dashboards

Every ping also feeds into the reputation engine: uptime checks affect
the *reliability* dimension and latency measurements affect the
*performance* dimension of the multi-dimensional reputation score.

Design notes:
    - All time windows are computed at read time from stored ping records.
    - Anomaly thresholds (3× latency spike, 3 consecutive downs) are
      deliberately conservative to minimise false positives.
    - The ``checked_by`` field lets consumers trace which monitor or
      peer agent submitted each check for accountability.
"""

from __future__ import annotations

import logging
import statistics
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/observability", tags=["observability"])

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

WINDOW_24H = timedelta(hours=24)
WINDOW_7D = timedelta(days=7)
WINDOW_30D = timedelta(days=30)

# Anomaly thresholds
LATENCY_SPIKE_MULTIPLIER = 3.0   # flag if latest latency > 3× 24h average
CONSECUTIVE_DOWN_THRESHOLD = 3   # flag if this many consecutive pings are down


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class PingResultRequest(BaseModel):
    """Payload submitted by a monitor to record a single uptime check."""

    status: str = Field(
        ...,
        description="Result of the check: 'up' if the agent responded successfully, 'down' otherwise.",
    )
    latency_ms: float | None = Field(
        default=None,
        ge=0,
        description=(
            "Round-trip latency in milliseconds. Should be omitted or null when status is 'down' "
            "and no connection could be established."
        ),
    )
    checked_by: str = Field(
        default="system",
        description=(
            "Identifier of the entity performing the check — 'system' for the platform monitor, "
            "or an agent_id for peer-to-peer health checks."
        ),
    )
    error: str | None = Field(
        default=None,
        description="Error message if status is 'down', e.g., timeout, connection refused.",
    )
    endpoint: str | None = Field(
        default=None,
        description="Specific endpoint or URL that was probed, if relevant.",
    )


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _get_store(request: Request):
    """Return the application-level data store from request state."""
    return request.app.state.store


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _now_iso() -> str:
    return _now().isoformat()


def _parse_ts(ts_str: str) -> datetime | None:
    """Parse an ISO 8601 timestamp string, returning None on failure."""
    try:
        dt = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except (ValueError, AttributeError):
        return None


def _filter_by_window(pings: list[dict], window: timedelta) -> list[dict]:
    """Return only pings whose timestamp falls within the given window from now."""
    cutoff = _now() - window
    result = []
    for p in pings:
        ts = _parse_ts(p.get("timestamp", ""))
        if ts and ts >= cutoff:
            result.append(p)
    return result


def _uptime_pct(pings: list[dict]) -> float | None:
    """Compute uptime percentage (0–100) from a list of ping records."""
    if not pings:
        return None
    up_count = sum(1 for p in pings if p.get("status") == "up")
    return round(up_count / len(pings) * 100, 2)


def _latency_percentile(values: list[float], pct: float) -> float | None:
    """Return the given percentile (0–100) of a list of latency values."""
    if not values:
        return None
    sorted_vals = sorted(values)
    idx = (pct / 100) * (len(sorted_vals) - 1)
    lower, upper = int(idx), min(int(idx) + 1, len(sorted_vals) - 1)
    frac = idx - lower
    return round(sorted_vals[lower] * (1 - frac) + sorted_vals[upper] * frac, 2)


def _record_reputation(store, agent_id: str, event_type: str, value: float, metadata: dict | None = None) -> None:
    """Record a reputation event; swallows errors so ping recording never fails."""
    try:
        store.add_reputation_event({
            "agent_id": agent_id,
            "event_type": event_type,
            "value": value,
            "source": "observability_system",
            "metadata": metadata or {},
            "timestamp": _now_iso(),
        })
    except Exception as exc:  # noqa: BLE001
        logger.warning("Failed to record reputation event (%s) for %s: %s", event_type, agent_id, exc)


def _detect_anomalies(pings: list[dict]) -> list[dict[str, Any]]:
    """
    Analyse the ping history for anomalies.

    Detects two classes of anomaly:
    1. **Latency spike** — the most recent ping with a latency reading
       exceeds ``LATENCY_SPIKE_MULTIPLIER`` × the 24-hour average.
    2. **Consecutive downtime** — the latest N consecutive pings are all
       down (N = ``CONSECUTIVE_DOWN_THRESHOLD``).

    Returns a list of anomaly dicts, each with keys:
    ``type``, ``severity``, ``description``, ``detected_at``.
    """
    anomalies: list[dict[str, Any]] = []
    now = _now_iso()

    if not pings:
        return anomalies

    # Sort newest first for consecutive-down check
    sorted_pings = sorted(pings, key=lambda p: p.get("timestamp", ""), reverse=True)

    # --- Consecutive downtime ---
    down_run = 0
    for p in sorted_pings:
        if p.get("status") == "down":
            down_run += 1
        else:
            break  # first "up" breaks the run

    if down_run >= CONSECUTIVE_DOWN_THRESHOLD:
        anomalies.append({
            "type": "consecutive_downtime",
            "severity": "critical" if down_run >= 5 else "high",
            "description": f"{down_run} consecutive ping(s) returned 'down'.",
            "detail": {"consecutive_down_count": down_run},
            "detected_at": now,
        })

    # --- Latency spike ---
    pings_24h = _filter_by_window(pings, WINDOW_24H)
    latencies_24h = [p["latency_ms"] for p in pings_24h if p.get("latency_ms") is not None]
    if len(latencies_24h) >= 2:
        avg_latency = statistics.mean(latencies_24h)
        # Find the most recent ping that has a latency reading
        recent_with_latency = [
            p for p in sorted_pings if p.get("latency_ms") is not None
        ]
        if recent_with_latency:
            latest_latency = recent_with_latency[0]["latency_ms"]
            if avg_latency > 0 and latest_latency > avg_latency * LATENCY_SPIKE_MULTIPLIER:
                anomalies.append({
                    "type": "latency_spike",
                    "severity": "medium",
                    "description": (
                        f"Latest latency {latest_latency:.0f} ms is "
                        f"{latest_latency / avg_latency:.1f}× the 24h average "
                        f"({avg_latency:.0f} ms)."
                    ),
                    "detail": {
                        "latest_latency_ms": latest_latency,
                        "avg_24h_latency_ms": round(avg_latency, 2),
                        "spike_ratio": round(latest_latency / avg_latency, 2),
                    },
                    "detected_at": now,
                })

    return anomalies


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.post("/ping/{agent_id}", status_code=201, response_model=dict[str, Any])
async def record_ping(request: Request, agent_id: str, body: PingResultRequest) -> dict[str, Any]:
    """Record an uptime check result for an agent.

    Called by external monitors or peer agents after probing the target
    agent's A2A endpoint (or any configured health URL).  Persists the
    ping record and immediately fires two reputation events:

    - ``uptime_check`` with value 1.0 (up) or 0.0 (down) → *reliability* dimension
    - ``response_latency`` with value = latency_ms → *performance* dimension (if available)

    These reputation signals ensure that the reputation score reflects
    real observed behaviour, not just self-reported metadata.
    """
    store = _get_store(request)

    agent = store.get_agent(agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail=f"Agent '{agent_id}' not found.")

    if body.status not in ("up", "down"):
        raise HTTPException(status_code=400, detail="status must be 'up' or 'down'.")

    if body.status == "up" and body.latency_ms is None:
        # Latency should always be recorded for successful checks, but we don't hard-block
        logger.debug("Uptime ping for %s marked 'up' but missing latency_ms", agent_id)

    ping_record = {
        "agent_id": agent_id,
        "timestamp": _now_iso(),
        "status": body.status,
        "latency_ms": body.latency_ms,
        "checked_by": body.checked_by,
        "error": body.error,
        "endpoint": body.endpoint,
    }
    store.add_ping_result(ping_record)

    # --- Reputation events ---
    uptime_value = 1.0 if body.status == "up" else 0.0
    _record_reputation(store, agent_id, "uptime_check", uptime_value, {"checked_by": body.checked_by})

    if body.latency_ms is not None:
        _record_reputation(
            store, agent_id, "response_latency", body.latency_ms,
            {"checked_by": body.checked_by},
        )

    logger.info(
        "Ping recorded for %s: status=%s latency=%s ms by %s",
        agent_id, body.status, body.latency_ms, body.checked_by,
    )
    return {"recorded": True, "agent_id": agent_id, "ping": ping_record}


@router.get("/status/{agent_id}", response_model=dict[str, Any])
async def get_agent_status(request: Request, agent_id: str) -> dict[str, Any]:
    """Get the current status and uptime percentages for an agent.

    Returns:
    - ``current_status``: the result of the most recent ping ('up', 'down', or 'unknown')
    - ``uptime_24h``, ``uptime_7d``, ``uptime_30d``: availability percentages over each window
    - ``last_checked_at``: timestamp of the most recent ping
    - ``total_checks``: all-time ping count

    The uptime percentages are computed from raw ping history, so they
    always reflect the full recorded window rather than a pre-aggregated
    number that could drift from the underlying data.
    """
    store = _get_store(request)

    agent = store.get_agent(agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail=f"Agent '{agent_id}' not found.")

    pings = store.list_ping_results(agent_id, limit=10000)

    # Sort newest first
    pings_sorted = sorted(pings, key=lambda p: p.get("timestamp", ""), reverse=True)

    current_status = pings_sorted[0]["status"] if pings_sorted else "unknown"
    last_checked_at = pings_sorted[0]["timestamp"] if pings_sorted else None

    pings_24h = _filter_by_window(pings, WINDOW_24H)
    pings_7d = _filter_by_window(pings, WINDOW_7D)
    pings_30d = _filter_by_window(pings, WINDOW_30D)

    return {
        "agent_id": agent_id,
        "current_status": current_status,
        "last_checked_at": last_checked_at,
        "uptime_24h": _uptime_pct(pings_24h),
        "uptime_7d": _uptime_pct(pings_7d),
        "uptime_30d": _uptime_pct(pings_30d),
        "checks_24h": len(pings_24h),
        "checks_7d": len(pings_7d),
        "checks_30d": len(pings_30d),
        "total_checks": len(pings),
    }


@router.get("/latency/{agent_id}", response_model=dict[str, Any])
async def get_latency_stats(request: Request, agent_id: str) -> dict[str, Any]:
    """Get latency statistics for an agent over the last 24 hours.

    Computes p50, p95, and p99 latency percentiles along with the
    simple arithmetic mean for the 24-hour window.  Only pings with a
    recorded ``latency_ms`` value are included.

    These stats help consumers evaluate whether an agent meets their
    SLA requirements before initiating a transaction, and feed into
    the *performance* dimension of the reputation engine.
    """
    store = _get_store(request)

    agent = store.get_agent(agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail=f"Agent '{agent_id}' not found.")

    pings = store.list_ping_results(agent_id, limit=10000)
    pings_24h = _filter_by_window(pings, WINDOW_24H)

    latencies = [p["latency_ms"] for p in pings_24h if p.get("latency_ms") is not None]

    if not latencies:
        return {
            "agent_id": agent_id,
            "window": "24h",
            "sample_count": 0,
            "p50_ms": None,
            "p95_ms": None,
            "p99_ms": None,
            "avg_ms": None,
            "min_ms": None,
            "max_ms": None,
            "message": "No latency data available in the last 24 hours.",
        }

    return {
        "agent_id": agent_id,
        "window": "24h",
        "sample_count": len(latencies),
        "p50_ms": _latency_percentile(latencies, 50),
        "p95_ms": _latency_percentile(latencies, 95),
        "p99_ms": _latency_percentile(latencies, 99),
        "avg_ms": round(statistics.mean(latencies), 2),
        "min_ms": round(min(latencies), 2),
        "max_ms": round(max(latencies), 2),
    }


@router.get("/history/{agent_id}", response_model=dict[str, Any])
async def get_ping_history(
    request: Request,
    agent_id: str,
    limit: int = Query(default=100, ge=1, le=500, description="Number of most recent pings to return."),
    status_filter: str | None = Query(
        default=None,
        alias="status",
        description="Optional filter: 'up' or 'down'.",
    ),
) -> dict[str, Any]:
    """Return historical ping records for an agent, newest first.

    Supports optional filtering by status ('up' or 'down') to quickly
    identify all outage windows or all successful checks.  Limited to
    the last ``limit`` results (max 500) to keep response sizes manageable.

    Consumers can use this data to build custom uptime charts or audit
    the monitoring coverage frequency for a given agent.
    """
    store = _get_store(request)

    agent = store.get_agent(agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail=f"Agent '{agent_id}' not found.")

    if status_filter and status_filter not in ("up", "down"):
        raise HTTPException(status_code=400, detail="status filter must be 'up' or 'down'.")

    pings = store.list_ping_results(agent_id, limit=10000)

    # Apply optional status filter
    if status_filter:
        pings = [p for p in pings if p.get("status") == status_filter]

    # Sort newest first then paginate
    pings.sort(key=lambda p: p.get("timestamp", ""), reverse=True)

    return {
        "agent_id": agent_id,
        "pings": pings[:limit],
        "returned": min(len(pings), limit),
        "total": len(pings),
        "filter": status_filter,
    }


@router.get("/anomalies/{agent_id}", response_model=dict[str, Any])
async def get_anomalies(request: Request, agent_id: str) -> dict[str, Any]:
    """Detect and return anomalies in an agent's monitoring data.

    Runs two anomaly detection algorithms against the stored ping history:

    1. **Consecutive downtime** — raises *critical* (5+ pings) or *high*
       (3–4 pings) severity if the most recent N pings are all 'down'.
       This pattern strongly suggests a real outage rather than a fluke.

    2. **Latency spike** — raises *medium* severity if the latest latency
       reading exceeds 3× the 24-hour average.  A single spike may be
       noise, but combined with the reputation latency trend it indicates
       degraded performance.

    Returns an empty ``anomalies`` list when the agent appears healthy,
    so callers can use a simple ``if anomalies`` check.
    """
    store = _get_store(request)

    agent = store.get_agent(agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail=f"Agent '{agent_id}' not found.")

    pings = store.list_ping_results(agent_id, limit=10000)
    anomalies = _detect_anomalies(pings)

    return {
        "agent_id": agent_id,
        "anomalies": anomalies,
        "anomaly_count": len(anomalies),
        "total_pings_analysed": len(pings),
        "healthy": len(anomalies) == 0,
        "evaluated_at": _now_iso(),
    }


@router.get("/dashboard", response_model=dict[str, Any])
async def observability_dashboard(request: Request) -> dict[str, Any]:
    """Platform-wide health overview for operator dashboards.

    Aggregates across all monitored agents to surface:
    - ``total_monitored``: agents that have at least one ping record
    - ``agents_up``, ``agents_down``: counts based on most recent ping
    - ``agents_unknown``: agents with no pings in the last 24 hours
    - ``avg_uptime_24h``: mean uptime percentage across all monitored agents
    - ``p95_latency_ms``: platform-wide p95 latency over the last 24 hours
    - ``agents_with_anomalies``: count of agents currently showing anomalies

    This endpoint intentionally returns aggregate data only — individual
    agent details require the per-agent endpoints above.
    """
    store = _get_store(request)

    agents, _total = store.list_agents(limit=10000, offset=0)

    total_monitored = 0
    agents_up = 0
    agents_down = 0
    agents_unknown = 0
    agents_with_anomalies = 0
    uptime_pcts: list[float] = []
    all_latencies_24h: list[float] = []

    for agent in agents:
        agent_id = agent.get("id", "")
        pings = store.list_ping_results(agent_id, limit=1000)

        if not pings:
            continue  # not monitored

        total_monitored += 1
        pings_sorted = sorted(pings, key=lambda p: p.get("timestamp", ""), reverse=True)

        # Current status = most recent ping
        latest_status = pings_sorted[0].get("status", "unknown")
        latest_ts = _parse_ts(pings_sorted[0].get("timestamp", ""))

        # Consider "unknown" if last ping is older than 24h
        if latest_ts and (_now() - latest_ts) > WINDOW_24H:
            agents_unknown += 1
        elif latest_status == "up":
            agents_up += 1
        elif latest_status == "down":
            agents_down += 1
        else:
            agents_unknown += 1

        # Uptime over 24h
        pings_24h = _filter_by_window(pings, WINDOW_24H)
        pct = _uptime_pct(pings_24h)
        if pct is not None:
            uptime_pcts.append(pct)

        # Collect latencies
        all_latencies_24h.extend(
            p["latency_ms"] for p in pings_24h if p.get("latency_ms") is not None
        )

        # Anomaly check
        if _detect_anomalies(pings):
            agents_with_anomalies += 1

    avg_uptime = round(statistics.mean(uptime_pcts), 2) if uptime_pcts else None
    p95_latency = _latency_percentile(all_latencies_24h, 95) if all_latencies_24h else None

    return {
        "total_monitored": total_monitored,
        "agents_up": agents_up,
        "agents_down": agents_down,
        "agents_unknown": agents_unknown,
        "agents_with_anomalies": agents_with_anomalies,
        "avg_uptime_24h": avg_uptime,
        "p95_latency_ms_24h": p95_latency,
        "generated_at": _now_iso(),
    }

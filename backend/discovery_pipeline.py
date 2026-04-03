"""A2A Agent Discovery Pipeline.

Orchestrates net-new agent discovery:
1. Fetches candidate domains from multiple sources
2. Scans each for a valid .well-known/agent.json or agent-card.json
3. Validates the A2A Agent Card
4. Adds new agents to the Agentry directory (deduped against existing)
5. Logs discovery stats

Usage:
    python discovery_pipeline.py          # run standalone
    # Or import and call from run_discovery.py / API endpoints
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx

from crawler import (
    WELL_KNOWN_PATHS,
    DEFAULT_TIMEOUT,
    validate_agent_card,
    parse_agent_card,
)
from database import DataStore
from discovery_sources import fetch_all_sources
from models import AgentListing

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Discovery log — tracks what we've found over time
# ---------------------------------------------------------------------------

_DISCOVERY_LOG_PATH = Path(__file__).resolve().parent / "discovery_log.json"


def _load_discovery_log() -> dict[str, Any]:
    """Load the persistent discovery log."""
    if _DISCOVERY_LOG_PATH.exists():
        try:
            return json.loads(_DISCOVERY_LOG_PATH.read_text())
        except Exception:
            pass
    return {"runs": [], "known_domains": [], "last_run": None}


def _save_discovery_log(log: dict[str, Any]) -> None:
    """Persist the discovery log."""
    try:
        _DISCOVERY_LOG_PATH.write_text(json.dumps(log, indent=2, default=str))
    except Exception as exc:
        logger.error("Failed to save discovery log: %s", exc)


# ---------------------------------------------------------------------------
# Agent Card scanner for new domains
# ---------------------------------------------------------------------------

async def scan_domain_for_card(
    client: httpx.AsyncClient,
    domain: str,
    semaphore: asyncio.Semaphore,
) -> dict[str, Any] | None:
    """Scan a single domain for a valid A2A Agent Card.
    
    Returns parsed card data if found, None otherwise.
    """
    async with semaphore:
        for path in WELL_KNOWN_PATHS:
            url = f"https://{domain}{path}"
            try:
                start = time.monotonic()
                resp = await client.get(url, follow_redirects=True)
                elapsed = round((time.monotonic() - start) * 1000, 2)

                if resp.status_code != 200:
                    continue

                try:
                    data = resp.json()
                except (json.JSONDecodeError, ValueError):
                    continue

                errors = validate_agent_card(data)
                if errors:
                    logger.debug("Card validation failed for %s: %s", domain, errors)
                    continue

                card = parse_agent_card(data)
                return {
                    "domain": domain,
                    "card_url": url,
                    "card_data": data,
                    "card": card,
                    "response_time_ms": elapsed,
                    "protocol_version": data.get("protocolVersion", "unknown"),
                }

            except httpx.TimeoutException:
                logger.debug("Timeout scanning %s", url)
            except httpx.ConnectError:
                logger.debug("Connection failed for %s", domain)
            except Exception as exc:
                logger.debug("Error scanning %s: %s", url, exc)

    return None


# ---------------------------------------------------------------------------
# Category guesser
# ---------------------------------------------------------------------------

CATEGORY_KEYWORDS = {
    "Customer Service": [
        "customer", "support", "help desk", "ticket", "helpdesk",
        "chat", "conversational", "service desk", "cx",
    ],
    "Sales & Outreach": [
        "sales", "outreach", "lead", "prospect", "crm", "pipeline",
        "revenue", "deal", "cold email", "sdr", "bdr",
    ],
    "Marketing & Content": [
        "marketing", "content", "seo", "social media", "copywriting",
        "campaign", "brand", "creative", "advertising",
    ],
    "Developer Tools": [
        "developer", "api", "code", "programming", "devops", "ci/cd",
        "testing", "deployment", "infrastructure", "sdk",
    ],
    "Data & Analytics": [
        "data", "analytics", "intelligence", "insights", "reporting",
        "dashboard", "metrics", "visualization", "bi",
    ],
    "Productivity": [
        "productivity", "workflow", "automation", "task", "scheduling",
        "calendar", "project management", "collaboration",
    ],
    "Security & Compliance": [
        "security", "compliance", "audit", "risk", "fraud",
        "identity", "authentication", "encryption",
    ],
    "HR & Recruiting": [
        "hr", "recruiting", "hiring", "talent", "onboarding",
        "employee", "workforce", "payroll",
    ],
    "Finance": [
        "finance", "accounting", "invoice", "payment", "billing",
        "tax", "expense", "budget", "fintech",
    ],
}


def guess_category(name: str, description: str) -> str:
    """Guess an agent category from its name and description."""
    text = f"{name} {description}".lower()
    scores: dict[str, int] = {}
    for category, keywords in CATEGORY_KEYWORDS.items():
        score = sum(1 for kw in keywords if kw in text)
        if score > 0:
            scores[category] = score
    if scores:
        return max(scores, key=scores.get)
    return "Uncategorized"


# ---------------------------------------------------------------------------
# Main pipeline
# ---------------------------------------------------------------------------

async def run_discovery_pipeline(
    store: DataStore | None = None,
    scan_cards: bool = True,
    max_concurrent: int = 15,
    dry_run: bool = False,
) -> dict[str, Any]:
    """Run the full discovery pipeline.
    
    Args:
        store: DataStore instance (created if None)
        scan_cards: Whether to scan domains for Agent Cards
        max_concurrent: Max concurrent HTTP requests
        dry_run: If True, don't add agents to the store
        
    Returns:
        Stats dict with discovery results.
    """
    if store is None:
        store = DataStore()

    start_time = time.monotonic()
    log = _load_discovery_log()

    stats = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "sources_fetched": 0,
        "candidates_found": 0,
        "already_known": 0,
        "new_domains": 0,
        "cards_found": 0,
        "agents_added": 0,
        "errors": 0,
        "new_agents": [],
    }

    # Step 1: Fetch candidates from all sources
    logger.info("Step 1: Fetching candidates from discovery sources...")
    try:
        candidates = await fetch_all_sources()
        stats["candidates_found"] = len(candidates)
    except Exception as exc:
        logger.error("Failed to fetch discovery sources: %s", exc)
        stats["errors"] += 1
        return stats

    # Step 2: Filter out domains we already have
    existing_agents, total = store.list_agents(limit=100000, offset=0)
    existing_domains: set[str] = set()
    existing_urls: set[str] = set()
    for agent in existing_agents:
        url = agent.get("url", "")
        existing_urls.add(url.lower())
        domain = _extract_domain(url)
        if domain:
            existing_domains.add(domain.lstrip("www."))

    new_candidates: list[dict[str, Any]] = []
    for candidate in candidates:
        domain = candidate.get("domain", "").lstrip("www.")
        if domain in existing_domains:
            stats["already_known"] += 1
        else:
            new_candidates.append(candidate)

    stats["new_domains"] = len(new_candidates)
    logger.info(
        "Step 2: %d candidates, %d already known, %d new to scan",
        len(candidates),
        stats["already_known"],
        len(new_candidates),
    )

    if not new_candidates:
        logger.info("No new domains to scan.")
        elapsed = round(time.monotonic() - start_time, 2)
        stats["elapsed_seconds"] = elapsed
        log["runs"].append(stats)
        log["last_run"] = stats["timestamp"]
        _save_discovery_log(log)
        return stats

    # Step 3: Scan new domains for A2A Agent Cards
    if scan_cards:
        logger.info("Step 3: Scanning %d new domains for Agent Cards...", len(new_candidates))
        semaphore = asyncio.Semaphore(max_concurrent)

        async with httpx.AsyncClient(
            timeout=httpx.Timeout(15.0),
            headers={"User-Agent": "Agentry-Discovery/1.0"},
            http2=True,
        ) as client:
            scan_tasks = [
                scan_domain_for_card(client, c["domain"], semaphore)
                for c in new_candidates
            ]
            scan_results = await asyncio.gather(*scan_tasks, return_exceptions=True)

        # Map scan results back to candidates
        for candidate, result in zip(new_candidates, scan_results):
            if isinstance(result, dict) and result is not None:
                candidate["has_card"] = True
                candidate["card_data"] = result.get("card_data")
                candidate["card_url"] = result.get("card_url")
                candidate["response_time_ms"] = result.get("response_time_ms")
                candidate["protocol_version"] = result.get("protocol_version")
                # Use card data for better name/description
                card_data = result.get("card_data", {})
                if card_data.get("name"):
                    candidate["name"] = card_data["name"]
                if card_data.get("description"):
                    candidate["description"] = card_data["description"]
                stats["cards_found"] += 1
            elif isinstance(result, Exception):
                logger.debug("Scan error for %s: %s", candidate["domain"], result)
                candidate["has_card"] = False
            else:
                candidate["has_card"] = False

        logger.info("Step 3: Found %d valid Agent Cards", stats["cards_found"])

    # Step 4: Add new agents to the store
    logger.info("Step 4: Adding new agents to directory...")
    next_id = total  # Start numbering after existing agents

    for candidate in new_candidates:
        # Add ALL discovered domains, not just those with cards
        # Agents without cards get lower trust scores (handled by trust engine)
        # This way we're building a comprehensive directory
        has_card = candidate.get("has_card", False)
        
        # Guess category
        category = guess_category(
            candidate.get("name", ""),
            candidate.get("description", ""),
        )

        agent_data = {
            "id": f"agent-{next_id:04d}",
            "name": candidate.get("name", candidate["domain"]),
            "url": candidate.get("url", f"https://{candidate['domain']}"),
            "category": category,
            "description": candidate.get("description", "")[:500],
            "pricing_model": "Unknown",
            "starting_price": "Unknown",
            "key_features": "",
            "integrations": "",
            "a2a_support": "Yes" if has_card else "Unknown",
            "mcp_support": "Unknown",
            "trust_score": 0,
            "verification_status": "unverified",
            "trust_tier": "unverified",
            "discovery_source": candidate.get("source", "unknown"),
            "discovered_at": datetime.now(timezone.utc).isoformat(),
            "created_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }

        if has_card:
            agent_data["card_url"] = candidate.get("card_url", "")
            agent_data["protocol_version"] = candidate.get("protocol_version", "")

        if not dry_run:
            store.add_agent(agent_data)
            stats["agents_added"] += 1
        
        stats["new_agents"].append({
            "name": agent_data["name"],
            "domain": candidate["domain"],
            "has_card": has_card,
            "source": candidate.get("source", "unknown"),
            "category": category,
        })

        next_id += 1
        # Track domain as known
        existing_domains.add(candidate["domain"])

    logger.info("Step 4: Added %d new agents to directory", stats["agents_added"])

    # Update discovery log
    elapsed = round(time.monotonic() - start_time, 2)
    stats["elapsed_seconds"] = elapsed
    
    # Keep new_agents summary concise for log
    log_stats = {k: v for k, v in stats.items() if k != "new_agents"}
    log_stats["new_agent_names"] = [a["name"] for a in stats["new_agents"]]
    log["runs"].append(log_stats)
    log["known_domains"] = sorted(existing_domains)
    log["last_run"] = stats["timestamp"]
    
    # Only keep last 100 runs
    if len(log["runs"]) > 100:
        log["runs"] = log["runs"][-100:]

    _save_discovery_log(log)

    logger.info(
        "Discovery pipeline complete in %.1fs: %d candidates → %d new → %d with cards → %d added",
        elapsed,
        stats["candidates_found"],
        stats["new_domains"],
        stats["cards_found"],
        stats["agents_added"],
    )

    return stats


def _extract_domain(url: str) -> str | None:
    """Extract domain from a URL."""
    try:
        parsed = urlparse(url if "://" in url else f"https://{url}")
        host = parsed.hostname
        return host.lstrip("www.") if host else None
    except Exception:
        return None


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="A2A Agent Discovery Pipeline")
    parser.add_argument("--dry-run", action="store_true", help="Don't add agents to store")
    parser.add_argument("--no-scan", action="store_true", help="Skip Agent Card scanning")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    stats = asyncio.run(run_discovery_pipeline(
        scan_cards=not args.no_scan,
        dry_run=args.dry_run,
    ))

    print(json.dumps(stats, indent=2, default=str))

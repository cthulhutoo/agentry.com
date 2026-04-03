#!/usr/bin/env python3
"""A2A Agent Card Crawler.

Discovers Agent Cards published at well-known URLs across domains.
Supports both `/.well-known/agent-card.json` and `/.well-known/agent.json`.

Usage:
    python crawler.py --domains domains.txt --output results.json
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx

from models import AgentCard, AgentCapabilities, AgentProvider, AgentSkill, ScanResult

logger = logging.getLogger("crawler")

# Well-known paths defined by the A2A protocol
WELL_KNOWN_PATHS = [
    "/.well-known/agent-card.json",
    "/.well-known/agent.json",
]

DEFAULT_TIMEOUT = 15.0  # seconds per request
MAX_CONCURRENT = 10     # rate limiter concurrency cap


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

REQUIRED_FIELDS = {"name", "url"}


def validate_agent_card(data: dict[str, Any]) -> list[str]:
    """Return a list of validation errors (empty == valid)."""
    errors: list[str] = []
    for field in REQUIRED_FIELDS:
        if field not in data or not data[field]:
            errors.append(f"Missing required field: {field}")

    if "skills" in data and not isinstance(data["skills"], list):
        errors.append("'skills' must be an array")

    if "capabilities" in data and not isinstance(data["capabilities"], dict):
        errors.append("'capabilities' must be an object")

    return errors


def parse_agent_card(data: dict[str, Any]) -> AgentCard:
    """Parse a raw JSON dict into a validated AgentCard model."""
    provider = None
    if "provider" in data and isinstance(data["provider"], dict):
        provider = AgentProvider(
            organization=data["provider"].get("organization", ""),
            url=data["provider"].get("url"),
        )

    capabilities = AgentCapabilities()
    if "capabilities" in data and isinstance(data["capabilities"], dict):
        capabilities = AgentCapabilities(**{
            k: v for k, v in data["capabilities"].items()
            if k in AgentCapabilities.model_fields
        })

    skills: list[AgentSkill] = []
    for raw_skill in data.get("skills", []):
        if isinstance(raw_skill, dict) and "id" in raw_skill and "name" in raw_skill:
            skills.append(AgentSkill(
                id=raw_skill["id"],
                name=raw_skill["name"],
                description=raw_skill.get("description"),
                inputModes=raw_skill.get("inputModes", []),
                outputModes=raw_skill.get("outputModes", []),
            ))

    return AgentCard(
        name=data.get("name", ""),
        description=data.get("description"),
        url=data.get("url", ""),
        provider=provider,
        version=data.get("version"),
        protocolVersion=data.get("protocolVersion"),
        capabilities=capabilities,
        skills=skills,
        defaultInputModes=data.get("defaultInputModes", ["text"]),
        defaultOutputModes=data.get("defaultOutputModes", ["text"]),
    )


# ---------------------------------------------------------------------------
# Single-domain scanner
# ---------------------------------------------------------------------------

async def scan_domain(
    client: httpx.AsyncClient,
    domain: str,
    semaphore: asyncio.Semaphore,
) -> list[ScanResult]:
    """Scan a single domain for Agent Cards at all well-known paths."""
    results: list[ScanResult] = []

    for path in WELL_KNOWN_PATHS:
        url = f"https://{domain}{path}"
        result = ScanResult(domain=domain, url_checked=url)

        async with semaphore:
            start = time.monotonic()
            try:
                resp = await client.get(url, follow_redirects=True)
                elapsed_ms = (time.monotonic() - start) * 1000

                result.http_status = resp.status_code
                result.response_time_ms = round(elapsed_ms, 2)

                if resp.status_code == 200:
                    try:
                        data = resp.json()
                    except (json.JSONDecodeError, ValueError):
                        result.error = "Invalid JSON in response body"
                        results.append(result)
                        continue

                    validation_errors = validate_agent_card(data)
                    if validation_errors:
                        result.error = "; ".join(validation_errors)
                    else:
                        result.valid = True
                        result.agent_card = parse_agent_card(data)
                else:
                    result.error = f"HTTP {resp.status_code}"

            except httpx.TimeoutException:
                result.response_time_ms = round((time.monotonic() - start) * 1000, 2)
                result.error = "Request timed out"
            except httpx.ConnectError as exc:
                result.response_time_ms = round((time.monotonic() - start) * 1000, 2)
                result.error = f"Connection error: {exc}"
            except httpx.RequestError as exc:
                result.response_time_ms = round((time.monotonic() - start) * 1000, 2)
                result.error = f"Request error: {exc}"
            except Exception as exc:
                result.response_time_ms = round((time.monotonic() - start) * 1000, 2)
                result.error = f"Unexpected error: {exc}"

        results.append(result)

        # If we found a valid card on the first path, skip the second
        if result.valid:
            break

    return results


# ---------------------------------------------------------------------------
# Batch crawler
# ---------------------------------------------------------------------------

async def crawl_domains(
    domains: list[str],
    timeout: float = DEFAULT_TIMEOUT,
    max_concurrent: int = MAX_CONCURRENT,
) -> list[ScanResult]:
    """Crawl multiple domains concurrently for A2A Agent Cards."""
    semaphore = asyncio.Semaphore(max_concurrent)

    async with httpx.AsyncClient(
        timeout=httpx.Timeout(timeout),
        headers={"User-Agent": "Agentry-Crawler/1.0"},
        http2=True,
    ) as client:
        tasks = [scan_domain(client, d.strip(), semaphore) for d in domains if d.strip()]
        nested = await asyncio.gather(*tasks, return_exceptions=True)

    results: list[ScanResult] = []
    for item in nested:
        if isinstance(item, list):
            results.extend(item)
        elif isinstance(item, Exception):
            logger.error("Task-level exception: %s", item)

    return results


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def load_domains(path: str) -> list[str]:
    """Read domains from a file, one per line, ignoring comments and blanks."""
    lines = Path(path).read_text().splitlines()
    return [line.strip() for line in lines if line.strip() and not line.strip().startswith("#")]


def results_to_json(results: list[ScanResult]) -> list[dict[str, Any]]:
    """Serialize scan results to JSON-safe dicts."""
    return [r.model_dump(mode="json") for r in results]


def print_summary(results: list[ScanResult]) -> None:
    """Print a human-readable summary to stderr."""
    total = len(results)
    valid = sum(1 for r in results if r.valid)
    failed = total - valid
    domains_scanned = len({r.domain for r in results})

    print(f"\n{'=' * 60}", file=sys.stderr)
    print(f"  Agentry Crawler — Scan Summary", file=sys.stderr)
    print(f"{'=' * 60}", file=sys.stderr)
    print(f"  Domains scanned : {domains_scanned}", file=sys.stderr)
    print(f"  URLs checked    : {total}", file=sys.stderr)
    print(f"  Valid cards     : {valid}", file=sys.stderr)
    print(f"  Failed/invalid  : {failed}", file=sys.stderr)
    print(f"{'=' * 60}\n", file=sys.stderr)

    if valid:
        print("  Discovered Agent Cards:", file=sys.stderr)
        for r in results:
            if r.valid and r.agent_card:
                card = r.agent_card
                print(f"    - {card.name} ({r.domain}) [{card.protocolVersion or 'n/a'}]", file=sys.stderr)
        print(file=sys.stderr)


async def async_main(args: argparse.Namespace) -> None:
    domains = load_domains(args.domains)
    if not domains:
        logger.error("No domains found in %s", args.domains)
        sys.exit(1)

    logger.info("Starting crawl of %d domains", len(domains))
    results = await crawl_domains(
        domains,
        timeout=args.timeout,
        max_concurrent=args.concurrency,
    )

    print_summary(results)

    output = {
        "crawl_metadata": {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "domains_count": len(domains),
            "results_count": len(results),
            "valid_count": sum(1 for r in results if r.valid),
        },
        "results": results_to_json(results),
    }

    if args.output:
        Path(args.output).write_text(json.dumps(output, indent=2, default=str))
        logger.info("Results written to %s", args.output)
    else:
        print(json.dumps(output, indent=2, default=str))


def main() -> None:
    parser = argparse.ArgumentParser(description="A2A Agent Card Crawler")
    parser.add_argument(
        "--domains",
        required=True,
        help="Path to a file with one domain per line",
    )
    parser.add_argument(
        "--output",
        default=None,
        help="Output file path (default: stdout)",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=DEFAULT_TIMEOUT,
        help=f"Per-request timeout in seconds (default: {DEFAULT_TIMEOUT})",
    )
    parser.add_argument(
        "--concurrency",
        type=int,
        default=MAX_CONCURRENT,
        help=f"Max concurrent requests (default: {MAX_CONCURRENT})",
    )
    parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Enable verbose logging",
    )
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    asyncio.run(async_main(args))


if __name__ == "__main__":
    main()

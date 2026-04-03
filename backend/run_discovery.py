#!/usr/bin/env python3
"""Standalone discovery cron script — v2 with net-new discovery.

Run periodically (e.g. every 6 hours) to:
1. Discover NEW agents from external sources (registries, GitHub, partners)
2. Re-scan all existing agents for Agent Card changes and trust score updates

Usage:
    python run_discovery.py            # run full cycle (discover + re-scan)
    python run_discovery.py --rescan   # only re-scan existing agents
    python run_discovery.py --discover # only discover new agents

    # crontab (every 6 hours):
    # 0 */6 * * * cd /opt/agentry && /opt/agentry/venv/bin/python3 run_discovery.py >> /var/log/agentry-discovery.log 2>&1
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys

from database import DataStore
from registry_engine import run_discovery_cycle
from discovery_pipeline import run_discovery_pipeline

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("run_discovery")


async def main(discover: bool = True, rescan: bool = True) -> None:
    store = DataStore()

    # Phase 1: Discover new agents from external sources
    if discover:
        logger.info("=" * 60)
        logger.info("PHASE 1: Net-new agent discovery")
        logger.info("=" * 60)
        try:
            discovery_stats = await run_discovery_pipeline(store=store)
            logger.info(
                "Discovery complete: %d candidates → %d new → %d added",
                discovery_stats.get("candidates_found", 0),
                discovery_stats.get("new_domains", 0),
                discovery_stats.get("agents_added", 0),
            )
        except Exception:
            logger.exception("Discovery pipeline failed — continuing to re-scan")

    # Phase 2: Re-scan all existing agents for card updates
    if rescan:
        logger.info("=" * 60)
        logger.info("PHASE 2: Re-scanning existing agents")
        logger.info("=" * 60)
        stats = await run_discovery_cycle(store)
        logger.info("Re-scan complete: %s", stats)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Agentry Discovery Runner")
    parser.add_argument("--discover", action="store_true", help="Only run new agent discovery")
    parser.add_argument("--rescan", action="store_true", help="Only re-scan existing agents")
    args = parser.parse_args()

    # If neither flag set, run both
    do_discover = True
    do_rescan = True
    if args.discover and not args.rescan:
        do_rescan = False
    elif args.rescan and not args.discover:
        do_discover = False

    try:
        asyncio.run(main(discover=do_discover, rescan=do_rescan))
    except KeyboardInterrupt:
        logger.info("Discovery interrupted.")
        sys.exit(1)

"""Database schema, connection helpers, and JSON-file data store for MVP."""

from __future__ import annotations

import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Any

from models import (
    AgentListing,
    BrokerIntakeRecord,
    ScanResult,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# PostgreSQL migration SQL (for future use — not executed in MVP)
# ---------------------------------------------------------------------------

MIGRATION_SQL = """
-- Enable pgvector for semantic search
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS agents (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    url           TEXT NOT NULL,
    category      TEXT NOT NULL DEFAULT 'Uncategorized',
    description   TEXT DEFAULT '',
    pricing_model TEXT DEFAULT 'Unknown',
    starting_price TEXT DEFAULT 'Unknown',
    key_features  TEXT DEFAULT '',
    integrations  TEXT DEFAULT '',
    a2a_support   TEXT DEFAULT 'Unknown',
    mcp_support   TEXT DEFAULT 'Unknown',
    trust_score   REAL,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_cards (
    id               SERIAL PRIMARY KEY,
    agent_id         TEXT REFERENCES agents(id) ON DELETE CASCADE,
    name             TEXT NOT NULL,
    description      TEXT,
    url              TEXT NOT NULL,
    provider_org     TEXT,
    provider_url     TEXT,
    version          TEXT,
    protocol_version TEXT,
    capabilities     JSONB DEFAULT '{}',
    skills           JSONB DEFAULT '[]',
    authentication   JSONB,
    default_input_modes  JSONB DEFAULT '["text"]',
    default_output_modes JSONB DEFAULT '["text"]',
    raw_json         JSONB,
    fetched_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS scan_results (
    id              SERIAL PRIMARY KEY,
    domain          TEXT NOT NULL,
    url_checked     TEXT NOT NULL,
    http_status     INTEGER,
    response_time_ms REAL,
    valid           BOOLEAN DEFAULT FALSE,
    agent_card_id   INTEGER REFERENCES agent_cards(id),
    error           TEXT,
    scanned_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS broker_intakes (
    id                      TEXT PRIMARY KEY,
    business_name           TEXT NOT NULL,
    contact_email           TEXT NOT NULL,
    business_type           TEXT NOT NULL,
    agent_needs_description TEXT NOT NULL,
    budget_range            TEXT DEFAULT '500_2k',
    current_tools           TEXT DEFAULT '',
    urgency                 TEXT DEFAULT 'medium',
    status                  TEXT DEFAULT 'pending',
    matched_agents          JSONB DEFAULT '[]',
    created_at              TIMESTAMPTZ DEFAULT NOW(),
    updated_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
    id          TEXT PRIMARY KEY,
    email       TEXT UNIQUE NOT NULL,
    name        TEXT,
    role        TEXT DEFAULT 'user',
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_card_snapshots (
    id               TEXT PRIMARY KEY,
    agent_id         TEXT REFERENCES agents(id) ON DELETE CASCADE,
    raw_json         JSONB NOT NULL,
    card             JSONB,
    url_source       TEXT NOT NULL,
    http_status      INTEGER NOT NULL,
    response_time_ms REAL NOT NULL,
    fetched_at       TIMESTAMPTZ DEFAULT NOW(),
    diff_from_previous JSONB
);

CREATE TABLE IF NOT EXISTS trust_reports (
    id              SERIAL PRIMARY KEY,
    agent_id        TEXT REFERENCES agents(id) ON DELETE CASCADE,
    trust_score     REAL NOT NULL DEFAULT 0,
    trust_tier      TEXT NOT NULL DEFAULT 'unverified',
    signals         JSONB NOT NULL DEFAULT '{}',
    computed_at     TIMESTAMPTZ DEFAULT NOW(),
    score_breakdown JSONB DEFAULT '{}'
);

-- Add trust columns to agents
ALTER TABLE agents ADD COLUMN IF NOT EXISTS verification_status TEXT DEFAULT 'unverified';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS trust_tier TEXT DEFAULT 'unverified';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS last_card_check TIMESTAMPTZ;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS card_url TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS agent_card_snapshot_id TEXT;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_agents_category ON agents(category);
CREATE INDEX IF NOT EXISTS idx_scan_results_domain ON scan_results(domain);
CREATE INDEX IF NOT EXISTS idx_broker_intakes_status ON broker_intakes(status);
CREATE INDEX IF NOT EXISTS idx_card_snapshots_agent ON agent_card_snapshots(agent_id);
CREATE INDEX IF NOT EXISTS idx_trust_reports_agent ON trust_reports(agent_id);
"""

# ---------------------------------------------------------------------------
# JSON file-backed data store (MVP)
# ---------------------------------------------------------------------------

_DATA_DIR = Path(__file__).resolve().parent
_STORE_PATH = _DATA_DIR / "store.json"
_SEED_PATH = _DATA_DIR.parent / "agent_directory_data.json"


def _empty_store() -> dict[str, Any]:
    return {
        "agents": [],
        "broker_intakes": [],
        "scan_results": [],
        "card_snapshots": [],
        "trust_reports": [],
        "organizations": [],
        "private_agents": [],
        "ecash_transactions": [],
        "identities": [],
        "reputation_events": [],
        "escrow_contracts": [],
        "ping_results": [],
        "certifications": [],
    }


def _load_store() -> dict[str, Any]:
    """Load the JSON store from disk, with backup protection against data loss."""

    # 1. If store.json exists and is valid, use it
    if _STORE_PATH.exists():
        try:
            with open(_STORE_PATH) as f:
                data = json.load(f)
            # Backfill any new collections added since the store was created
            for key, default in _empty_store().items():
                if key not in data:
                    data[key] = default
            return data
        except (json.JSONDecodeError, OSError):
            logger.error("store.json is corrupt, checking backups...")

    # 2. store.json is missing or corrupt — check for backups before re-seeding
    try:
        from backup import list_backups, restore_backup

        backups = list_backups()
        if backups:
            latest = backups[0]
            agent_count = latest.get("agent_count", 0)
            logger.warning(
                "store.json missing! Found %d backups. Restoring from %s (%d agents)",
                len(backups),
                latest["filename"],
                agent_count,
            )
            restored = restore_backup(latest["path"])
            if restored and len(restored.get("agents", [])) > 0:
                _save_store(restored)
                logger.info("Successfully restored store from backup: %s", latest["filename"])
                return restored
            logger.error("Backup restore failed, falling back to seed data")
        else:
            logger.warning("store.json missing and no backups found — seeding from scratch")
    except Exception:
        logger.exception("Backup restore check failed — falling back to seed data")

    # 3. Last resort: seed from agent_directory_data.json
    store = _empty_store()
    if _SEED_PATH.exists():
        try:
            with open(_SEED_PATH) as f:
                seed = json.load(f)
            for idx, raw in enumerate(seed.get("agents", [])):
                listing = AgentListing(
                    id=f"agent-{idx:04d}",
                    name=raw.get("name", ""),
                    url=raw.get("url", ""),
                    category=raw.get("category", "Uncategorized"),
                    description=raw.get("description", ""),
                    pricing_model=raw.get("pricing_model", "Unknown"),
                    starting_price=raw.get("starting_price", "Unknown"),
                    key_features=raw.get("key_features", ""),
                    integrations=raw.get("integrations", ""),
                    a2a_support=raw.get("a2a_support", "Unknown"),
                    mcp_support=raw.get("mcp_support", "Unknown"),
                )
                store["agents"].append(listing.model_dump(mode="json"))
            logger.info("Seeded %d agents from %s", len(store["agents"]), _SEED_PATH)
        except Exception:
            logger.exception("Failed to seed from %s", _SEED_PATH)

    _save_store(store)
    return store


def _save_store(store: dict[str, Any]) -> None:
    """Persist the store to disk."""
    try:
        with open(_STORE_PATH, "w") as f:
            json.dump(store, f, indent=2, default=str)
    except OSError:
        logger.exception("Failed to write store.json")


# ---------------------------------------------------------------------------
# Public helpers used by route handlers
# ---------------------------------------------------------------------------

class DataStore:
    """Simple in-memory + JSON-file data store with multi-worker support."""

    def __init__(self) -> None:
        self._store = _load_store()
        self._last_mtime = _STORE_PATH.stat().st_mtime if _STORE_PATH.exists() else 0

    def _reload_if_stale(self) -> None:
        """Re-read from disk if another worker has written a newer version."""
        if _STORE_PATH.exists():
            current_mtime = _STORE_PATH.stat().st_mtime
            if current_mtime > self._last_mtime:
                self._store = _load_store()
                self._last_mtime = current_mtime

    def _persist(self) -> None:
        _save_store(self._store)
        if _STORE_PATH.exists():
            self._last_mtime = _STORE_PATH.stat().st_mtime

    # -- Agents -------------------------------------------------------------

    def list_agents(
        self,
        category: str | None = None,
        limit: int = 20,
        offset: int = 0,
    ) -> tuple[list[dict[str, Any]], int]:
        self._reload_if_stale()
        agents = self._store["agents"]
        if category:
            agents = [a for a in agents if a.get("category", "").lower() == category.lower()]
        total = len(agents)
        return agents[offset : offset + limit], total

    def search_agents(
        self,
        query: str,
        category: str | None = None,
        limit: int = 20,
        offset: int = 0,
    ) -> tuple[list[dict[str, Any]], int]:
        self._reload_if_stale()
        q = query.lower()
        agents = self._store["agents"]
        matched = [
            a
            for a in agents
            if q in a.get("name", "").lower()
            or q in a.get("description", "").lower()
            or q in a.get("key_features", "").lower()
            or q in a.get("category", "").lower()
            or q in a.get("integrations", "").lower()
        ]
        if category:
            matched = [a for a in matched if a.get("category", "").lower() == category.lower()]
        total = len(matched)
        return matched[offset : offset + limit], total

    def get_agent(self, agent_id: str) -> dict[str, Any] | None:
        self._reload_if_stale()
        for a in self._store["agents"]:
            if a.get("id") == agent_id:
                return a
        return None

    def add_agent(self, data: dict[str, Any]) -> dict[str, Any]:
        self._store["agents"].append(data)
        self._persist()
        return data

    def get_categories(self) -> list[dict[str, Any]]:
        self._reload_if_stale()
        counts: dict[str, int] = {}
        for a in self._store["agents"]:
            cat = a.get("category", "Uncategorized")
            counts[cat] = counts.get(cat, 0) + 1
        return [{"category": k, "count": v} for k, v in sorted(counts.items())]

    # -- Broker intakes -----------------------------------------------------

    def add_intake(self, data: dict[str, Any]) -> dict[str, Any]:
        self._store["broker_intakes"].append(data)
        self._persist()
        return data

    def get_intake(self, intake_id: str) -> dict[str, Any] | None:
        self._reload_if_stale()
        for i in self._store["broker_intakes"]:
            if i.get("id") == intake_id:
                return i
        return None

    # -- Scan results -------------------------------------------------------

    def add_scan_results(self, results: list[dict[str, Any]]) -> None:
        self._store["scan_results"].extend(results)
        self._persist()

    def get_scan_results(self, limit: int = 50, offset: int = 0) -> tuple[list[dict[str, Any]], int]:
        self._reload_if_stale()
        all_results = self._store["scan_results"]
        # Most recent first
        all_results_sorted = sorted(all_results, key=lambda r: r.get("timestamp", ""), reverse=True)
        total = len(all_results_sorted)
        return all_results_sorted[offset : offset + limit], total

    # -- Agent trust updates ------------------------------------------------

    def update_agent_trust(self, agent_id: str, trust_data: dict[str, Any]) -> None:
        """Update trust-related fields on an agent listing."""
        for a in self._store["agents"]:
            if a.get("id") == agent_id:
                a.update(trust_data)
                a["updated_at"] = datetime.utcnow().isoformat()
                break
        self._persist()

    # -- Card snapshots -----------------------------------------------------

    def add_card_snapshot(self, snapshot: dict[str, Any]) -> dict[str, Any]:
        """Store an AgentCard snapshot."""
        self._store["card_snapshots"].append(snapshot)
        self._persist()
        return snapshot

    def get_card_snapshots(self, agent_id: str, limit: int = 10) -> list[dict[str, Any]]:
        """Get snapshot history for an agent, most recent first."""
        self._reload_if_stale()
        snaps = [
            s for s in self._store["card_snapshots"]
            if s.get("agent_id") == agent_id
        ]
        snaps.sort(key=lambda s: s.get("fetched_at", ""), reverse=True)
        return snaps[:limit]

    def get_latest_snapshot(self, agent_id: str) -> dict[str, Any] | None:
        """Get the most recent snapshot for an agent."""
        self._reload_if_stale()
        snaps = self.get_card_snapshots(agent_id, limit=1)
        return snaps[0] if snaps else None

    # -- Trust reports ------------------------------------------------------

    def add_trust_report(self, report: dict[str, Any]) -> None:
        """Store a trust report."""
        self._store["trust_reports"].append(report)
        self._persist()

    def get_trust_report(self, agent_id: str) -> dict[str, Any] | None:
        """Get the latest trust report for an agent."""
        self._reload_if_stale()
        reports = [
            r for r in self._store["trust_reports"]
            if r.get("agent_id") == agent_id
        ]
        if not reports:
            return None
        reports.sort(key=lambda r: r.get("computed_at", ""), reverse=True)
        return reports[0]

    # -- Organizations ------------------------------------------------------

    def create_org(self, data: dict[str, Any]) -> dict[str, Any]:
        """Add an organization to the store."""
        self._store["organizations"].append(data)
        self._persist()
        return data

    def get_org(self, org_id: str) -> dict[str, Any] | None:
        self._reload_if_stale()
        for o in self._store["organizations"]:
            if o.get("id") == org_id:
                return o
        return None

    def get_org_by_api_key(self, api_key: str) -> dict[str, Any] | None:
        self._reload_if_stale()
        for o in self._store["organizations"]:
            if o.get("api_key") == api_key:
                return o
        return None

    def get_org_by_slug(self, slug: str) -> dict[str, Any] | None:
        self._reload_if_stale()
        for o in self._store["organizations"]:
            if o.get("slug") == slug:
                return o
        return None

    def list_orgs(self) -> list[dict[str, Any]]:
        self._reload_if_stale()
        return list(self._store["organizations"])

    def update_org(self, org_id: str, updates: dict[str, Any]) -> dict[str, Any] | None:
        self._reload_if_stale()
        for o in self._store["organizations"]:
            if o.get("id") == org_id:
                o.update(updates)
                o["updated_at"] = datetime.utcnow().isoformat()
                self._persist()
                return o
        return None

    # -- Private agents -----------------------------------------------------

    def add_private_agent(self, data: dict[str, Any]) -> dict[str, Any]:
        self._store["private_agents"].append(data)
        self._persist()
        return data

    def get_private_agent(self, agent_id: str, org_id: str) -> dict[str, Any] | None:
        self._reload_if_stale()
        for a in self._store["private_agents"]:
            if a.get("id") == agent_id and a.get("org_id") == org_id:
                return a
        return None

    def list_private_agents(
        self,
        org_id: str,
        category: str | None = None,
        environment: str | None = None,
        status: str = "active",
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[dict[str, Any]], int]:
        self._reload_if_stale()
        agents = [a for a in self._store["private_agents"] if a.get("org_id") == org_id]
        if status:
            agents = [a for a in agents if a.get("status") == status]
        if category:
            agents = [a for a in agents if a.get("category", "").lower() == category.lower()]
        if environment:
            agents = [a for a in agents if a.get("environment", "").lower() == environment.lower()]
        total = len(agents)
        return agents[offset : offset + limit], total

    def update_private_agent(self, agent_id: str, org_id: str, updates: dict[str, Any]) -> dict[str, Any] | None:
        self._reload_if_stale()
        for a in self._store["private_agents"]:
            if a.get("id") == agent_id and a.get("org_id") == org_id:
                a.update(updates)
                a["updated_at"] = datetime.utcnow().isoformat()
                self._persist()
                return a
        return None

    def delete_private_agent(self, agent_id: str, org_id: str) -> bool:
        self._reload_if_stale()
        for a in self._store["private_agents"]:
            if a.get("id") == agent_id and a.get("org_id") == org_id:
                a["status"] = "deprecated"
                a["updated_at"] = datetime.utcnow().isoformat()
                self._persist()
                return True
        return False

    def get_private_agent_stats(self, org_id: str) -> dict[str, Any]:
        """Get counts by environment, status, and trust_tier for an org."""
        self._reload_if_stale()
        agents = [a for a in self._store["private_agents"] if a.get("org_id") == org_id]
        env_counts: dict[str, int] = {}
        status_counts: dict[str, int] = {}
        tier_counts: dict[str, int] = {}
        for a in agents:
            env = a.get("environment", "unknown")
            env_counts[env] = env_counts.get(env, 0) + 1
            st = a.get("status", "unknown")
            status_counts[st] = status_counts.get(st, 0) + 1
            tier = a.get("trust_tier", "unverified")
            tier_counts[tier] = tier_counts.get(tier, 0) + 1
        return {
            "total": len(agents),
            "by_environment": env_counts,
            "by_status": status_counts,
            "by_trust_tier": tier_counts,
        }

    # -- Nostr Identities ---------------------------------------------------

    def add_identity(self, data):
        if "identities" not in self._store:
            self._store["identities"] = []
        self._store["identities"].append(data)
        self._persist()
        return data

    def list_identities(self, agent_id):
        self._reload_if_stale()
        return [i for i in self._store.get("identities", []) if i.get("agent_id") == agent_id]

    def list_all_identities(self):
        self._reload_if_stale()
        return self._store.get("identities", [])

    def update_identity(self, agent_id, data):
        for i, ident in enumerate(self._store.get("identities", [])):
            if ident.get("agent_id") == agent_id:
                self._store["identities"][i] = data
                break
        self._persist()

    # -- Reputation Events --------------------------------------------------

    def add_reputation_event(self, data):
        if "reputation_events" not in self._store:
            self._store["reputation_events"] = []
        self._store["reputation_events"].append(data)
        self._persist()
        return data

    def list_reputation_events(self, agent_id):
        self._reload_if_stale()
        return [e for e in self._store.get("reputation_events", []) if e.get("agent_id") == agent_id]

    # -- Escrow Contracts ---------------------------------------------------

    def add_escrow_contract(self, data):
        if "escrow_contracts" not in self._store:
            self._store["escrow_contracts"] = []
        self._store["escrow_contracts"].append(data)
        self._persist()
        return data

    def get_escrow_contract(self, contract_id):
        self._reload_if_stale()
        for c in self._store.get("escrow_contracts", []):
            if c.get("id") == contract_id:
                return c
        return None

    def update_escrow_contract(self, contract_id, data):
        for i, c in enumerate(self._store.get("escrow_contracts", [])):
            if c.get("id") == contract_id:
                self._store["escrow_contracts"][i].update(data)
                break
        self._persist()

    def list_escrow_contracts(self, agent_id=None, status=None, limit=50, offset=0):
        self._reload_if_stale()
        contracts = self._store.get("escrow_contracts", [])
        if agent_id:
            contracts = [c for c in contracts if c.get("poster_agent_id") == agent_id or c.get("worker_agent_id") == agent_id]
        if status:
            contracts = [c for c in contracts if c.get("status") == status]
        total = len(contracts)
        return contracts[offset:offset + limit], total

    # -- Escrow Memory -------------------------------------------------------

    def add_escrow_memory(self, contract_id: str, entry: dict) -> dict:
        """Store a memory entry for an escrow contract."""
        memory = self._store.setdefault("escrow_memory", {})
        memory.setdefault(contract_id, []).append(entry)
        if len(memory[contract_id]) > 10000:
            memory[contract_id] = memory[contract_id][-10000:]
        self._persist()
        return entry

    def get_escrow_memory(self, contract_id: str, visibility: str = None, entry_type: str = None, limit: int = 100, offset: int = 0) -> list:
        """Get memory entries for an escrow contract with optional filters."""
        self._reload_if_stale()
        entries = self._store.get("escrow_memory", {}).get(contract_id, [])
        if visibility:
            entries = [e for e in entries if e.get("visibility") == visibility]
        if entry_type:
            entries = [e for e in entries if e.get("type") == entry_type]
        entries = sorted(entries, key=lambda e: e.get("created_at", ""))
        return entries[offset:offset + limit]

    def get_escrow_memory_entry(self, contract_id: str, entry_id: str) -> dict | None:
        """Get a single memory entry by ID."""
        self._reload_if_stale()
        for entry in self._store.get("escrow_memory", {}).get(contract_id, []):
            if entry.get("entry_id") == entry_id:
                return entry
        return None

    def search_escrow_memory(self, contract_id: str, query: str, entry_type: str = None) -> list:
        """Case-insensitive substring search across memory entry content."""
        self._reload_if_stale()
        entries = self._store.get("escrow_memory", {}).get(contract_id, [])
        query_lower = query.lower()
        results = []
        for entry in entries:
            content = entry.get("content", "")
            if query_lower in content.lower():
                if entry_type and entry.get("type") != entry_type:
                    continue
                results.append(entry)
        return sorted(results, key=lambda e: e.get("created_at", ""))

    # -- Observability Pings ------------------------------------------------

    def add_ping_result(self, data):
        if "ping_results" not in self._store:
            self._store["ping_results"] = []
        self._store["ping_results"].append(data)
        if len(self._store["ping_results"]) > 10000:
            self._store["ping_results"] = self._store["ping_results"][-10000:]
        self._persist()
        return data

    def list_ping_results(self, agent_id, limit=100):
        self._reload_if_stale()
        pings = [p for p in self._store.get("ping_results", []) if p.get("agent_id") == agent_id]
        pings.sort(key=lambda p: p.get("timestamp", ""), reverse=True)
        return pings[:limit]

    # -- Certifications -----------------------------------------------------

    def add_certification(self, data):
        if "certifications" not in self._store:
            self._store["certifications"] = []
        self._store["certifications"] = [c for c in self._store["certifications"] if c.get("agent_id") != data.get("agent_id")]
        self._store["certifications"].append(data)
        self._persist()
        return data

    def get_certification(self, agent_id):
        self._reload_if_stale()
        for c in self._store.get("certifications", []):
            if c.get("agent_id") == agent_id:
                return c
        return None

    def list_certifications(self):
        self._reload_if_stale()
        return self._store.get("certifications", [])

    # -- Lightning Invoices --------------------------------------------------

    def add_lightning_invoice(self, data):
        if "lightning_invoices" not in self._store:
            self._store["lightning_invoices"] = []
        self._store["lightning_invoices"].append(data)
        self._persist()
        return data

    def get_lightning_invoice(self, operation_id):
        self._reload_if_stale()
        for inv in self._store.get("lightning_invoices", []):
            if inv.get("operation_id") == operation_id:
                return inv
        return None

    def update_lightning_invoice(self, operation_id: str, updates: dict) -> dict | None:
        """Update a lightning invoice record in place."""
        for inv in self._store.get("lightning_invoices", []):
            if inv.get("operation_id") == operation_id:
                inv.update(updates)
                self._persist()
                return inv
        return None


    # -- Security Scans -----------------------------------------------------

    def add_security_scan(self, scan: dict) -> dict:
        """Append a security scan result."""
        self._store.setdefault("security_scans", []).append(scan)
        self._persist()
        return scan

    def get_latest_security_scan(self, agent_id: str) -> dict | None:
        """Return the most recent security scan for an agent."""
        self._reload_if_stale()
        scans = [
            s for s in self._store.get("security_scans", [])
            if s.get("agent_id") == agent_id
        ]
        if not scans:
            return None
        scans.sort(key=lambda s: s.get("scanned_at", ""), reverse=True)
        return scans[0]

    def list_security_scans(self, agent_id: str, limit: int = 10) -> list[dict]:
        """Return recent security scans for an agent."""
        self._reload_if_stale()
        scans = [
            s for s in self._store.get("security_scans", [])
            if s.get("agent_id") == agent_id
        ]
        scans.sort(key=lambda s: s.get("scanned_at", ""), reverse=True)
        return scans[:limit]

    # -- Stripe Payments ----------------------------------------------------

    def add_stripe_payment(self, payment: dict) -> dict:
        """Append a Stripe payment record."""
        self._store.setdefault("stripe_payments", []).append(payment)
        self._persist()
        return payment

    def get_stripe_payment(self, session_id: str) -> dict | None:
        """Find a Stripe payment by session_id."""
        self._reload_if_stale()
        for p in self._store.get("stripe_payments", []):
            if p.get("session_id") == session_id:
                return p
        return None

    def update_stripe_payment(self, session_id: str, updates: dict) -> dict | None:
        """Update a Stripe payment record in place."""
        for p in self._store.get("stripe_payments", []):
            if p.get("session_id") == session_id:
                p.update(updates)
                self._persist()
                return p
        return None

    # -- Provisioned Identities ---------------------------------------------

    def add_provisioned_identity(self, data: dict) -> dict:
        """Append a new provisioned identity record."""
        self._store.setdefault("provisioned_identities", []).append(data)
        self._persist()
        return data

    def get_provisioned_identity(self, agent_id: str) -> dict | None:
        """Find a provisioned identity by agent_id."""
        self._reload_if_stale()
        for p in self._store.get("provisioned_identities", []):
            if p.get("agent_id") == agent_id:
                return p
        return None

    def update_provisioned_identity(self, agent_id: str, updates: dict) -> dict | None:
        """Update a provisioned identity record in place."""
        for p in self._store.get("provisioned_identities", []):
            if p.get("agent_id") == agent_id:
                p.update(updates)
                self._persist()
                return p
        return None

    def list_provisioned_identities(self, claimed: bool = None) -> list[dict]:
        """List all provisioned identities, optionally filtered by claimed status."""
        self._reload_if_stale()
        identities = self._store.get("provisioned_identities", [])
        if claimed is not None:
            identities = [p for p in identities if p.get("claimed") == claimed]
        return identities

    def delete_provisioned_privkey(self, agent_id: str) -> bool:
        """Set encrypted_privkey to None for the agent (after claim handoff)."""
        for p in self._store.get("provisioned_identities", []):
            if p.get("agent_id") == agent_id:
                p["encrypted_privkey"] = None
                self._persist()
                return True
        return False

    # -- Capability Schemas -------------------------------------------------

    def add_capability_schema(self, agent_id: str, schema: dict) -> dict:
        """Store a new capability schema for an agent."""
        self._store.setdefault("capability_schemas", []).append(schema)
        self._persist()
        return schema

    def get_capability_schema(self, agent_id: str) -> dict | None:
        """Get the capability schema for an agent."""
        self._reload_if_stale()
        for s in self._store.get("capability_schemas", []):
            if s.get("agent_id") == agent_id:
                return s
        return None

    def update_capability_schema(self, agent_id: str, schema: dict) -> dict | None:
        """Update an existing capability schema."""
        for i, s in enumerate(self._store.get("capability_schemas", [])):
            if s.get("agent_id") == agent_id:
                self._store["capability_schemas"][i] = schema
                self._persist()
                return schema
        return None

    # -- Invocations --------------------------------------------------------

    def add_invocation(self, data: dict) -> dict:
        """Record an invocation."""
        self._store.setdefault("invocations", []).append(data)
        # Keep the store from growing unbounded
        if len(self._store["invocations"]) > 50000:
            self._store["invocations"] = self._store["invocations"][-50000:]
        self._persist()
        return data

    def get_invocation(self, invocation_id: str) -> dict | None:
        """Find an invocation by ID."""
        self._reload_if_stale()
        for inv in self._store.get("invocations", []):
            if inv.get("invocation_id") == invocation_id:
                return inv
        return None

    def list_invocations(
        self,
        caller_agent_id: str = None,
        target_agent_id: str = None,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list, int]:
        """List invocations with optional filters and pagination."""
        self._reload_if_stale()
        invocations = self._store.get("invocations", [])
        if caller_agent_id:
            invocations = [i for i in invocations if i.get("caller_agent_id") == caller_agent_id]
        if target_agent_id:
            invocations = [i for i in invocations if i.get("target_agent_id") == target_agent_id]
        # Most recent first
        invocations.sort(key=lambda i: i.get("timestamp", ""), reverse=True)
        total = len(invocations)
        return invocations[offset : offset + limit], total

    # -- Budget Controls ----------------------------------------------------

    def set_budget(self, agent_id: str, budget: dict) -> dict:
        """Set or update budget controls for an agent (upsert)."""
        self._store.setdefault("budgets", [])
        for i, b in enumerate(self._store["budgets"]):
            if b.get("agent_id") == agent_id:
                self._store["budgets"][i] = budget
                self._persist()
                return budget
        self._store["budgets"].append(budget)
        self._persist()
        return budget

    def get_budget(self, agent_id: str) -> dict | None:
        """Get budget controls for an agent."""
        self._reload_if_stale()
        for b in self._store.get("budgets", []):
            if b.get("agent_id") == agent_id:
                return b
        return None

    def get_spending(self, agent_id: str, period: str = "day") -> int:
        """Sum of cost_sats for invocations by this agent in the given period."""
        from datetime import datetime, timedelta, timezone
        self._reload_if_stale()
        now = datetime.now(timezone.utc)
        if period == "day":
            cutoff = now - timedelta(days=1)
        elif period == "month":
            cutoff = now - timedelta(days=30)
        else:
            cutoff = now - timedelta(days=1)

        cutoff_iso = cutoff.isoformat()
        total = 0
        for inv in self._store.get("invocations", []):
            if inv.get("caller_agent_id") == agent_id:
                ts = inv.get("timestamp", "")
                if ts >= cutoff_iso:
                    total += inv.get("cost_sats", 0)
        return total

    # -- Wallets ------------------------------------------------------------

    def create_wallet(self, agent_id: str) -> dict:
        """Create a wallet for an agent. Returns existing if already present."""
        self._reload_if_stale()
        wallets = self._store.setdefault("wallets", {})
        if agent_id in wallets:
            return wallets[agent_id]
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc).isoformat()
        wallet = {
            "agent_id": agent_id,
            "balance_sats": 0,
            "total_funded_sats": 0,
            "total_spent_sats": 0,
            "total_earned_sats": 0,
            "created_at": now,
            "updated_at": now,
            "funding_history": [],
            "transaction_history": [],
        }
        wallets[agent_id] = wallet
        self._persist()
        return wallet

    def get_wallet(self, agent_id: str) -> dict | None:
        """Get wallet for an agent."""
        self._reload_if_stale()
        return self._store.get("wallets", {}).get(agent_id)

    def debit_wallet(self, agent_id: str, amount_sats: int, metadata: dict) -> dict:
        """Debit an agent wallet. Raises ValueError if insufficient balance."""
        self._reload_if_stale()
        wallets = self._store.setdefault("wallets", {})
        wallet = wallets.get(agent_id)
        if not wallet:
            raise ValueError(f"No wallet for agent {agent_id}")
        if wallet["balance_sats"] < amount_sats:
            raise ValueError(f"Insufficient balance: {wallet["balance_sats"]} < {amount_sats}")
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc).isoformat()
        wallet["balance_sats"] -= amount_sats
        wallet["total_spent_sats"] += amount_sats
        wallet["updated_at"] = now
        tx = {
            "type": "debit",
            "amount_sats": amount_sats,
            "timestamp": now,
            **metadata,
        }
        wallet["transaction_history"].append(tx)
        # Cap history
        if len(wallet["transaction_history"]) > 10000:
            wallet["transaction_history"] = wallet["transaction_history"][-10000:]
        self._persist()
        return wallet

    def credit_wallet(self, agent_id: str, amount_sats: int, metadata: dict) -> dict:
        """Credit an agent wallet. Auto-creates wallet if needed."""
        self._reload_if_stale()
        wallets = self._store.setdefault("wallets", {})
        if agent_id not in wallets:
            self.create_wallet(agent_id)
        wallet = wallets[agent_id]
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc).isoformat()
        wallet["balance_sats"] += amount_sats
        wallet["total_earned_sats"] += amount_sats
        wallet["updated_at"] = now
        tx = {
            "type": "credit",
            "amount_sats": amount_sats,
            "timestamp": now,
            **metadata,
        }
        wallet["transaction_history"].append(tx)
        if len(wallet["transaction_history"]) > 10000:
            wallet["transaction_history"] = wallet["transaction_history"][-10000:]
        self._persist()
        return wallet

    def fund_wallet(self, agent_id: str, amount_sats: int, funding_event: dict) -> dict:
        """Fund a wallet (from Lightning or Stripe). Different from credit — tracks funding separately."""
        self._reload_if_stale()
        wallets = self._store.setdefault("wallets", {})
        if agent_id not in wallets:
            self.create_wallet(agent_id)
        wallet = wallets[agent_id]
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc).isoformat()
        wallet["balance_sats"] += amount_sats
        wallet["total_funded_sats"] += amount_sats
        wallet["updated_at"] = now
        funding_event["timestamp"] = now
        funding_event["amount_sats"] = amount_sats
        wallet["funding_history"].append(funding_event)
        if len(wallet["funding_history"]) > 5000:
            wallet["funding_history"] = wallet["funding_history"][-5000:]
        # Also add to transaction history
        wallet["transaction_history"].append({
            "type": "funding",
            "amount_sats": amount_sats,
            "source": funding_event.get("source", "unknown"),
            "timestamp": now,
        })
        if len(wallet["transaction_history"]) > 10000:
            wallet["transaction_history"] = wallet["transaction_history"][-10000:]
        self._persist()
        return wallet

    def list_wallet_transactions(self, agent_id: str, limit: int = 50, offset: int = 0) -> list:
        """List wallet transactions for an agent with pagination."""
        self._reload_if_stale()
        wallet = self._store.get("wallets", {}).get(agent_id)
        if not wallet:
            return []
        txs = wallet.get("transaction_history", [])
        # Most recent first
        txs_sorted = sorted(txs, key=lambda t: t.get("timestamp", ""), reverse=True)
        return txs_sorted[offset:offset + limit]

    def record_platform_fee(self, amount_sats: int, invocation_id: str) -> None:
        """Record a platform fee from an invocation."""
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc).isoformat()
        self._store.setdefault("platform_fees", []).append({
            "amount_sats": amount_sats,
            "invocation_id": invocation_id,
            "timestamp": now,
        })
        if len(self._store["platform_fees"]) > 50000:
            self._store["platform_fees"] = self._store["platform_fees"][-50000:]
        self._persist()

    def get_platform_fees(self) -> dict:
        """Get total platform fees collected."""
        self._reload_if_stale()
        fees = self._store.get("platform_fees", [])
        total = sum(f.get("amount_sats", 0) for f in fees)
        return {"total_fees_sats": total, "total_events": len(fees)}

    def get_wallet_stats(self) -> dict:
        """Get platform-wide wallet statistics."""
        self._reload_if_stale()
        wallets = self._store.get("wallets", {})
        total_wallets = len(wallets)
        total_funded = sum(w.get("total_funded_sats", 0) for w in wallets.values())
        total_spent = sum(w.get("total_spent_sats", 0) for w in wallets.values())
        total_earned = sum(w.get("total_earned_sats", 0) for w in wallets.values())
        total_balance = sum(w.get("balance_sats", 0) for w in wallets.values())
        fees = self.get_platform_fees()
        return {
            "total_wallets": total_wallets,
            "total_funded_sats": total_funded,
            "total_spent_sats": total_spent,
            "total_earned_sats": total_earned,
            "total_balance_sats": total_balance,
            "platform_fees": fees,
        }

"""Regression test: store writes must not stall in-flight card fetches.

Simulates the production failure: each store persist blocks the event loop
for BLOCK_S seconds, card fetches take FETCH_S seconds, and httpx-style
timeouts are TIMEOUT_S. The old per-agent-persist cycle produced timeouts
(cards "stopped resolving"); the two-phase cycle must resolve every card.
"""
import asyncio, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import registry_engine as re_
from models import AgentCardSnapshot, TrustSignals
from crawler import parse_agent_card

BLOCK_S, FETCH_S, TIMEOUT_S, N = 0.4, 0.2, 1.0, 30
CARD = {"name": "x", "url": "https://x.test/a2a", "version": "1", "protocolVersion": "0.3.0",
        "provider": {"organization": "x"}, "skills": [{"id": "s", "name": "s"}]}


class FakeStore:
    def __init__(self, prev_resolving=True):
        self.agents = [{"id": f"a{i}", "url": f"https://agent{i}.example.org"} for i in range(N)]
        self.reports = []
        if prev_resolving:
            sig = TrustSignals(card_resolves=True, card_schema_valid=True, has_skills=True,
                               uptime_checks_passed=5, uptime_checks_total=5)
            self.reports = [{"agent_id": a["id"], "signals": sig.model_dump(mode="json"),
                             "computed_at": "2026-01-01"} for a in self.agents]
        self.snaps, self.persists = [], 0
    def _block(self):
        self.persists += 1; time.sleep(BLOCK_S)   # synchronous, like json.dump of a big store
    def list_agents(self, limit, offset): return self.agents, len(self.agents)
    # old API
    def get_latest_snapshot(self, aid): return None
    def get_trust_report(self, aid):
        r = [x for x in self.reports if x["agent_id"] == aid]; return r[-1] if r else None
    def add_card_snapshot(self, s): self.snaps.append(s); self._block()
    def add_trust_report(self, r): self.reports.append(r); self._block()
    def update_agent_trust(self, aid, d):
        next(a for a in self.agents if a["id"] == aid).update(d); self._block()
    # new API
    def latest_snapshots_by_agent(self): return {}
    def latest_trust_reports_by_agent(self): return {r["agent_id"]: r for r in self.reports}
    def apply_discovery_batch(self, agent_updates, snapshots, reports):
        for a in self.agents: a.update(agent_updates.get(a["id"], {}))
        self.snaps += snapshots; self.reports += reports; self._block()


async def fake_discover(domain, timeout=None):
    # A fetch is several awaited stages (DNS, TCP, TLS, request, body).
    # Remote servers and proxies enforce wall-clock deadlines (handshake /
    # idle timeouts), so if the event loop is blocked between stages past the
    # deadline, the fetch fails even though the server answers in <1s.
    start = time.monotonic()
    for _ in range(4):
        await asyncio.sleep(FETCH_S / 4)
        if time.monotonic() - start > TIMEOUT_S:
            return None
    return AgentCardSnapshot(agent_id="", raw_json=CARD, card=parse_agent_card(CARD),
                             url_source=f"https://{domain}/.well-known/agent-card.json",
                             http_status=200, response_time_ms=(time.monotonic() - start) * 1000)

async def fake_probe(base, card): return None

re_.discover_agent_card = fake_discover
re_.probe_a2a_endpoint = fake_probe
re_.probe_mcp_endpoint = fake_probe


def test_two_phase_cycle_resolves_all_cards():
    store = FakeStore()
    t = time.monotonic()
    stats = asyncio.run(re_.run_discovery_cycle(store))
    elapsed = time.monotonic() - t
    assert stats["cards_found"] == N, stats
    assert store.persists == 1
    assert all(a["trust_tier"] != "suspicious" for a in store.agents)
    print(f"new cycle: {stats['cards_found']}/{N} cards, {store.persists} persist, {elapsed:.1f}s")


def test_single_transient_miss_does_not_flip_to_suspicious():
    store = FakeStore()
    async def miss(domain, timeout=None): return None
    re_.discover_agent_card = miss
    try:
        asyncio.run(re_.run_discovery_cycle(store))
        assert all(a["trust_tier"] != "suspicious" for a in store.agents)
        asyncio.run(re_.run_discovery_cycle(store))
        asyncio.run(re_.run_discovery_cycle(store))  # third consecutive miss
        assert all(a["trust_tier"] == "suspicious" for a in store.agents)
    finally:
        re_.discover_agent_card = fake_discover


if __name__ == "__main__":
    test_two_phase_cycle_resolves_all_cards()
    test_single_transient_miss_does_not_flip_to_suspicious()
    print("ok")

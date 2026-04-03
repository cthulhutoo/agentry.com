"""Discovery source fetchers for new A2A agents.

Each source function returns a list of DiscoveredAgent dicts with at minimum:
    - domain: str (e.g. "example.com")
    - name: str (agent or company name)
    - url: str (website URL)
    - source: str (where we found it)
    - description: str (optional)
    - category: str (optional, best guess)
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx

logger = logging.getLogger(__name__)

GITHUB_HEADERS = {
    "User-Agent": "Agentry-Discovery/1.0",
    "Accept": "application/vnd.github.v3+json",
}

TIMEOUT = httpx.Timeout(20.0)

# Domains that are NOT agents — CDNs, docs, badge services, etc.
BLOCKED_DOMAINS = {
    "fonts.googleapis.com", "awesome.re", "img.shields.io",
    "raw.githubusercontent.com", "jsonrpc.org", "google.github.io",
    "a2aproject.github.io", "microsoft.github.io", "docs.crewai.com",
    "docs.retool.com", "developers.googleblog.com", "goo.gle",
    "nuget.org", "commune.autonomous-commune.ai", "cdn.jsdelivr.net",
    "fonts.gstatic.com", "unpkg.com", "cdnjs.cloudflare.com",
    "shields.io", "badge.fury.io", "readthedocs.io",
    "docs.python.org", "docs.oracle.com", "docs.microsoft.com",
    "learn.microsoft.com", "spec.openapis.org", "swagger.io",
    "json-schema.org", "w3.org", "ietf.org", "rfc-editor.org",
    "creativecommons.org", "opensource.org", "choosealicense.com",
    "camo.githubusercontent.com", "user-images.githubusercontent.com",
}



# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _extract_domain(url: str) -> str | None:
    """Extract domain from a URL."""
    try:
        parsed = urlparse(url if "://" in url else f"https://{url}")
        host = parsed.hostname
        return host.lstrip("www.") if host else None
    except Exception:
        return None


def _normalize_url(url: str) -> str:
    """Ensure URL has https:// prefix."""
    if not url.startswith("http"):
        return f"https://{url}"
    return url


# ---------------------------------------------------------------------------
# Source 1: a2aregistry.org — official community registry
# ---------------------------------------------------------------------------

async def fetch_a2a_registry(client: httpx.AsyncClient) -> list[dict[str, Any]]:
    """Fetch agents from a2aregistry.org.
    
    They use a GitHub-as-database model, so we try:
    1. Their API endpoint if available
    2. Scrape the homepage for agent listings
    3. Fall back to their GitHub repo
    """
    agents: list[dict[str, Any]] = []
    source = "a2aregistry.org"

    # Try the main page for agent data
    try:
        resp = await client.get("https://a2aregistry.org", follow_redirects=True)
        if resp.status_code == 200:
            text = resp.text
            # Look for JSON data embedded in the page or structured agent entries
            # Try to find agent URLs / domains in the page content
            # Pattern: links to agent endpoints or .well-known URLs
            urls = re.findall(
                r'https?://[a-zA-Z0-9\-\.]+\.[a-zA-Z]{2,}/\.well-known/agent(?:-card)?\.json',
                text,
            )
            for url in set(urls):
                domain = _extract_domain(url)
                if domain:
                    agents.append({
                        "domain": domain,
                        "name": domain.split(".")[0].title(),
                        "url": f"https://{domain}",
                        "source": source,
                        "description": "Found via a2aregistry.org",
                        "category": "Uncategorized",
                        "card_url": url,
                    })

            # Also look for agent names and URLs in structured data
            # Pattern: domain names or URLs on the page
            domain_pattern = re.findall(
                r'href=["\']https?://([a-zA-Z0-9\-\.]+\.[a-zA-Z]{2,})[/"\']',
                text,
            )
            for domain in set(domain_pattern):
                domain = domain.lstrip("www.")
                # Skip common non-agent domains
                skip = {"github.com", "twitter.com", "x.com", "linkedin.com",
                        "a2aregistry.org", "google.com", "googleapis.com",
                        "pypi.org", "npmjs.com", "a2a-protocol.org"}
                if domain not in skip and domain not in {a["domain"] for a in agents}:
                    agents.append({
                        "domain": domain,
                        "name": domain.split(".")[0].title(),
                        "url": f"https://{domain}",
                        "source": source,
                        "description": "Listed on a2aregistry.org",
                        "category": "Uncategorized",
                    })

    except Exception as exc:
        logger.warning("Failed to fetch a2aregistry.org: %s", exc)

    # Also try their GitHub repo for raw agent data
    try:
        resp = await client.get(
            "https://api.github.com/repos/a2aregistry/a2aregistry.org/contents/agents",
            headers=GITHUB_HEADERS,
        )
        if resp.status_code == 200:
            files = resp.json()
            for f in files:
                if f.get("name", "").endswith(".json"):
                    try:
                        file_resp = await client.get(f["download_url"], headers=GITHUB_HEADERS)
                        if file_resp.status_code == 200:
                            data = file_resp.json()
                            url = data.get("url", "")
                            domain = _extract_domain(url)
                            if domain and domain not in {a["domain"] for a in agents}:
                                agents.append({
                                    "domain": domain,
                                    "name": data.get("name", domain),
                                    "url": _normalize_url(url),
                                    "source": source,
                                    "description": data.get("description", ""),
                                    "category": "Uncategorized",
                                })
                    except Exception:
                        continue
    except Exception as exc:
        logger.debug("a2aregistry GitHub repo fetch failed: %s", exc)

    logger.info("a2aregistry.org: found %d potential agents", len(agents))
    return agents


# ---------------------------------------------------------------------------
# Source 2: awesome-a2a GitHub lists
# ---------------------------------------------------------------------------

AWESOME_REPOS = [
    "pab1it0/awesome-a2a",
    "forgewebO1/Awesome-A2A",
    "nMaroulis/awesome-a2a-libraries",
]


async def fetch_awesome_a2a(client: httpx.AsyncClient) -> list[dict[str, Any]]:
    """Parse awesome-a2a style GitHub READMEs for agent URLs."""
    agents: list[dict[str, Any]] = []
    seen_domains: set[str] = set()

    for repo in AWESOME_REPOS:
        try:
            resp = await client.get(
                f"https://raw.githubusercontent.com/{repo}/main/README.md",
                headers=GITHUB_HEADERS,
                follow_redirects=True,
            )
            if resp.status_code != 200:
                # Try master branch
                resp = await client.get(
                    f"https://raw.githubusercontent.com/{repo}/master/README.md",
                    headers=GITHUB_HEADERS,
                    follow_redirects=True,
                )
            if resp.status_code != 200:
                continue

            readme = resp.text
            # Extract markdown links: [Name](URL)
            links = re.findall(r'\[([^\]]+)\]\((https?://[^\)]+)\)', readme)
            for name, url in links:
                domain = _extract_domain(url)
                if not domain:
                    continue

                # Skip GitHub, docs, and other non-agent URLs
                skip_domains = {
                    "github.com", "gitlab.com", "twitter.com", "x.com",
                    "linkedin.com", "youtube.com", "medium.com", "dev.to",
                    "reddit.com", "docs.google.com", "pypi.org", "npmjs.com",
                    "arxiv.org", "wikipedia.org", "stackoverflow.com",
                }
                if domain in skip_domains:
                    # But DO capture if it's a GitHub repo with a live agent URL in the name
                    if domain == "github.com" and "/tree/" not in url:
                        # Store GitHub repos separately — we can scan their READMEs later
                        continue
                    continue

                if domain in seen_domains:
                    continue
                seen_domains.add(domain)

                agents.append({
                    "domain": domain,
                    "name": name.strip() if len(name.strip()) < 80 else domain.split(".")[0].title(),
                    "url": _normalize_url(url),
                    "source": f"github:{repo}",
                    "description": f"Listed in {repo}",
                    "category": "Uncategorized",
                })

        except Exception as exc:
            logger.warning("Failed to fetch %s: %s", repo, exc)

    logger.info("awesome-a2a repos: found %d potential agents", len(agents))
    return agents


# ---------------------------------------------------------------------------
# Source 3: GitHub code search for .well-known/agent.json implementations
# ---------------------------------------------------------------------------

async def fetch_github_a2a_repos(client: httpx.AsyncClient) -> list[dict[str, Any]]:
    """Search GitHub for repos implementing A2A agent cards.
    
    We search for repos that reference .well-known/agent.json to find
    companies actively building A2A-compatible agents.
    """
    agents: list[dict[str, Any]] = []
    seen_domains: set[str] = set()
    source = "github-search"

    search_queries = [
        "well-known agent.json a2a",
        "agent-card.json a2a protocol",
        "AgentCard a2a server",
    ]

    for query in search_queries:
        try:
            resp = await client.get(
                "https://api.github.com/search/repositories",
                params={
                    "q": query,
                    "sort": "updated",
                    "order": "desc",
                    "per_page": 30,
                },
                headers=GITHUB_HEADERS,
            )
            if resp.status_code != 200:
                logger.debug("GitHub search failed for '%s': HTTP %d", query, resp.status_code)
                continue

            results = resp.json()
            for repo in results.get("items", []):
                # Try to find the homepage URL
                homepage = repo.get("homepage", "")
                if homepage:
                    domain = _extract_domain(homepage)
                    if domain and domain not in seen_domains:
                        skip = {"github.io", "githubusercontent.com", "vercel.app",
                                "netlify.app", "herokuapp.com", "readthedocs.io"}
                        if not any(domain.endswith(s) for s in skip):
                            seen_domains.add(domain)
                            agents.append({
                                "domain": domain,
                                "name": repo.get("name", domain).replace("-", " ").replace("_", " ").title(),
                                "url": _normalize_url(homepage),
                                "source": source,
                                "description": repo.get("description", "")[:200],
                                "category": "Uncategorized",
                                "github_repo": repo.get("full_name"),
                                "github_stars": repo.get("stargazers_count", 0),
                            })

        except Exception as exc:
            logger.warning("GitHub search failed for '%s': %s", query, exc)

        # Rate limiting: small delay between searches
        await asyncio.sleep(1)

    logger.info("GitHub search: found %d potential agents", len(agents))
    return agents


# ---------------------------------------------------------------------------
# Source 4: Official A2A project samples and ecosystem
# ---------------------------------------------------------------------------

async def fetch_a2a_project_ecosystem(client: httpx.AsyncClient) -> list[dict[str, Any]]:
    """Check the official a2aproject GitHub org for sample agents with live URLs."""
    agents: list[dict[str, Any]] = []
    seen_domains: set[str] = set()
    source = "a2aproject-official"

    try:
        # Get repos from the a2aproject org
        resp = await client.get(
            "https://api.github.com/orgs/a2aproject/repos",
            params={"per_page": 50, "sort": "updated"},
            headers=GITHUB_HEADERS,
        )
        if resp.status_code == 200:
            repos = resp.json()
            for repo in repos:
                homepage = repo.get("homepage", "")
                if homepage:
                    domain = _extract_domain(homepage)
                    if domain and domain not in seen_domains:
                        seen_domains.add(domain)
                        agents.append({
                            "domain": domain,
                            "name": repo.get("name", "").replace("-", " ").title(),
                            "url": _normalize_url(homepage),
                            "source": source,
                            "description": repo.get("description", "")[:200],
                            "category": "Uncategorized",
                        })
    except Exception as exc:
        logger.warning("a2aproject org fetch failed: %s", exc)

    logger.info("a2aproject ecosystem: found %d potential agents", len(agents))
    return agents


# ---------------------------------------------------------------------------
# Source 5: Seed domains list (domains.txt on disk)
# ---------------------------------------------------------------------------

async def fetch_seed_domains(domains_file: str = "/opt/agentry/domains.txt") -> list[dict[str, Any]]:
    """Load the static domains.txt seed list."""
    agents: list[dict[str, Any]] = []
    path = Path(domains_file)

    if not path.exists():
        logger.warning("Seed domains file not found: %s", domains_file)
        return agents

    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        domain = _extract_domain(line) or line
        agents.append({
            "domain": domain,
            "name": domain.split(".")[0].title(),
            "url": f"https://{domain}",
            "source": "seed-domains",
            "description": "From seed domains list",
            "category": "Uncategorized",
        })

    logger.info("Seed domains: loaded %d domains", len(agents))
    return agents


# ---------------------------------------------------------------------------
# Source 6: A2A protocol partner companies (from the announcement)
# ---------------------------------------------------------------------------

A2A_PARTNERS = [
    # Original 50+ launch partners from Google's announcement
    ("Atlassian", "atlassian.com"),
    ("Box", "box.com"),
    ("Cohere", "cohere.com"),
    ("Intuit", "intuit.com"),
    ("LangChain", "langchain.com"),
    ("MongoDB", "mongodb.com"),
    ("PayPal", "paypal.com"),
    ("Salesforce", "salesforce.com"),
    ("SAP", "sap.com"),
    ("ServiceNow", "servicenow.com"),
    ("UKG", "ukg.com"),
    ("Workday", "workday.com"),
    # Major AI agent companies
    ("CrewAI", "crewai.com"),
    ("AutoGen", "microsoft.github.io/autogen"),
    ("Adept AI", "adept.ai"),
    ("Sierra", "sierra.ai"),
    ("Fixie AI", "fixie.ai"),
    ("Anthropic", "anthropic.com"),
    ("OpenAI", "openai.com"),
    ("Mistral", "mistral.ai"),
    ("Cohere", "cohere.com"),
    ("AI21", "ai21.com"),
    # Agent platforms
    ("Relevance AI", "relevanceai.com"),
    ("Voiceflow", "voiceflow.com"),
    ("Botpress", "botpress.com"),
    ("Rasa", "rasa.com"),
    ("Cognigy", "cognigy.com"),
    ("Yellow.ai", "yellow.ai"),
    ("Kore.ai", "kore.ai"),
    ("Moveworks", "moveworks.com"),
    ("Observe.ai", "observe.ai"),
    ("Assembled", "assembled.com"),
    ("Haptik", "haptik.ai"),
    # Developer tools with agent support
    ("Vercel", "vercel.com"),
    ("Replit", "replit.com"),
    ("Cloudflare", "cloudflare.com"),
    ("Supabase", "supabase.com"),
    ("Neon", "neon.tech"),
]


async def fetch_a2a_partners() -> list[dict[str, Any]]:
    """Return known A2A protocol partners to scan."""
    agents = []
    seen: set[str] = set()
    for name, domain in A2A_PARTNERS:
        d = _extract_domain(domain) or domain
        if d not in seen:
            seen.add(d)
            agents.append({
                "domain": d,
                "name": name,
                "url": f"https://{domain}",
                "source": "a2a-partners",
                "description": "A2A protocol partner",
                "category": "Uncategorized",
            })
    logger.info("A2A partners: %d domains", len(agents))
    return agents


# ---------------------------------------------------------------------------
# Master fetcher — runs all sources
# ---------------------------------------------------------------------------

async def fetch_all_sources() -> list[dict[str, Any]]:
    """Run all discovery sources and return deduplicated results."""
    async with httpx.AsyncClient(timeout=TIMEOUT, http2=True) as client:
        results = await asyncio.gather(
            fetch_a2a_registry(client),
            fetch_awesome_a2a(client),
            fetch_github_a2a_repos(client),
            fetch_a2a_project_ecosystem(client),
            fetch_seed_domains(),
            fetch_a2a_partners(),
            return_exceptions=True,
        )

    all_agents: list[dict[str, Any]] = []
    for result in results:
        if isinstance(result, list):
            all_agents.extend(result)
        elif isinstance(result, Exception):
            logger.error("Source fetch failed: %s", result)

    # Deduplicate by domain, filtering blocked domains
    seen: dict[str, dict[str, Any]] = {}
    for agent in all_agents:
        domain = agent.get("domain", "")
        if not domain:
            continue
        # Skip known non-agent domains
        if domain in BLOCKED_DOMAINS or any(domain.endswith(b) for b in {".githubusercontent.com", ".github.io", ".readthedocs.io"}):
            continue
        # Keep the first (typically higher-quality) entry per domain
        if domain not in seen:
            seen[domain] = agent
        else:
            # Merge: prefer entries with card_url or github info
            existing = seen[domain]
            if agent.get("card_url") and not existing.get("card_url"):
                existing["card_url"] = agent["card_url"]
            if agent.get("github_repo") and not existing.get("github_repo"):
                existing["github_repo"] = agent["github_repo"]
            # Prefer more descriptive names
            if len(agent.get("name", "")) > len(existing.get("name", "")):
                existing["name"] = agent["name"]
            # Aggregate sources
            existing_source = existing.get("source", "")
            new_source = agent.get("source", "")
            if new_source and new_source not in existing_source:
                existing["source"] = f"{existing_source}, {new_source}"

    deduped = list(seen.values())
    logger.info(
        "Discovery sources: %d total candidates, %d after dedup",
        len(all_agents),
        len(deduped),
    )
    return deduped

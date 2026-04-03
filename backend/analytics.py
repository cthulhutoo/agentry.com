"""Agent traffic analytics — track who's hitting the discovery endpoints.

Logs every request to discovery endpoints (/llms.txt, /.well-known/agents.json,
/api/agents/public, /api/agents/search) with User-Agent classification.

Known AI agent User-Agents are tagged so you can see machine vs. human traffic.
"""

from __future__ import annotations

import json
import logging
import re
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Request, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin/analytics", tags=["analytics"])

_DATA_DIR = Path(__file__).resolve().parent
_LOG_PATH = _DATA_DIR / "request_log.jsonl"

# Max log entries to keep (rolling window)
_MAX_ENTRIES = 50000

# --- Known AI agent / bot patterns ---
AI_AGENT_PATTERNS = [
    # LLM providers & assistants
    (r"ChatGPT|GPTBot", "OpenAI"),
    (r"Claude|ClaudeBot|Anthropic", "Anthropic/Claude"),
    (r"Google-Extended|Gemini|GoogleOther", "Google/Gemini"),
    (r"Perplexity|PerplexityBot", "Perplexity"),
    (r"Cohere", "Cohere"),
    (r"Meta-ExternalAgent|FacebookBot", "Meta"),
    
    # AI coding tools
    (r"Cursor|CursorBot", "Cursor"),
    (r"Copilot|GitHub Copilot", "GitHub Copilot"),
    (r"Windsurf|Codeium", "Windsurf/Codeium"),
    (r"Replit", "Replit"),
    
    # MCP clients
    (r"mcp-client|MCP", "MCP Client"),
    (r"modelcontextprotocol", "MCP Registry"),
    
    # Agent frameworks
    (r"LangChain|LangGraph", "LangChain"),
    (r"CrewAI", "CrewAI"),
    (r"AutoGen", "AutoGen"),
    (r"OpenHands|OpenDevin", "OpenHands"),
    (r"Semantic Kernel", "Microsoft Semantic Kernel"),
    
    # Agentic platforms
    (r"AWS Bedrock|Amazon Bedrock", "AWS Bedrock"),
    (r"Azure AI|Microsoft AI", "Azure AI"),
    
    # General bot patterns
    (r"bot|crawler|spider|scraper|fetch|curl|wget|httpx|aiohttp|python-requests|Go-http-client|axios|node-fetch", "Bot/Automated"),
]

# Discovery endpoints to track
DISCOVERY_PATHS = {
    "/llms.txt",
    "/.well-known/agents.json",
    "/.well-known/mcp-registry-auth",
    "/api/agents/public",
    "/api/agents/search",
    "/api/agents/categories",
}


def classify_user_agent(ua: str) -> dict[str, Any]:
    """Classify a User-Agent string."""
    if not ua:
        return {"type": "unknown", "agent": "No User-Agent"}
    
    ua_lower = ua.lower()
    
    for pattern, name in AI_AGENT_PATTERNS:
        if re.search(pattern, ua, re.IGNORECASE):
            agent_type = "ai_agent" if name not in ("Bot/Automated",) else "bot"
            return {"type": agent_type, "agent": name}
    
    # Browser detection
    if any(b in ua_lower for b in ["mozilla", "chrome", "safari", "firefox", "edge"]):
        return {"type": "browser", "agent": "Human Browser"}
    
    return {"type": "other", "agent": ua[:80]}


def _is_discovery_path(path: str) -> bool:
    """Check if a path is a discovery endpoint."""
    for dp in DISCOVERY_PATHS:
        if path.startswith(dp):
            return True
    return False


def log_request(entry: dict[str, Any]) -> None:
    """Append a request log entry to the JSONL file."""
    try:
        with open(_LOG_PATH, "a") as f:
            f.write(json.dumps(entry, default=str) + "\n")
    except OSError:
        logger.exception("Failed to write request log")


def _read_logs(since_hours: int = 24, path_filter: str | None = None) -> list[dict]:
    """Read log entries from the JSONL file."""
    if not _LOG_PATH.exists():
        return []
    
    cutoff = (datetime.utcnow() - timedelta(hours=since_hours)).isoformat()
    entries = []
    
    try:
        with open(_LOG_PATH) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    entry = json.loads(line)
                    if entry.get("timestamp", "") >= cutoff:
                        if path_filter is None or entry.get("path", "").startswith(path_filter):
                            entries.append(entry)
                except json.JSONDecodeError:
                    continue
    except OSError:
        logger.exception("Failed to read request log")
    
    return entries


def _trim_log() -> None:
    """Trim log file to max entries."""
    if not _LOG_PATH.exists():
        return
    try:
        with open(_LOG_PATH) as f:
            lines = f.readlines()
        if len(lines) > _MAX_ENTRIES:
            with open(_LOG_PATH, "w") as f:
                f.writelines(lines[-_MAX_ENTRIES:])
    except OSError:
        pass


# --- Middleware ---

class AnalyticsMiddleware(BaseHTTPMiddleware):
    """Middleware that logs requests to discovery endpoints."""
    
    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        
        # Only log discovery and API endpoints
        should_log = _is_discovery_path(path) or path.startswith("/api/agents")
        
        start_time = time.time()
        response = await call_next(request)
        duration_ms = round((time.time() - start_time) * 1000, 1)
        
        if should_log:
            ua = request.headers.get("user-agent", "")
            classification = classify_user_agent(ua)
            
            # Get client IP
            forwarded = request.headers.get("X-Forwarded-For", "")
            ip = forwarded.split(",")[0].strip() if forwarded else (
                request.headers.get("X-Real-IP", "") or 
                (request.client.host if request.client else "")
            )
            
            entry = {
                "timestamp": datetime.utcnow().isoformat(),
                "path": path,
                "method": request.method,
                "status": response.status_code,
                "ip": ip,
                "user_agent": ua[:200],
                "classification": classification["type"],
                "agent_name": classification["agent"],
                "query": str(request.query_params) if request.query_params else None,
                "duration_ms": duration_ms,
                "referer": request.headers.get("referer", ""),
                "is_discovery": _is_discovery_path(path),
            }
            log_request(entry)
        
        return response


# --- Admin API endpoints ---

def _require_admin(request: Request):
    """Check admin key."""
    admin_key = request.headers.get("X-Admin-Key", "")
    if admin_key != "agentry-admin-2026":
        raise HTTPException(status_code=403, detail="Admin key required")


@router.get("/summary")
async def analytics_summary(
    request: Request,
    hours: int = Query(default=24, ge=1, le=720, description="Hours to look back"),
    _admin=Depends(_require_admin),
) -> JSONResponse:
    """Get a summary of traffic to discovery endpoints."""
    entries = _read_logs(since_hours=hours)
    
    if not entries:
        return JSONResponse(content={
            "period_hours": hours,
            "total_requests": 0,
            "message": "No traffic logged yet"
        })
    
    # Aggregate stats
    by_classification = {}
    by_agent = {}
    by_path = {}
    by_hour = {}
    discovery_count = 0
    ai_agent_requests = []
    
    for e in entries:
        cls = e.get("classification", "unknown")
        by_classification[cls] = by_classification.get(cls, 0) + 1
        
        agent = e.get("agent_name", "Unknown")
        by_agent[agent] = by_agent.get(agent, 0) + 1
        
        path = e.get("path", "")
        by_path[path] = by_path.get(path, 0) + 1
        
        hour = e.get("timestamp", "")[:13]
        by_hour[hour] = by_hour.get(hour, 0) + 1
        
        if e.get("is_discovery"):
            discovery_count += 1
        
        if cls == "ai_agent":
            ai_agent_requests.append({
                "time": e.get("timestamp"),
                "agent": agent,
                "path": path,
                "query": e.get("query"),
                "ip": e.get("ip"),
            })
    
    return JSONResponse(content={
        "period_hours": hours,
        "total_requests": len(entries),
        "discovery_requests": discovery_count,
        "by_visitor_type": dict(sorted(by_classification.items(), key=lambda x: -x[1])),
        "by_agent": dict(sorted(by_agent.items(), key=lambda x: -x[1])),
        "by_endpoint": dict(sorted(by_path.items(), key=lambda x: -x[1])),
        "by_hour": dict(sorted(by_hour.items())),
        "ai_agent_requests": ai_agent_requests[-50:],  # Last 50 AI agent hits
    })


@router.get("/recent")
async def analytics_recent(
    request: Request,
    limit: int = Query(default=50, ge=1, le=500),
    type: str | None = Query(default=None, description="Filter: ai_agent, bot, browser, other"),
    _admin=Depends(_require_admin),
) -> JSONResponse:
    """Get recent request log entries."""
    entries = _read_logs(since_hours=168)  # Last 7 days
    
    if type:
        entries = [e for e in entries if e.get("classification") == type]
    
    # Most recent first
    entries.sort(key=lambda e: e.get("timestamp", ""), reverse=True)
    
    return JSONResponse(content={
        "total": len(entries),
        "entries": entries[:limit],
    })


@router.post("/trim")
async def analytics_trim(
    request: Request,
    _admin=Depends(_require_admin),
) -> JSONResponse:
    """Trim the log file to keep only recent entries."""
    _trim_log()
    return JSONResponse(content={"status": "ok"})

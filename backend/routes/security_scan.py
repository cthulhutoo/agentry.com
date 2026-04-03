"""Security Scanning — endpoint security assessment for registered agents.

Checks TLS certificates, security headers, response integrity, CORS
configuration, and server information leakage. Produces a 0-10 security
score with risk classification.
"""

from __future__ import annotations

import logging
import socket
import ssl
import uuid
from datetime import datetime, timezone
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/security", tags=["security"])


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class SecurityScanResult(BaseModel):
    """Full security scan report for an agent endpoint."""
    scan_id: str
    agent_id: str
    url: str
    score: float = Field(..., ge=0.0, le=10.0, description="Security score 0-10")
    risk_level: str = Field(..., description="Critical, High, Moderate, or Low Risk")
    tls: dict[str, Any] = Field(default_factory=dict)
    headers: dict[str, Any] = Field(default_factory=dict)
    endpoint: dict[str, Any] = Field(default_factory=dict)
    cors: dict[str, Any] = Field(default_factory=dict)
    server_info: dict[str, Any] = Field(default_factory=dict)
    scanned_at: str = ""


class SecurityScoreResponse(BaseModel):
    """Lightweight score-only response."""
    agent_id: str
    score: float
    risk_level: str
    scanned_at: str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_store(request: Request):
    return request.app.state.store


def _risk_level(score: float) -> str:
    if score >= 8.0:
        return "Low Risk"
    elif score >= 5.0:
        return "Moderate"
    elif score >= 2.0:
        return "High"
    else:
        return "Critical"


def _check_tls(hostname: str, port: int = 443) -> dict[str, Any]:
    """Check TLS certificate validity and expiration."""
    result: dict[str, Any] = {
        "valid": False,
        "expiry": None,
        "days_remaining": None,
        "issuer": None,
        "protocol": None,
        "error": None,
    }
    try:
        ctx = ssl.create_default_context()
        with socket.create_connection((hostname, port), timeout=10) as sock:
            with ctx.wrap_socket(sock, server_hostname=hostname) as ssock:
                cert = ssock.getpeercert()
                protocol = ssock.version()
                result["protocol"] = protocol

                if cert:
                    not_after = cert.get("notAfter", "")
                    if not_after:
                        expiry_dt = datetime.strptime(not_after, "%b %d %H:%M:%S %Y %Z").replace(tzinfo=timezone.utc)
                        now = datetime.now(timezone.utc)
                        days_remaining = (expiry_dt - now).days
                        result["expiry"] = expiry_dt.isoformat()
                        result["days_remaining"] = days_remaining
                        result["valid"] = days_remaining > 0

                    issuer = cert.get("issuer", ())
                    issuer_parts = []
                    for rdn in issuer:
                        for attr_type, attr_value in rdn:
                            if attr_type == "organizationName":
                                issuer_parts.append(attr_value)
                    result["issuer"] = ", ".join(issuer_parts) if issuer_parts else "Unknown"
    except Exception as exc:
        result["error"] = str(exc)
    return result


EXPECTED_HEADERS = {
    "strict-transport-security": "HSTS",
    "x-content-type-options": "X-Content-Type-Options",
    "x-frame-options": "X-Frame-Options",
    "content-security-policy": "CSP",
    "x-xss-protection": "X-XSS-Protection",
    "referrer-policy": "Referrer-Policy",
}


async def _check_endpoint(url: str) -> dict[str, Any]:
    """Check endpoint accessibility, headers, CORS, server info, and JSON validity."""
    endpoint_info: dict[str, Any] = {
        "accessible": False,
        "status_code": None,
        "response_time_ms": None,
        "valid_json": False,
        "error": None,
    }
    header_info: dict[str, Any] = {"present": [], "missing": [], "details": {}}
    cors_info: dict[str, Any] = {"has_cors": False, "wildcard": False, "origin": None}
    server_info: dict[str, Any] = {"header": None, "leaks_version": False}

    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=True, verify=True) as client:
            start = datetime.now(timezone.utc)
            resp = await client.get(url, headers={"Origin": "https://example.com"})
            elapsed_ms = (datetime.now(timezone.utc) - start).total_seconds() * 1000

            endpoint_info["status_code"] = resp.status_code
            endpoint_info["response_time_ms"] = round(elapsed_ms, 1)
            endpoint_info["accessible"] = resp.status_code < 500

            # Check JSON validity
            try:
                resp.json()
                endpoint_info["valid_json"] = True
            except Exception:
                endpoint_info["valid_json"] = False

            # Security headers
            resp_headers = {k.lower(): v for k, v in resp.headers.items()}
            for header_key, header_name in EXPECTED_HEADERS.items():
                if header_key in resp_headers:
                    header_info["present"].append(header_name)
                    header_info["details"][header_name] = resp_headers[header_key]
                else:
                    header_info["missing"].append(header_name)

            # CORS
            acao = resp_headers.get("access-control-allow-origin")
            if acao:
                cors_info["has_cors"] = True
                cors_info["origin"] = acao
                cors_info["wildcard"] = acao.strip() == "*"

            # Server header
            server_hdr = resp_headers.get("server", "")
            if server_hdr:
                server_info["header"] = server_hdr
                # Version leak heuristic: contains digits with dots (e.g., nginx/1.24.0)
                import re
                server_info["leaks_version"] = bool(re.search(r"\d+\.\d+", server_hdr))

    except Exception as exc:
        endpoint_info["error"] = str(exc)

    return {
        "endpoint": endpoint_info,
        "headers": header_info,
        "cors": cors_info,
        "server_info": server_info,
    }


def _compute_score(tls: dict, endpoint: dict, headers: dict, cors: dict, server_info: dict) -> float:
    """Compute a 0-10 security score from scan results."""
    score = 0.0

    # TLS: up to 3.0 points
    if tls.get("valid"):
        score += 2.0
        days = tls.get("days_remaining", 0) or 0
        if days > 30:
            score += 1.0
        elif days > 7:
            score += 0.5

    # Endpoint accessibility: up to 1.5 points
    if endpoint.get("accessible"):
        score += 1.0
    if endpoint.get("valid_json"):
        score += 0.5

    # Security headers: up to 3.0 points (0.5 each for 6 headers)
    present_count = len(headers.get("present", []))
    score += min(3.0, present_count * 0.5)

    # CORS: up to 1.0 point
    if cors.get("has_cors"):
        if not cors.get("wildcard"):
            score += 1.0
        else:
            score += 0.5  # wildcard is a warning, partial credit

    # Server info: up to 1.5 points
    if not server_info.get("header"):
        score += 1.5  # no server header = best
    elif not server_info.get("leaks_version"):
        score += 1.0  # header present but no version leak
    else:
        score += 0.0  # version leaked

    return round(min(10.0, max(0.0, score)), 1)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.post("/scan/{agent_id}", response_model=SecurityScanResult, tags=["security"])
async def run_security_scan(request: Request, agent_id: str):
    """Run a comprehensive security scan on an agent's URL.

    Checks TLS certificate, security headers, endpoint accessibility,
    JSON response validity, server version leakage, and CORS config.
    Returns a 0-10 security score with risk classification.
    """
    store = _get_store(request)
    agent = store.get_agent(agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")

    url = agent.get("url", "")
    if not url:
        raise HTTPException(status_code=400, detail="Agent has no URL configured")

    # Ensure URL has scheme
    if not url.startswith("http"):
        url = f"https://{url}"

    # Extract hostname for TLS check
    from urllib.parse import urlparse
    parsed = urlparse(url)
    hostname = parsed.hostname or ""

    # Run checks
    tls_result = _check_tls(hostname) if hostname else {"valid": False, "error": "No hostname"}
    check_results = await _check_endpoint(url)

    endpoint_result = check_results["endpoint"]
    header_result = check_results["headers"]
    cors_result = check_results["cors"]
    server_result = check_results["server_info"]

    # Compute score
    score = _compute_score(tls_result, endpoint_result, header_result, cors_result, server_result)
    risk = _risk_level(score)

    scan_id = str(uuid.uuid4())
    now = datetime.utcnow().isoformat()

    scan = SecurityScanResult(
        scan_id=scan_id,
        agent_id=agent_id,
        url=url,
        score=score,
        risk_level=risk,
        tls=tls_result,
        headers=header_result,
        endpoint=endpoint_result,
        cors=cors_result,
        server_info=server_result,
        scanned_at=now,
    )

    # Store result
    store.add_security_scan(scan.model_dump(mode="json"))

    return scan


@router.get("/report/{agent_id}", response_model=SecurityScanResult, tags=["security"])
async def get_security_report(request: Request, agent_id: str):
    """Get the latest security scan report for an agent.

    Returns the full scan results including TLS, headers, CORS,
    and server information checks.
    """
    store = _get_store(request)
    agent = store.get_agent(agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")

    scan = store.get_latest_security_scan(agent_id)
    if scan is None:
        raise HTTPException(status_code=404, detail="No security scan found for this agent. Run POST /api/security/scan/{agent_id} first.")

    return SecurityScanResult(**scan)


@router.get("/score/{agent_id}", response_model=SecurityScoreResponse, tags=["security"])
async def get_security_score(request: Request, agent_id: str):
    """Get the security score and risk level for an agent.

    Lightweight endpoint that returns only the score, risk level,
    and scan timestamp. Use /report/{agent_id} for full details.
    """
    store = _get_store(request)
    agent = store.get_agent(agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")

    scan = store.get_latest_security_scan(agent_id)
    if scan is None:
        raise HTTPException(status_code=404, detail="No security scan found. Run POST /api/security/scan/{agent_id} first.")

    return SecurityScoreResponse(
        agent_id=agent_id,
        score=scan["score"],
        risk_level=scan["risk_level"],
        scanned_at=scan["scanned_at"],
    )

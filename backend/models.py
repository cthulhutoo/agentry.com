"""Pydantic models for the Agentry platform."""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field, HttpUrl


# ---------------------------------------------------------------------------
# A2A Agent Card models (Google A2A protocol)
# ---------------------------------------------------------------------------

class AgentProvider(BaseModel):
    """Organization that provides the agent."""
    organization: str
    url: str | None = None


class AgentSkillExample(BaseModel):
    """Example interaction for a skill."""
    input: str | None = None
    output: str | None = None


class AgentSkill(BaseModel):
    """A single skill/capability an agent exposes."""
    id: str
    name: str = Field(..., description="Name of the AI agent to register")
    description: str | None = None
    inputModes: list[str] = Field(default_factory=list)
    outputModes: list[str] = Field(default_factory=list)
    examples: list[AgentSkillExample] = Field(default_factory=list)


class AgentCapabilities(BaseModel):
    """Declared agent capabilities."""
    streaming: bool = False
    pushNotifications: bool = False
    stateTransitionHistory: bool = False


class AgentAuthentication(BaseModel):
    """Authentication scheme the agent accepts."""
    schemes: list[str] = Field(default_factory=list)
    credentials: str | None = None


class AgentCard(BaseModel):
    """Full A2A Agent Card as defined by the protocol."""
    name: str
    description: str | None = None
    url: str
    provider: AgentProvider | None = None
    version: str | None = None
    protocolVersion: str | None = None
    capabilities: AgentCapabilities = Field(default_factory=AgentCapabilities)
    skills: list[AgentSkill] = Field(default_factory=list)
    authentication: AgentAuthentication | None = None
    defaultInputModes: list[str] = Field(default_factory=lambda: ["text"])
    defaultOutputModes: list[str] = Field(default_factory=lambda: ["text"])


# ---------------------------------------------------------------------------
# Agent directory listing models
# ---------------------------------------------------------------------------

class AgentListing(BaseModel):
    """An agent entry in the Agentry directory."""
    id: str = Field(default_factory=lambda: uuid.uuid4().hex[:12])
    name: str
    url: str
    category: str = Field(default="Uncategorized", description="Category for the agent (e.g. Sales & Outreach, Customer Support, Development Tools)")
    description: str = Field(default="", description="A brief description of what the agent does and its capabilities")
    pricing_model: str = Field(default="Unknown", description="Pricing model: Free, Freemium, Subscription, Pay-per-use, Contact for pricing")
    starting_price: str = Field(default="Unknown", description="Starting price or pricing tier (e.g. Free, $10/mo, Contact)")
    key_features: str = Field(default="", description="Comma-separated list of key features and capabilities")
    integrations: str = Field(default="", description="Comma-separated list of integrations (e.g. Slack, Salesforce, GitHub)")
    a2a_support: str = Field(default="Unknown", description="Whether the agent supports the A2A protocol (Yes/No/Unknown)")
    mcp_support: str = Field(default="Unknown", description="Whether the agent exposes MCP tools (Yes/No/Unknown)")
    a2a_endpoint: str | None = Field(default=None, description="Verified working A2A endpoint path (e.g. '/a2a')")
    mcp_endpoint: str | None = Field(default=None, description="Verified working MCP endpoint path (e.g. '/mcp')")
    trust_score: float | None = None
    agent_card: AgentCard | None = None
    verification_status: str = "unverified"
    trust_tier: str = "unverified"
    last_card_check: datetime | None = None
    card_url: str | None = None
    agent_card_snapshot_id: str | None = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class AgentSearchQuery(BaseModel):
    """Search query for agents."""
    q: str = ""
    category: str | None = None
    a2a_support: str | None = None
    mcp_support: str | None = None
    limit: int = Field(default=20, ge=1, le=500)
    offset: int = Field(default=0, ge=0)


class AgentRegistration(BaseModel):
    """Payload for registering a new agent in the directory."""
    name: str = Field(..., description="Name of the AI agent to register")
    url: str = Field(..., description="Public URL where the agent is accessible")
    category: str = Field(default="Uncategorized", description="Category for the agent (e.g. Sales & Outreach, Customer Support, Development Tools)")
    description: str = Field(default="", description="A brief description of what the agent does and its capabilities")
    pricing_model: str = Field(default="Unknown", description="Pricing model: Free, Freemium, Subscription, Pay-per-use, Contact for pricing")
    starting_price: str = Field(default="Unknown", description="Starting price or pricing tier (e.g. Free, $10/mo, Contact)")
    key_features: str = Field(default="", description="Comma-separated list of key features and capabilities")
    integrations: str = Field(default="", description="Comma-separated list of integrations (e.g. Slack, Salesforce, GitHub)")
    a2a_support: str = Field(default="Unknown", description="Whether the agent supports the A2A protocol (Yes/No/Unknown)")
    mcp_support: str = Field(default="Unknown", description="Whether the agent exposes MCP tools (Yes/No/Unknown)")
    contact_email: str | None = Field(default=None, description="Contact email for the agent developer/company")


# ---------------------------------------------------------------------------
# Broker intake models
# ---------------------------------------------------------------------------

class BrokerIntakeForm(BaseModel):
    """Form submitted by a business seeking agent recommendations.
    
    Accepts field names from both the frontend form and the API directly.
    """
    business_name: str = Field(default="")
    email: str = Field(default="")
    business_type: str = Field(default="")
    needs: str = Field(default="")
    budget: str = Field(default="")
    tools: str = Field(default="")
    urgency: str = Field(default="exploring")


class BrokerIntakeRecord(BaseModel):
    """Persisted record of a broker intake submission."""
    id: str = Field(default_factory=lambda: uuid.uuid4().hex[:12])
    form: BrokerIntakeForm
    status: str = "pending"
    matched_agents: list[str] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


# ---------------------------------------------------------------------------
# Scanner / crawl result models
# ---------------------------------------------------------------------------

class ScanResult(BaseModel):
    """Result of scanning a single domain for an A2A Agent Card."""
    domain: str
    url_checked: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    http_status: int | None = None
    response_time_ms: float | None = None
    valid: bool = False
    agent_card: AgentCard | None = None
    error: str | None = None


class ScanRequest(BaseModel):
    """Request to scan one or more domains."""
    domains: list[str]


class ScanResultsResponse(BaseModel):
    """Paginated scan results."""
    results: list[ScanResult]
    total: int


# ---------------------------------------------------------------------------
# Registry / Trust layer models
# ---------------------------------------------------------------------------

class VerificationStatus(str, Enum):
    VERIFIED = "verified"
    BASIC = "basic"
    UNVERIFIED = "unverified"
    MANUAL_ONLY = "manual_only"


class AgentCardSnapshot(BaseModel):
    """Point-in-time snapshot of a discovered AgentCard."""
    id: str = Field(default_factory=lambda: uuid.uuid4().hex[:16])
    agent_id: str
    raw_json: dict[str, Any] = Field(default_factory=dict)
    card: AgentCard | None = None
    url_source: str
    http_status: int
    response_time_ms: float
    fetched_at: datetime = Field(default_factory=datetime.utcnow)
    diff_from_previous: dict[str, Any] | None = None


class TrustSignals(BaseModel):
    """Individual trust checks for an agent."""
    card_resolves: bool = False
    card_schema_valid: bool = False
    domain_matches_url: bool = False
    has_provider_info: bool = False
    has_auth_scheme: bool = False
    has_skills: bool = False
    has_version: bool = False
    has_protocol_version: bool = False
    supports_streaming: bool = False
    supports_push_notifications: bool = False
    supports_state_history: bool = False
    a2a_endpoint_live: bool = False
    mcp_endpoint_live: bool = False
    response_time_ms: float | None = None
    uptime_checks_passed: int = 0
    uptime_checks_total: int = 0
    last_checked: datetime = Field(default_factory=datetime.utcnow)
    version_changes_30d: int = 0


class TrustReport(BaseModel):
    """Composite trust assessment for an agent."""
    agent_id: str
    trust_score: float = 0.0
    trust_tier: str = "unverified"
    signals: TrustSignals = Field(default_factory=TrustSignals)
    computed_at: datetime = Field(default_factory=datetime.utcnow)
    score_breakdown: dict[str, Any] = Field(default_factory=dict)


# ---------------------------------------------------------------------------
# Enterprise Private Registry models
# ---------------------------------------------------------------------------

class Organization(BaseModel):
    """An enterprise org with a private agent registry."""
    id: str = Field(default_factory=lambda: "org-" + uuid.uuid4().hex[:12])
    name: str
    slug: str  # URL-safe org identifier
    email: str
    api_key: str = Field(default_factory=lambda: "ak_" + uuid.uuid4().hex)
    plan: str = "free"  # free, basic, pro, enterprise
    max_agents: int = 5  # free tier limit
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class PrivateAgent(BaseModel):
    """An agent in a private enterprise registry."""
    id: str = Field(default_factory=lambda: "pa-" + uuid.uuid4().hex[:12])
    org_id: str
    name: str
    url: str
    description: str = ""
    category: str = "Internal"
    environment: str = "production"  # production, staging, development
    owner_team: str = ""  # e.g. "engineering", "support"
    tags: list[str] = Field(default_factory=list)
    a2a_card_url: str | None = None
    agent_card: dict | None = None
    trust_score: float = 0.0
    trust_tier: str = "unverified"
    last_card_check: datetime | None = None
    status: str = "active"  # active, inactive, deprecated
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class CreateOrgRequest(BaseModel):
    name: str
    email: str
    slug: str | None = None  # auto-generated from name if not provided


class CreatePrivateAgentRequest(BaseModel):
    name: str
    url: str
    description: str = ""
    category: str = "Internal"
    environment: str = "production"
    owner_team: str = ""
    tags: list[str] = Field(default_factory=list)


class UpdatePrivateAgentRequest(BaseModel):
    name: str | None = None
    url: str | None = None
    description: str | None = None
    category: str | None = None
    environment: str | None = None
    owner_team: str | None = None
    tags: list[str] | None = None
    status: str | None = None


# ---------------------------------------------------------------------------
# Generic responses
# ---------------------------------------------------------------------------

class PaginatedResponse(BaseModel):
    """Generic paginated wrapper."""
    items: list[Any]
    total: int
    limit: int
    offset: int


class CategoryCount(BaseModel):
    """Category with its agent count."""
    category: str
    count: int

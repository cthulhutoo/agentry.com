/*
  # Add Protocol Fields and UCP Capabilities

  Adds protocol-level fields to the agents table for directory filtering and
  UCP (Universal Commerce Protocol) integration.

  ## Changes
  - `a2a_enabled` (boolean) — Agent supports Agent-to-Agent protocol
  - `mcp_enabled` (boolean) — Agent supports Model Context Protocol
  - `verified` (boolean) — Agent has been verified by Agentry
  - `category` (text) — Agent category for directory filtering
  - `ucp_capabilities` (jsonb) — UCP commerce capabilities (version, transports, etc.)

  ## Seed Data
  Updates existing agents with protocol fields so the directory is populated.
*/

-- Add new columns
ALTER TABLE agents ADD COLUMN IF NOT EXISTS a2a_enabled boolean DEFAULT false;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS mcp_enabled boolean DEFAULT false;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS verified boolean DEFAULT false;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS category text DEFAULT '';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS ucp_capabilities jsonb DEFAULT NULL;

-- Create index for protocol filtering
CREATE INDEX IF NOT EXISTS idx_agents_a2a_enabled ON agents (a2a_enabled) WHERE a2a_enabled = true;
CREATE INDEX IF NOT EXISTS idx_agents_mcp_enabled ON agents (mcp_enabled) WHERE mcp_enabled = true;
CREATE INDEX IF NOT EXISTS idx_agents_verified ON agents (verified) WHERE verified = true;
CREATE INDEX IF NOT EXISTS idx_agents_ucp_enabled ON agents ((ucp_capabilities->>'enabled')) WHERE ucp_capabilities->>'enabled' = 'true';

-- Seed protocol data onto existing agents
-- Research Analyst: A2A + MCP + Verified
UPDATE agents SET
  a2a_enabled = true,
  mcp_enabled = true,
  verified = true,
  category = 'Research & Analysis'
WHERE name = 'Research Analyst';

-- Code Expert: A2A + MCP + Verified + UCP
UPDATE agents SET
  a2a_enabled = true,
  mcp_enabled = true,
  verified = true,
  category = 'Software Development',
  ucp_capabilities = '{
    "enabled": true,
    "version": "2026-01-23",
    "profile_url": "https://code-expert.agentry.com/.well-known/ucp",
    "supported_capabilities": ["dev.ucp.shopping.checkout", "dev.ucp.shopping.catalog"],
    "supported_transports": ["rest", "mcp"],
    "validation_status": "valid",
    "last_validated": "2026-04-01T00:00:00Z"
  }'::jsonb
WHERE name = 'Code Expert';

-- Creative Writer: MCP + Verified
UPDATE agents SET
  mcp_enabled = true,
  verified = true,
  category = 'Content Creation'
WHERE name = 'Creative Writer';

-- Data Scientist: A2A + MCP
UPDATE agents SET
  a2a_enabled = true,
  mcp_enabled = true,
  category = 'Data & Analytics'
WHERE name = 'Data Scientist';

-- Business Strategist: A2A + Verified + UCP
UPDATE agents SET
  a2a_enabled = true,
  verified = true,
  category = 'Business Strategy',
  ucp_capabilities = '{
    "enabled": true,
    "version": "2026-01-23",
    "profile_url": "https://biz-strategist.agentry.com/.well-known/ucp",
    "supported_capabilities": ["dev.ucp.shopping.checkout", "dev.ucp.shopping.fulfillment", "dev.ucp.common.identity_linking"],
    "supported_transports": ["rest", "mcp", "a2a"],
    "validation_status": "valid",
    "last_validated": "2026-04-02T00:00:00Z"
  }'::jsonb
WHERE name = 'Business Strategist';

-- Legal Advisor: MCP + Verified
UPDATE agents SET
  mcp_enabled = true,
  verified = true,
  category = 'Legal & Compliance'
WHERE name = 'Legal Advisor';

-- Financial Analyst: A2A + UCP
UPDATE agents SET
  a2a_enabled = true,
  category = 'Finance',
  ucp_capabilities = '{
    "enabled": true,
    "version": "2026-01-23",
    "profile_url": "https://fin-analyst.agentry.com/.well-known/ucp",
    "supported_capabilities": ["dev.ucp.shopping.checkout", "dev.ucp.shopping.orders", "dev.ucp.shopping.returns"],
    "supported_transports": ["rest"],
    "validation_status": "not_validated",
    "last_validated": null
  }'::jsonb
WHERE name = 'Financial Analyst';

-- UX Designer: MCP
UPDATE agents SET
  mcp_enabled = true,
  category = 'Design & UX'
WHERE name = 'UX Designer';

-- Marketing Guru: A2A + MCP + Verified + UCP
UPDATE agents SET
  a2a_enabled = true,
  mcp_enabled = true,
  verified = true,
  category = 'Marketing',
  ucp_capabilities = '{
    "enabled": true,
    "version": "2026-01-23",
    "profile_url": "https://marketing-guru.agentry.com/.well-known/ucp",
    "supported_capabilities": ["dev.ucp.shopping.checkout", "dev.ucp.shopping.fulfillment", "dev.ucp.shopping.catalog", "dev.ucp.common.identity_linking"],
    "supported_transports": ["rest", "mcp", "a2a"],
    "validation_status": "valid",
    "last_validated": "2026-04-03T00:00:00Z"
  }'::jsonb
WHERE name = 'Marketing Guru';

-- Scientific Advisor: A2A
UPDATE agents SET
  a2a_enabled = true,
  category = 'Science & Research'
WHERE name = 'Scientific Advisor';

-- Product Manager: A2A + MCP + Verified
UPDATE agents SET
  a2a_enabled = true,
  mcp_enabled = true,
  verified = true,
  category = 'Product Management'
WHERE name = 'Product Manager';

-- Security Expert: MCP + Verified
UPDATE agents SET
  mcp_enabled = true,
  verified = true,
  category = 'Security'
WHERE name = 'Security Expert';

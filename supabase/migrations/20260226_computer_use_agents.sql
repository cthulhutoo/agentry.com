-- ============================================================================
-- COMPUTER USE AGENTS DATABASE SCHEMA
-- ============================================================================
-- Version: 1.0.0
-- Created: 2026-02-26
-- Project: Agentry.com - BMad v6 Implementation
-- ============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- TABLE: computer_use_tasks
-- ============================================================================
CREATE TABLE IF NOT EXISTS computer_use_tasks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- Task Definition
    prompt TEXT NOT NULL,
    max_steps INTEGER NOT NULL DEFAULT 20,
    timeout_ms INTEGER NOT NULL DEFAULT 120000,
    
    -- Session Configuration
    session_id UUID REFERENCES computer_use_sessions(id) ON DELETE SET NULL,
    browser_type VARCHAR(20) DEFAULT 'chromium',
    
    -- Domain Control
    allowed_domains TEXT[] DEFAULT '{}',
    blocked_domains TEXT[] DEFAULT '{}',
    
    -- Capabilities
    allow_downloads BOOLEAN DEFAULT false,
    allow_uploads BOOLEAN DEFAULT false,
    allow_notifications BOOLEAN DEFAULT false,
    
    -- Execution State
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'queued', 'processing', 'completed', 'failed', 'cancelled', 'timeout')),
    
    -- Results
    actions JSONB DEFAULT '[]',
    results JSONB DEFAULT '{}',
    error_message TEXT,
    
    -- Screenshots Storage
    screenshot_bucket TEXT DEFAULT 'task-screenshots',
    screenshot_count INTEGER DEFAULT 0,
    
    -- Execution Metrics
    steps_executed INTEGER DEFAULT 0,
    execution_time_ms INTEGER,
    credits_charged INTEGER DEFAULT 0,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    
    -- Metadata
    metadata JSONB DEFAULT '{}'
);

-- Indexes for computer_use_tasks
CREATE INDEX IF NOT EXISTS idx_cu_tasks_user_id ON computer_use_tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_cu_tasks_status ON computer_use_tasks(status);
CREATE INDEX IF NOT EXISTS idx_cu_tasks_created_at ON computer_use_tasks(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cu_tasks_session_id ON computer_use_tasks(session_id);

-- ============================================================================
-- TABLE: computer_use_sessions
-- ============================================================================
CREATE TABLE IF NOT EXISTS computer_use_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- Browser Configuration
    browser_type VARCHAR(20) NOT NULL DEFAULT 'chromium',
    user_agent TEXT,
    viewport_width INTEGER DEFAULT 1280,
    viewport_height INTEGER DEFAULT 720,
    device_scale_factor DECIMAL(3,2) DEFAULT 1.0,
    
    -- Domain Control
    allowed_domains TEXT[] DEFAULT '{}',
    blocked_domains TEXT[] DEFAULT '{}',
    
    -- State
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'idle', 'terminated', 'error')),
    current_url TEXT,
    current_title TEXT,
    
    -- Capabilities
    enable_recordings BOOLEAN DEFAULT false,
    enable_downloads BOOLEAN DEFAULT false,
    
    -- Browser Storage (serialized cookies/localStorage)
    cookies JSONB DEFAULT '[]',
    local_storage JSONB DEFAULT '{}',
    session_storage JSONB DEFAULT '{}',
    
    -- Metrics
    actions_count INTEGER DEFAULT 0,
    pages_visited INTEGER DEFAULT 0,
    
    -- Expiration
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 minutes'),
    last_activity_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    terminated_at TIMESTAMPTZ
);

-- Indexes for computer_use_sessions
CREATE INDEX IF NOT EXISTS idx_cu_sessions_user_id ON computer_use_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_cu_sessions_status ON computer_use_sessions(status);
CREATE INDEX IF NOT EXISTS idx_cu_sessions_expires_at ON computer_use_sessions(expires_at);

-- ============================================================================
-- TABLE: computer_use_actions (Action History)
-- ============================================================================
CREATE TABLE IF NOT EXISTS computer_use_actions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    task_id UUID REFERENCES computer_use_tasks(id) ON DELETE CASCADE,
    session_id UUID REFERENCES computer_use_sessions(id) ON DELETE SET NULL,
    
    -- Action Details
    step_number INTEGER NOT NULL,
    action_type VARCHAR(50) NOT NULL
        CHECK (action_type IN (
            'navigate', 'goto', 'click', 'double_click', 'right_click',
            'hover', 'type', 'paste', 'select', 'select_option',
            'check', 'uncheck', 'scroll', 'scroll_up', 'scroll_down',
            'screenshot', 'full_screenshot', 'wait', 'wait_for_selector',
            'wait_for_navigation', 'evaluate', 'js_exec',
            'download', 'upload', 'press_key', 'send_keys',
            'go_back', 'go_forward', 'reload', 'close'
        )),
    
    -- Action Parameters
    selector TEXT,
    selector_type VARCHAR(20)
        CHECK (selector_type IN ('css', 'xpath', 'text', 'id', 'class', 'role')),
    value TEXT,
    options JSONB DEFAULT '{}',
    
    -- Execution Result
    success BOOLEAN DEFAULT true,
    error_message TEXT,
    duration_ms INTEGER,
    
    -- Pre/Post State
    url_before TEXT,
    url_after TEXT,
    screenshot_path TEXT,
    
    -- AI Reasoning
    reasoning TEXT,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for computer_use_actions
CREATE INDEX IF NOT EXISTS idx_cu_actions_task_id ON computer_use_actions(task_id);
CREATE INDEX IF NOT EXISTS idx_cu_actions_session_id ON computer_use_actions(session_id);
CREATE INDEX IF NOT EXISTS idx_cu_actions_created_at ON computer_use_actions(created_at);

-- ============================================================================
-- TABLE: computer_use_action_templates
-- ============================================================================
CREATE TABLE IF NOT EXISTS computer_use_action_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(50) NOT NULL
        CHECK (category IN ('navigation', 'form', 'scraping', 'automation', 'testing')),
    
    -- Template Definition
    actions JSONB NOT NULL,
    parameters JSONB DEFAULT '{}',
    
    -- Usage
    usage_count INTEGER DEFAULT 0,
    success_rate DECIMAL(5,2) DEFAULT 100.00,
    
    -- Visibility
    is_public BOOLEAN DEFAULT true,
    created_by UUID REFERENCES auth.users(id),
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- TABLE: computer_use_audit_logs
-- ============================================================================
CREATE TABLE IF NOT EXISTS computer_use_audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Actor
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    ip_address INET,
    user_agent TEXT,
    
    -- Action
    action_type VARCHAR(50) NOT NULL,
    resource_type VARCHAR(50) NOT NULL,
    resource_id UUID,
    
    -- Details
    action_details JSONB DEFAULT '{}',
    
    -- Outcome
    success BOOLEAN DEFAULT true,
    error_message TEXT,
    
    -- Correlation
    task_id UUID REFERENCES computer_use_tasks(id) ON DELETE SET NULL,
    session_id UUID REFERENCES computer_use_sessions(id) ON DELETE SET NULL,
    request_id UUID,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for audit logs
CREATE INDEX IF NOT EXISTS idx_cu_audit_user_id ON computer_use_audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_cu_audit_task_id ON computer_use_audit_logs(task_id);
CREATE INDEX IF NOT EXISTS idx_cu_audit_created_at ON computer_use_audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cu_audit_action_type ON computer_use_audit_logs(action_type);

-- ============================================================================
-- TABLE: computer_use_policy_rules
-- ============================================================================
CREATE TABLE IF NOT EXISTS computer_use_policy_rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Rule Definition
    name VARCHAR(255) NOT NULL,
    description TEXT,
    rule_type VARCHAR(50) NOT NULL
        CHECK (rule_type IN ('domain', 'action', 'time', 'resource', 'custom')),
    
    -- Condition
    condition JSONB NOT NULL,
    -- Example: {"domain": "*.github.com", "action": "download", "max_per_hour": 10}
    
    -- Effect
    effect VARCHAR(20) NOT NULL CHECK (effect IN ('allow', 'deny', 'warn', 'rate_limit')),
    
    -- Priority (higher = more important)
    priority INTEGER DEFAULT 0,
    
    -- Scope
    is_global BOOLEAN DEFAULT false,
    user_id UUID REFERENCES auth.users(id),
    
    -- State
    is_active BOOLEAN DEFAULT true,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- TABLE: computer_use_credentials (Encrypted)
-- ============================================================================
CREATE TABLE IF NOT EXISTS computer_use_credentials (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- Credential Info (encrypted)
    name VARCHAR(255) NOT NULL,
    domain VARCHAR(255) NOT NULL,
    encrypted_username BYTEA NOT NULL,
    encrypted_password BYTEA NOT NULL,
    
    -- Metadata
    username_field VARCHAR(100),
    password_field VARCHAR(100),
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for credentials lookup
CREATE INDEX IF NOT EXISTS idx_cu_credentials_user_domain ON computer_use_credentials(user_id, domain);

-- ============================================================================
-- FUNCTION: Credit Consumption
-- ============================================================================

CREATE OR REPLACE FUNCTION calculate_computer_use_credits(
    p_steps INTEGER,
    p_timeout_ms INTEGER,
    p_screenshots INTEGER
) RETURNS INTEGER AS $$
DECLARE
    base_credits INTEGER := 1;
    step_credits INTEGER := 1;
    timeout_credits INTEGER := 0;
    screenshot_credits INTEGER := 1;
BEGIN
    timeout_credits := (p_timeout_ms / 60000);
    IF timeout_credits > 5 THEN
        timeout_credits := 5;
    END IF;
    
    RETURN base_credits + (p_steps * step_credits) + timeout_credits + (p_screenshots * screenshot_credits);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================================================
-- RLS POLICIES
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE computer_use_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE computer_use_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE computer_use_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE computer_use_action_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE computer_use_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE computer_use_policy_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE computer_use_credentials ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- TASKS POLICIES
-- ============================================================================

CREATE POLICY "Users can view own computer use tasks"
    ON computer_use_tasks FOR SELECT
    USING (user_id = auth.uid() OR user_id IS NULL);

CREATE POLICY "Users can create computer use tasks"
    ON computer_use_tasks FOR INSERT
    WITH CHECK (user_id = auth.uid() OR user_id IS NULL);

CREATE POLICY "Users can update own computer use tasks"
    ON computer_use_tasks FOR UPDATE
    USING (user_id = auth.uid() OR user_id IS NULL)
    WITH CHECK (user_id = auth.uid() OR user_id IS NULL);

CREATE POLICY "Users can delete own computer use tasks"
    ON computer_use_tasks FOR DELETE
    USING (user_id = auth.uid() OR user_id IS NULL);

CREATE POLICY "Service role can manage all tasks"
    ON computer_use_tasks FOR ALL
    USING (auth.role() = 'service_role');

-- ============================================================================
-- SESSIONS POLICIES
-- ============================================================================

CREATE POLICY "Users can manage own sessions"
    ON computer_use_sessions FOR ALL
    USING (user_id = auth.uid() OR user_id IS NULL)
    WITH CHECK (user_id = auth.uid() OR user_id IS NULL);

CREATE POLICY "Service role can manage all sessions"
    ON computer_use_sessions FOR ALL
    USING (auth.role() = 'service_role');

-- ============================================================================
-- ACTIONS POLICIES
-- ============================================================================

CREATE POLICY "Users can view own actions"
    ON computer_use_actions FOR SELECT
    USING (
        task_id IN (
            SELECT id FROM computer_use_tasks
            WHERE user_id = auth.uid() OR user_id IS NULL
        )
    );

CREATE POLICY "Service role can manage all actions"
    ON computer_use_actions FOR ALL
    USING (auth.role() = 'service_role');

-- ============================================================================
-- AUDIT LOGS POLICIES
-- ============================================================================

CREATE POLICY "Users can view own audit logs"
    ON computer_use_audit_logs FOR SELECT
    USING (user_id = auth.uid());

CREATE POLICY "Admins can view all audit logs"
    ON computer_use_audit_logs FOR SELECT
    USING (auth.role() = 'service_role' OR auth.jwt()->>'role' = 'admin');

-- ============================================================================
-- ACTION TEMPLATES POLICIES
-- ============================================================================

CREATE POLICY "Anyone can view public templates"
    ON computer_use_action_templates FOR SELECT
    USING (is_public = true);

CREATE POLICY "Users can manage own templates"
    ON computer_use_action_templates FOR ALL
    USING (created_by = auth.uid() OR is_public = true)
    WITH CHECK (created_by = auth.uid() OR is_public = true);

-- ============================================================================
-- POLICY RULES POLICIES
-- ============================================================================

CREATE POLICY "Users can manage own policy rules"
    ON computer_use_policy_rules FOR ALL
    USING (user_id = auth.uid() OR is_global = true)
    WITH CHECK (user_id = auth.uid() OR is_global = true);

CREATE POLICY "Service role can manage all policies"
    ON computer_use_policy_rules FOR ALL
    USING (auth.role() = 'service_role');

-- ============================================================================
-- CREDENTIALS POLICIES
-- ============================================================================

CREATE POLICY "Users can manage own credentials"
    ON computer_use_credentials FOR ALL
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "Service role can manage credentials"
    ON computer_use_credentials FOR ALL
    USING (auth.role() = 'service_role');

-- ============================================================================
-- STORAGE BUCKET FOR SCREENSHOTS
-- ============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_types)
VALUES ('task-screenshots', 'task-screenshots', true, 10485760, ARRAY['image/png', 'image/jpeg'])
ON CONFLICT DO NOTHING;

-- Storage policies
CREATE POLICY "Users can manage own screenshots"
    ON storage.objects FOR ALL
    USING (bucket_id = 'task-screenshots');

-- ============================================================================
-- DEFAULT POLICY RULES
-- ============================================================================

INSERT INTO computer_use_policy_rules (name, description, rule_type, condition, effect, priority, is_global, is_active)
VALUES
    ('Block Financial Sites', 'Prevent access to banking and financial sites', 'domain',
     '{"category": "banking"}', 'deny', 100, true, true),
    
    ('Block Government Sites', 'Prevent access to government sites', 'domain',
     '{"category": "government"}', 'deny', 100, true, true),
    
    ('Block Email Providers', 'Prevent access to email providers', 'domain',
     '{"domains": ["gmail.com", "outlook.com", "yahoo.com", "mail.com"]}', 'deny', 90, true, true),
    
    ('Block Social Media Login', 'Prevent login to social media', 'domain',
     '{"domains": ["facebook.com", "twitter.com", "instagram.com", "linkedin.com"]}', 'warn', 50, true, true),
    
    ('Block File Downloads by Default', 'Require explicit permission for downloads', 'action',
     '{"action": "download"}', 'deny', 80, true, true),
    
    ('Block External Payments', 'Prevent payment operations', 'action',
     '{"action": "payment"}', 'deny', 90, true, true),
    
    ('Rate Limit High Frequency', 'Prevent excessive API calls', 'rate_limit',
     '{"max_per_minute": 10, "max_per_hour": 100}', 'rate_limit', 70, true, true)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- DEFAULT ACTION TEMPLATES
-- ============================================================================

INSERT INTO computer_use_action_templates (name, description, category, actions, is_public)
VALUES
    ('Navigate to URL', 'Navigate to a specific URL', 'navigation', 
     '[{"action_type": "navigate", "selector": null, "value": "{{url}}"}]', true),
    
    ('Fill Form Field', 'Fill a text input field', 'form',
     '[{"action_type": "click", "selector": "{{selector}}", "selector_type": "{{selector_type}}"}, {"action_type": "type", "selector": "{{selector}}", "selector_type": "{{selector_type}}", "value": "{{value}}"}]', true),
    
    ('Click Button', 'Click a button or link', 'automation',
     '[{"action_type": "click", "selector": "{{selector}}", "selector_type": "{{selector_type}}"}]', true),
    
    ('Scroll Down', 'Scroll down the page', 'navigation',
     '[{"action_type": "scroll", "value": "down"}]', true),
    
    ('Take Screenshot', 'Capture current page screenshot', 'scraping',
     '[{"action_type": "screenshot"}]', true),
    
    ('Wait for Element', 'Wait for an element to appear', 'automation',
     '[{"action_type": "wait_for_selector", "selector": "{{selector}}", "selector_type": "{{selector_type}}", "options": {"timeout": {{timeout_ms}}}]', true)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================
SELECT 'Computer Use Agents migration completed successfully' AS status;

-- ============================================
-- RPC Functions for Computer Use Agents
-- ============================================

-- Calculate credits function
CREATE OR REPLACE FUNCTION calculate_computer_use_credits(
  p_steps INT,
  p_timeout_ms BIGINT,
  p_screenshots INT
) RETURNS INT AS $$
BEGIN
  RETURN 1 + p_steps + LEAST(EXTRACT(EPOCH FROM (p_timeout_ms/1000))::INT / 60, 5) + p_screenshots;
END;
$$ LANGUAGE plpgsql;

-- Deduct credits function
CREATE OR REPLACE FUNCTION deduct_credits(
  p_user_id UUID,
  p_amount INT,
  p_task_id UUID,
  p_description TEXT
) RETURNS BOOLEAN AS $$
BEGIN
  UPDATE user_credits 
  SET credits = credits - p_amount 
  WHERE user_id = p_user_id;
  
  INSERT INTO credit_transactions (user_id, amount, description, task_id)
  VALUES (p_user_id, -p_amount, p_description, p_task_id);
  
  RETURN TRUE;
EXCEPTION WHEN OTHERS THEN
  RETURN FALSE;
END;
$$ LANGUAGE plpgsql;

-- Increment template usage
CREATE OR REPLACE FUNCTION increment_template_usage(template_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE computer_use_action_templates 
  SET usage_count = usage_count + 1 
  WHERE id = template_id;
END;
$$ LANGUAGE plpgsql;

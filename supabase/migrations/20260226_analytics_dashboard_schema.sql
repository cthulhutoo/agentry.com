-- ============================================================================
-- Analytics Dashboard Schema Migration
-- Project: Agentry.com Analytics Dashboard
-- Version: 1.0
-- Created: 2026-02-26
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. USAGE EVENTS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS usage_events (
    -- Primary identifiers
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    agent_id UUID NOT NULL,

    -- Event classification
    event_type VARCHAR(50) NOT NULL CHECK (event_type IN (
        'conversation_start',
        'conversation_message',
        'conversation_end',
        'tool_execution',
        'agent_invocation',
        'api_call'
    )),
    event_subtype VARCHAR(100),

    -- Usage metrics
    tokens_used INTEGER DEFAULT 0 CHECK (tokens_used >= 0),
    cost_cents INTEGER DEFAULT 0 CHECK (cost_cents >= 0),
    model_used VARCHAR(100),
    response_time_ms INTEGER CHECK (response_time_ms >= 0),

    -- Status tracking
    success BOOLEAN DEFAULT true,
    error_message TEXT,

    -- Extended data
    metadata JSONB DEFAULT '{}'::jsonb,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_usage_events_user ON usage_events(user_id);
CREATE INDEX IF NOT EXISTS idx_usage_events_agent ON usage_events(agent_id);
CREATE INDEX IF NOT EXISTS idx_usage_events_created ON usage_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_events_type ON usage_events(event_type);
CREATE INDEX IF NOT EXISTS idx_usage_events_date ON usage_events(created_at DESC, user_id, agent_id);

-- Composite index for date range queries with filters
CREATE INDEX IF NOT EXISTS idx_usage_events_range ON usage_events 
    (created_at DESC, event_type, user_id, agent_id);

-- ============================================================================
-- 2. ALERT THRESHOLDS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS alert_thresholds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    organization_id UUID,

    -- Alert configuration
    alert_type VARCHAR(50) NOT NULL CHECK (alert_type IN (
        'cost_daily',
        'cost_weekly',
        'cost_monthly',
        'tokens_daily',
        'tokens_monthly',
        'response_time',
        'error_rate'
    )),
    threshold_value DECIMAL(15, 2) NOT NULL,
    threshold_unit VARCHAR(20) NOT NULL,

    -- Alert behavior
    is_active BOOLEAN DEFAULT true,
    notification_channels JSONB DEFAULT '[]'::jsonb,

    -- Metadata
    name VARCHAR(255) NOT NULL,
    description TEXT,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_alert_thresholds_user ON alert_thresholds(user_id);
CREATE INDEX IF NOT EXISTS idx_alert_thresholds_org ON alert_thresholds(organization_id);
CREATE INDEX IF NOT EXISTS idx_alert_thresholds_active ON alert_thresholds(is_active) 
    WHERE is_active = true;

-- ============================================================================
-- 3. SAVED REPORTS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS saved_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    organization_id UUID,

    -- Report configuration
    name VARCHAR(255) NOT NULL,
    description TEXT,
    report_config JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- Visualization preferences
    default_visualization VARCHAR(50) DEFAULT 'line_chart',

    -- Sharing
    is_shared BOOLEAN DEFAULT false,
    shared_with JSONB DEFAULT '[]'::jsonb,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_saved_reports_user ON saved_reports(user_id);
CREATE INDEX IF NOT EXISTS idx_saved_reports_org ON saved_reports(organization_id);

-- ============================================================================
-- 4. ANOMALY RECORDS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS anomaly_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Anomaly classification
    anomaly_type VARCHAR(50) NOT NULL CHECK (anomaly_type IN (
        'cost_spike',
        'usage_spike',
        'performance_degradation',
        'error_rate_increase',
        'unusual_pattern'
    )),
    severity VARCHAR(20) NOT NULL CHECK (severity IN (
        'low', 'medium', 'high', 'critical'
    )),

    -- Detection details
    detected_value DECIMAL(15, 4),
    expected_value DECIMAL(15, 4),
    deviation_percentage DECIMAL(8, 2),

    -- Context
    metric_name VARCHAR(100),
    dimension JSONB DEFAULT '{}'::jsonb,
    time_range JSONB,

    -- Status
    is_resolved BOOLEAN DEFAULT false,
    resolution_notes TEXT,

    -- Timestamps
    detected_at TIMESTAMPTZ DEFAULT NOW(),
    resolved_at TIMESTAMPTZ
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_anomaly_records_type ON anomaly_records(anomaly_type);
CREATE INDEX IF NOT EXISTS idx_anomaly_records_severity ON anomaly_records(severity);
CREATE INDEX IF NOT EXISTS idx_anomaly_records_detected ON anomaly_records(detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_anomaly_records_unresolved ON anomaly_records(is_resolved) 
    WHERE is_resolved = false;

-- ============================================================================
-- 5. MATERIALIZED VIEWS
-- ============================================================================

-- 5.1 Daily Usage Aggregation
CREATE MATERIALIZED VIEW IF NOT EXISTS daily_usage_agg AS
SELECT
    -- Time dimension
    DATE_TRUNC('day', created_at) AS usage_date,

    -- Aggregation dimensions
    event_type,
    agent_id,
    model_used,

    -- Metrics
    COUNT(*) AS total_events,
    COUNT(DISTINCT user_id) AS unique_users,
    SUM(tokens_used) AS total_tokens,
    SUM(cost_cents) AS total_cost,
    AVG(response_time_ms) AS avg_response_time,
    COUNT(*) FILTER (WHERE success = false) AS failed_events,
    COUNT(*) FILTER (WHERE success = true) AS successful_events,
    PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY response_time_ms) AS p50_response_time,
    PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY response_time_ms) AS p95_response_time,
    MAX(response_time_ms) AS max_response_time,
    MIN(response_time_ms) AS min_response_time,

    -- Metadata
    COUNT(DISTINCT agent_id) AS active_agents
FROM usage_events
GROUP BY 
    DATE_TRUNC('day', created_at),
    event_type,
    agent_id,
    model_used
WITH DATA;

-- Indexes for materialized view
CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_usage_agg_pkey 
    ON daily_usage_agg (usage_date, event_type, agent_id, model_used);
CREATE INDEX IF NOT EXISTS idx_daily_usage_agg_date ON daily_usage_agg (usage_date DESC);
CREATE INDEX IF NOT EXISTS idx_daily_usage_agg_agent ON daily_usage_agg (agent_id);

-- 5.2 Agent Usage Aggregation
CREATE MATERIALIZED VIEW IF NOT EXISTS agent_usage_agg AS
SELECT
    agent_id,

    -- Conversation metrics
    COUNT(DISTINCT 
        CASE WHEN event_type = 'conversation_start' 
        THEN CONCAT(user_id, '-', created_at::date) 
        END
    ) AS total_conversations,

    -- Token and cost metrics
    SUM(tokens_used) AS total_tokens,
    SUM(cost_cents) AS total_cost,
    AVG(cost_cents) AS avg_cost_per_event,

    -- Performance metrics
    AVG(response_time_ms) AS avg_response_time,
    COUNT(*) FILTER (WHERE success = true) AS successful_events,
    COUNT(*) FILTER (WHERE success = false) AS failed_events,
    (COUNT(*) FILTER (WHERE success = true)::NUMERIC / 
        NULLIF(COUNT(*), 0) * 100) AS success_rate_percent,

    -- Model distribution
    COUNT(DISTINCT model_used) AS models_used,

    -- Time range
    MIN(created_at) AS first_usage,
    MAX(created_at) AS last_usage
FROM usage_events
GROUP BY agent_id
WITH DATA;

-- Indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_usage_agg_pkey ON agent_usage_agg (agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_usage_agg_cost ON agent_usage_agg (total_cost DESC);
CREATE INDEX IF NOT EXISTS idx_agent_usage_agg_tokens ON agent_usage_agg (total_tokens DESC);

-- 5.3 User Usage Aggregation
CREATE MATERIALIZED VIEW IF NOT EXISTS user_usage_agg AS
SELECT
    user_id,

    -- Activity metrics
    COUNT(*) AS total_events,
    COUNT(DISTINCT agent_id) AS agents_used,
    COUNT(DISTINCT DATE_TRUNC('day', created_at)) AS active_days,

    -- Usage metrics
    SUM(tokens_used) AS total_tokens,
    SUM(cost_cents) AS total_cost,
    AVG(cost_cents) AS avg_cost_per_event,

    -- Performance
    AVG(response_time_ms) AS avg_response_time,
    COUNT(*) FILTER (WHERE success = true) AS successful_events,
    (COUNT(*) FILTER (WHERE success = true)::NUMERIC / 
        NULLIF(COUNT(*), 0) * 100) AS success_rate_percent,

    -- Time boundaries
    MIN(created_at) AS first_activity,
    MAX(created_at) AS last_activity,
    EXTRACT(EPOCH FROM (MAX(created_at) - MIN(created_at))) / 86400 AS days_active
FROM usage_events
WHERE user_id IS NOT NULL
GROUP BY user_id
WITH DATA;

-- Indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_usage_agg_pkey ON user_usage_agg (user_id);
CREATE INDEX IF NOT EXISTS idx_user_usage_agg_cost ON user_usage_agg (total_cost DESC);
CREATE INDEX IF NOT EXISTS idx_user_usage_agg_tokens ON user_usage_agg (total_tokens DESC);

-- ============================================================================
-- 6. HELPER FUNCTIONS
-- ============================================================================

-- Get date range for common presets
CREATE OR REPLACE FUNCTION get_date_range(preset VARCHAR)
RETURNS TABLE(start_date TIMESTAMPTZ, end_date TIMESTAMPTZ)
LANGUAGE plpgsql
AS $$
BEGIN
    CASE preset
        WHEN 'today' THEN
            RETURN QUERY SELECT 
                CURRENT_DATE::TIMESTAMPTZ, 
                NOW();
        WHEN 'yesterday' THEN
            RETURN QUERY SELECT 
                (CURRENT_DATE - 1)::TIMESTAMPTZ, 
                CURRENT_DATE::TIMESTAMPTZ;
        WHEN 'last_7_days' THEN
            RETURN QUERY SELECT 
                (NOW() - INTERVAL '7 days')::TIMESTAMPTZ, 
                NOW();
        WHEN 'last_30_days' THEN
            RETURN QUERY SELECT 
                (NOW() - INTERVAL '30 days')::TIMESTAMPTZ, 
                NOW();
        WHEN 'last_90_days' THEN
            RETURN QUERY SELECT 
                (NOW() - INTERVAL '90 days')::TIMESTAMPTZ, 
                NOW();
        WHEN 'this_month' THEN
            RETURN QUERY SELECT 
                DATE_TRUNC('month', NOW())::TIMESTAMPTZ, 
                NOW();
        WHEN 'last_month' THEN
            RETURN QUERY SELECT 
                DATE_TRUNC('month', NOW() - INTERVAL '1 month')::TIMESTAMPTZ, 
                DATE_TRUNC('month', NOW())::TIMESTAMPTZ;
        WHEN 'this_year' THEN
            RETURN QUERY SELECT 
                DATE_TRUNC('year', NOW())::TIMESTAMPTZ, 
                NOW();
        ELSE
            RETURN QUERY SELECT 
                (NOW() - INTERVAL '30 days')::TIMESTAMPTZ, 
                NOW();
    END CASE;
END;
$$;

-- Refresh function for daily_usage_agg (concurrent-safe)
CREATE OR REPLACE FUNCTION refresh_daily_usage_agg()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY daily_usage_agg;
END;
$$;

-- Refresh function for agent_usage_agg
CREATE OR REPLACE FUNCTION refresh_agent_usage_agg()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY agent_usage_agg;
END;
$$;

-- Refresh function for user_usage_agg
CREATE OR REPLACE FUNCTION refresh_user_usage_agg()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY user_usage_agg;
END;
$$;

-- Detect cost anomalies
CREATE OR REPLACE FUNCTION detect_cost_anomalies(
    p_threshold_std DECIMAL DEFAULT 2.0
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    v_mean DECIMAL;
    v_std DECIMAL;
    v_record RECORD;
BEGIN
    SELECT 
        AVG(total_cost), 
        STDDEV_POP(total_cost)
    INTO v_mean, v_std
    FROM daily_usage_agg
    WHERE usage_date >= NOW() - INTERVAL '30 days';

    FOR v_record IN
        SELECT 
            usage_date,
            total_cost,
            (total_cost - v_mean) / NULLIF(v_std, 0) AS z_score
        FROM daily_usage_agg
        WHERE usage_date >= NOW() - INTERVAL '30 days'
        AND ABS((total_cost - v_mean) / NULLIF(v_std, 0)) > p_threshold_std
    LOOP
        INSERT INTO anomaly_records (
            anomaly_type,
            severity,
            detected_value,
            expected_value,
            deviation_percentage,
            metric_name,
            detected_at
        ) VALUES (
            'cost_spike',
            CASE 
                WHEN ABS(v_record.z_score) > 3 THEN 'critical'
                WHEN ABS(v_record.z_score) > 2.5 THEN 'high'
                ELSE 'medium'
            END,
            v_record.total_cost,
            v_mean,
            v_record.z_score * 100,
            'daily_cost',
            v_record.usage_date
        ) ON CONFLICT DO NOTHING;
    END LOOP;
END;
$$;

-- ============================================================================
-- 7. ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE usage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_thresholds ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE anomaly_records ENABLE ROW LEVEL SECURITY;

-- USAGE EVENTS: Users see own data
CREATE POLICY "users_view_own_usage" ON usage_events
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "service_insert_usage" ON usage_events
    FOR INSERT WITH CHECK (true);

-- ALERT THRESHOLDS
CREATE POLICY "users_manage_own_alerts" ON alert_thresholds
    FOR ALL USING (auth.uid() = user_id);

-- SAVED REPORTS
CREATE POLICY "users_manage_own_reports" ON saved_reports
    FOR ALL USING (auth.uid() = user_id);

-- ANOMALY RECORDS: Admins only (simplified - full implementation would check user_roles)
CREATE POLICY "admins_view_anomalies" ON anomaly_records
    FOR SELECT USING (true);

COMMIT;

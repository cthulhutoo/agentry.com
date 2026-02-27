-- ============================================================================
-- Agentry.com Streaming Tables Migration
-- Version: 1.0
-- Description: Creates tables for streaming session tracking and rate limiting
-- ============================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- STREAMING SESSIONS TABLE
-- ============================================================================

-- Table: streaming_sessions
-- Tracks active streaming sessions for analytics and cleanup
CREATE TABLE IF NOT EXISTS streaming_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    council_id UUID, -- Optional council context
    agent_id UUID, -- Optional specific agent
    provider VARCHAR(20) NOT NULL,
    model VARCHAR(100) NOT NULL,
    status VARCHAR(20) DEFAULT 'connecting', -- connecting, streaming, completed, error, cancelled
    tokens_received INTEGER DEFAULT 0,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    error_code VARCHAR(50),
    error_message TEXT,
    metadata JSONB DEFAULT '{}'
);

-- Index for session analytics
CREATE INDEX IF NOT EXISTS idx_streaming_sessions_user ON streaming_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_streaming_sessions_council ON streaming_sessions(council_id);
CREATE INDEX IF NOT EXISTS idx_streaming_sessions_agent ON streaming_sessions(agent_id);
CREATE INDEX IF NOT EXISTS idx_streaming_sessions_status ON streaming_sessions(status);
CREATE INDEX IF NOT EXISTS idx_streaming_sessions_started ON streaming_sessions(started_at DESC);

-- ============================================================================
-- API RATE LIMITS TABLE
-- ============================================================================

-- Table: api_rate_limits
-- Per-user rate limiting for streaming endpoints
CREATE TABLE IF NOT EXISTS api_rate_limits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    endpoint VARCHAR(100) NOT NULL,
    requests_count INTEGER DEFAULT 0,
    window_start TIMESTAMPTZ DEFAULT NOW(),
    window_duration INTERVAL DEFAULT '1 minute'::interval,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, endpoint, window_start)
);

-- Index for rate limiting queries
CREATE INDEX IF NOT EXISTS idx_rate_limits_user_window ON api_rate_limits(user_id, window_start);

-- ============================================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================================

-- Enable RLS on streaming_sessions
ALTER TABLE streaming_sessions ENABLE ROW LEVEL SECURITY;

-- Enable RLS on api_rate_limits
ALTER TABLE api_rate_limits ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- RLS POLICIES FOR STREAMING SESSIONS
-- ============================================================================

-- Users can view their own sessions
DROP POLICY IF EXISTS "Users can view own sessions" ON streaming_sessions;
CREATE POLICY "Users can view own sessions" ON streaming_sessions
    FOR SELECT USING (auth.uid() = user_id);

-- Users can insert their own sessions
DROP POLICY IF EXISTS "Users can create own sessions" ON streaming_sessions;
CREATE POLICY "Users can create own sessions" ON streaming_sessions
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Users can update their own sessions
DROP POLICY IF EXISTS "Users can update own sessions" ON streaming_sessions;
CREATE POLICY "Users can update own sessions" ON streaming_sessions
    FOR UPDATE USING (auth.uid() = user_id);

-- Users can delete their own sessions
DROP POLICY IF EXISTS "Users can delete own sessions" ON streaming_sessions;
CREATE POLICY "Users can delete own sessions" ON streaming_sessions
    FOR DELETE USING (auth.uid() = user_id);

-- ============================================================================
-- RLS POLICIES FOR API RATE LIMITS
-- ============================================================================

-- Users can view their own rate limits
DROP POLICY IF EXISTS "Users can view own rate limits" ON api_rate_limits;
CREATE POLICY "Users can view own rate limits" ON api_rate_limits
    FOR SELECT USING (auth.uid() = user_id);

-- Users can insert their own rate limits
DROP POLICY IF EXISTS "Users can create own rate limits" ON api_rate_limits;
CREATE POLICY "Users can create own rate limits" ON api_rate_limits
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Users can update their own rate limits
DROP POLICY IF EXISTS "Users can update own rate limits" ON api_rate_limits;
CREATE POLICY "Users can update own rate limits" ON api_rate_limits
    FOR UPDATE USING (auth.uid() = user_id);

-- Users can delete their own rate limits
DROP POLICY IF EXISTS "Users can delete own rate limits" ON api_rate_limits;
CREATE POLICY "Users can delete own rate limits" ON api_rate_limits
    FOR DELETE USING (auth.uid() = user_id);

-- ============================================================================
-- SERVICE ROLE PERMISSIONS
-- ============================================================================

-- Grant service role access to streaming_sessions for edge functions
GRANT ALL ON streaming_sessions TO service_role;
GRANT ALL ON streaming_sessions TO authenticated;

-- Grant service role access to api_rate_limits for edge functions
GRANT ALL ON api_rate_limits TO service_role;
GRANT ALL ON api_rate_limits TO authenticated;

-- Grant sequence usage for UUID generation
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;


-- ============================================================================
-- COMMENTS FOR DOCUMENTATION
-- ============================================================================

COMMENT ON TABLE streaming_sessions IS 'Tracks active streaming sessions for analytics and cleanup';
COMMENT ON TABLE api_rate_limits IS 'Per-user rate limiting for streaming endpoints';
COMMENT ON COLUMN streaming_sessions.status IS 'Session status: connecting, streaming, completed, error, cancelled';
COMMENT ON COLUMN streaming_sessions.tokens_received IS 'Number of tokens received in this session';
COMMENT ON COLUMN api_rate_limits.requests_count IS 'Number of requests in current rate limit window';
COMMENT ON COLUMN api_rate_limits.window_start IS 'Start time of current rate limit window';
COMMENT ON COLUMN api_rate_limits.window_duration IS 'Duration of rate limit window (default: 1 minute)';

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================

SELECT 'Streaming tables migration completed successfully' AS status;

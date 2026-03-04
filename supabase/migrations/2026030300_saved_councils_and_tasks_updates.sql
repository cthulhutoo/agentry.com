-- ============================================================================
-- Agentry.com Saved Councils and Tasks Updates Migration
-- Version: 1.0
-- Description: Adds saved councils functionality and updates tasks table for individual agent workflow
-- ============================================================================

-- ============================================================================
-- SAVED COUNCILS TABLE
-- ============================================================================

-- Table: saved_councils
-- User-saved agent council configurations
CREATE TABLE IF NOT EXISTS saved_councils (
  id UUID PRIMARY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  agent_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for saved_councils
CREATE INDEX IF NOT EXISTS idx_saved_councils_user_id ON saved_councils(user_id);
CREATE INDEX IF NOT EXISTS idx_saved_councils_created_at ON saved_councils(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_saved_councils_is_default ON saved_councils(user_id, is_default);

-- Enable RLS on saved_councils
ALTER TABLE saved_councils ENABLE ROW LEVEL SECURITY;

-- RLS Policies for saved_councils
CREATE POLICY "Users can view own saved councils" ON saved_councils
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create own saved councils" ON saved_councils
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own saved councils" ON saved_councils
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own saved councils" ON saved_councils
  FOR DELETE USING (auth.uid() = user_id);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_saved_councils_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at
DROP TRIGGER IF EXISTS saved_councils_updated_at_trigger ON saved_councils;
CREATE TRIGGER saved_councils_updated_at_trigger
  BEFORE UPDATE ON saved_councils
  FOR EACH ROW
  EXECUTE FUNCTION update_saved_councils_updated_at();

-- ============================================================================
-- TASKS TABLE UPDATES
-- ============================================================================

-- Add columns to existing tasks table for individual agent workflow
-- These additions are compatible with existing council-based workflow

-- Add agent_type column for individual agent tasks
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS agent_type TEXT;

-- Add result column (text) as alternative to results (jsonb) for individual agent responses
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS result TEXT;

-- Add credits_used column for tracking credit consumption
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS credits_used INTEGER DEFAULT 0;

-- Add rating column for user feedback
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS rating INTEGER CHECK (rating >= 1 AND rating <= 5);

-- Add archived status
ALTER TABLE tasks ADD CONSTRAINT tasks_status_check
  CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'archived'));

-- Add metadata JSONB for flexible storage
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

-- Add indexes for common queries
CREATE INDEX IF NOT EXISTS idx_tasks_agent_type ON tasks(agent_type) WHERE agent_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_user_status ON tasks(user_id, status) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_credits_used ON tasks(credits_used) WHERE credits_used > 0;
CREATE INDEX IF NOT EXISTS idx_tasks_rating ON tasks(rating) WHERE rating IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at DESC);

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Function to create a task for an individual agent
CREATE OR REPLACE FUNCTION create_individual_task(
  p_user_id UUID,
  p_agent_type TEXT,
  p_prompt TEXT,
  p_credits_required INTEGER DEFAULT 1
)
RETURNS UUID AS $$
DECLARE
  v_task_id UUID;
BEGIN
  INSERT INTO tasks (user_id, agent_type, prompt, status, credits_used)
  VALUES (
    p_user_id,
    p_agent_type,
    p_prompt,
    'processing',
    p_credits_required
  )
  RETURNING id INTO v_task_id;
  
  RETURN v_task_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to update task completion
CREATE OR REPLACE FUNCTION complete_task(
  p_task_id UUID,
  p_result TEXT,
  p_success BOOLEAN DEFAULT true
)
RETURNS VOID AS $$
BEGIN
  UPDATE tasks
  SET 
    result = p_result,
    status = CASE WHEN p_success THEN 'completed' ELSE 'failed' END,
    completed_at = NOW()
  WHERE id = p_task_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to rate a task
CREATE OR REPLACE FUNCTION rate_task(
  p_task_id UUID,
  p_rating INTEGER
)
RETURNS BOOLEAN AS $$
DECLARE
  v_user_id UUID;
BEGIN
  -- Verify user owns the task
  SELECT user_id INTO v_user_id FROM tasks WHERE id = p_task_id;
  
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Task not found';
  END IF;
  
  IF v_user_id != auth.uid() THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;
  
  -- Update rating
  UPDATE tasks
  SET rating = p_rating
  WHERE id = p_task_id;
  
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to archive a task
CREATE OR REPLACE FUNCTION archive_task(p_task_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE tasks
  SET status = 'archived'
  WHERE id = p_task_id AND user_id = auth.uid();
  
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get task statistics for a user
CREATE OR REPLACE FUNCTION get_user_task_stats(p_user_id UUID)
RETURNS TABLE (
  total_tasks BIGINT,
  completed_tasks BIGINT,
  failed_tasks BIGINT,
  pending_tasks BIGINT,
  total_credits_used BIGINT,
  avg_rating NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*) FILTER (WHERE status != 'archived')::BIGINT as total_tasks,
    COUNT(*) FILTER (WHERE status = 'completed')::BIGINT as completed_tasks,
    COUNT(*) FILTER (WHERE status = 'failed')::BIGINT as failed_tasks,
    COUNT(*) FILTER (WHERE status IN ('pending', 'processing'))::BIGINT as pending_tasks,
    COALESCE(SUM(credits_used), 0)::BIGINT as total_credits_used,
    AVG(rating)::NUMERIC as avg_rating
  FROM tasks
  WHERE user_id = p_user_id AND status != 'archived';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================

-- Insert comments for documentation
COMMENT ON TABLE saved_councils IS 'User-saved agent council configurations for quick access';
COMMENT ON COLUMN saved_councils.agent_ids IS 'Array of agent UUIDs in the council';
COMMENT ON COLUMN saved_councils.is_default IS 'Whether this is the user''s default council';

COMMENT ON COLUMN tasks.agent_type IS 'Individual agent type (for non-council tasks)';
COMMENT ON COLUMN tasks.result IS 'Text result from individual agent (alternative to results JSONB)';
COMMENT ON COLUMN tasks.credits_used IS 'Number of credits consumed by this task';
COMMENT ON COLUMN tasks.rating IS 'User rating from 1-5 stars';
COMMENT ON COLUMN tasks.metadata IS 'Additional task metadata (platform, tone, etc.)';

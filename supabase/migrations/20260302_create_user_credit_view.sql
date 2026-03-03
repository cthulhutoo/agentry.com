-- Migration: Create unified view for user credit data
-- This migration creates a view that consolidates user_accounts and user_credits
-- to provide a single interface for accessing user credit information

-- Drop existing view if it exists
DROP VIEW IF EXISTS user_credits_view;

-- Create a unified view that joins user_accounts and user_credits
CREATE OR REPLACE VIEW user_credits_view AS
SELECT
  ua.id as user_account_id,
  ua.user_id,
  ua.created_at as account_created_at,
  ua.updated_at as account_updated_at,
  COALESCE(uc.credits, 0) as credits,
  uc.created_at as credits_created_at,
  uc.updated_at as credits_updated_at,
  -- Combine timestamps for last activity
  GREATEST(
    ua.updated_at,
    COALESCE(uc.updated_at, ua.created_at)
  ) as last_activity
FROM user_accounts ua
LEFT JOIN user_credits uc ON ua.user_id = uc.user_id;

-- Grant permissions on the view
GRANT SELECT ON user_credits_view TO authenticated;
GRANT SELECT ON user_credits_view TO anon;

-- Add comment to document the purpose
COMMENT ON VIEW user_credits_view IS 'Unified view consolidating user_accounts and user_credits tables. Provides single interface for user credit information.';

-- Create a function to ensure credit record exists for users
CREATE OR REPLACE FUNCTION ensure_user_credits_record()
RETURNS TRIGGER AS $$
BEGIN
  -- When a new user is created, ensure a credit record exists
  INSERT INTO user_credits (user_id, credits)
  VALUES (NEW.id, 0)
  ON CONFLICT (user_id) DO NOTHING;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger to automatically create credit record on user signup
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION ensure_user_credits_record();

-- Add helpful indexes
CREATE INDEX IF NOT EXISTS idx_user_accounts_user_id ON user_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_user_credits_user_id ON user_credits(user_id);

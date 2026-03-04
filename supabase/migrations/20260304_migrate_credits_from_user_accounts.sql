-- Migration: Transfer credits from user_accounts to user_credits table
-- This migration handles the case where the old Stripe webhook wrote to user_accounts
-- but the frontend reads from user_credits

-- 1. Transfer credits for users who have credits in user_accounts but not in user_credits
INSERT INTO user_credits (user_id, credits, created_at, updated_at)
SELECT 
  ua.user_id,
  ua.credits,
  ua.created_at,
  ua.updated_at
FROM user_accounts ua
WHERE 
  ua.credits > 0
  AND NOT EXISTS (
    SELECT 1 FROM user_credits uc WHERE uc.user_id = ua.user_id
  )
ON CONFLICT (user_id) DO NOTHING;

-- 2. Update user_credits for users who have credits in both tables (sum them)
UPDATE user_credits uc
SET 
  credits = uc.credits + ua.credits,
  updated_at = GREATEST(uc.updated_at, ua.updated_at)
FROM user_accounts ua
WHERE 
  uc.user_id = ua.user_id
  AND ua.credits > 0;

-- 3. Verify the migration
DO $$
DECLARE
  uc_count INTEGER;
  uc_credits NUMERIC;
  ua_count INTEGER;
  ua_credits NUMERIC;
BEGIN
  SELECT COUNT(*), COALESCE(SUM(credits), 0) INTO uc_count, uc_credits
  FROM user_credits;
  
  SELECT COUNT(*), COALESCE(SUM(credits), 0) INTO ua_count, ua_credits
  FROM user_accounts WHERE credits > 0;
  
  RAISE NOTICE 'Migration verification:';
  RAISE NOTICE '  user_credits: % users with % total credits', uc_count, uc_credits;
  RAISE NOTICE '  user_accounts: % users with % total credits', ua_count, ua_credits;
END $$;

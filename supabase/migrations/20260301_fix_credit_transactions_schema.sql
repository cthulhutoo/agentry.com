-- Migration: Fix credit_transactions schema inconsistency
-- Add user_account_id column first
ALTER TABLE credit_transactions
ADD COLUMN IF NOT EXISTS user_account_id UUID REFERENCES user_accounts(id) ON DELETE SET NULL;


-- This migration adds the user_id column to support direct user references
-- while maintaining backward compatibility with user_account_id

-- Add user_id column if it doesn't exist
ALTER TABLE credit_transactions 
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_credit_transactions_user_id 
ON credit_transactions(user_id);

-- Drop existing RLS policies
DROP POLICY IF EXISTS "Users can view own transactions" ON credit_transactions;
DROP POLICY IF EXISTS "Users can insert own transactions" ON credit_transactions;

-- Create updated RLS policies that support both user_id and user_account_id
CREATE POLICY "Users can view own transactions"
ON credit_transactions FOR SELECT
TO authenticated
USING (
  user_id::text = (select auth.jwt()->>'sub') OR
  user_account_id IN (
    SELECT id FROM user_accounts WHERE user_id::text = (select auth.jwt()->>'sub')
  )
);

CREATE POLICY "Users can insert own transactions"
ON credit_transactions FOR INSERT
TO authenticated
WITH CHECK (
  user_id::text = (select auth.jwt()->>'sub')
);

-- Update existing records to populate user_id from user_accounts
UPDATE credit_transactions ct
SET user_id = ua.user_id
FROM user_accounts ua
WHERE ct.user_account_id = ua.id AND ct.user_id IS NULL;

-- Grant permission on user_accounts table for the join
GRANT SELECT ON user_accounts TO authenticated;

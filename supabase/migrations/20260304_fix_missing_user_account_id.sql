-- Add missing user_account_id column to credit_transactions table
ALTER TABLE credit_transactions
ADD COLUMN IF NOT EXISTS user_account_id UUID REFERENCES user_accounts(id) ON DELETE SET NULL;

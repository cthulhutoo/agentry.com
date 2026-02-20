/*
  # Fix Security Issues - Indexes and RLS Performance

  1. Add Missing Indexes
    - Add index on `credit_transactions.task_id` (foreign key)
    - Add index on `subscriptions.pricing_plan_id` (foreign key)
    - Add index on `tasks.council_id` (foreign key)

  2. Optimize RLS Policies
    - Replace all `auth.<function>()` calls with `(select auth.<function>())` to improve performance
    - This prevents re-evaluation of auth functions for each row
    - Affects policies on: councils, tasks, user_accounts, credit_transactions, subscriptions

  3. Fix Multiple Permissive Policies
    - Remove duplicate policy on email_signups table
    - Keep only the "Anyone can sign up" policy which is sufficient

  4. Security Notes
    - Indexes improve query performance on foreign key relationships
    - RLS optimization significantly improves performance at scale
    - Removing duplicate policies eliminates policy conflicts
*/

-- Add missing indexes for foreign keys
CREATE INDEX IF NOT EXISTS idx_credit_transactions_task_id ON credit_transactions(task_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_pricing_plan_id ON subscriptions(pricing_plan_id);
CREATE INDEX IF NOT EXISTS idx_tasks_council_id ON tasks(council_id);

-- Drop and recreate councils policies with optimized auth calls
DROP POLICY IF EXISTS "Users can view own councils" ON councils;
DROP POLICY IF EXISTS "Users can create councils" ON councils;
DROP POLICY IF EXISTS "Users can update own councils" ON councils;
DROP POLICY IF EXISTS "Users can delete own councils" ON councils;

CREATE POLICY "Users can view own councils"
  ON councils FOR SELECT
  TO authenticated
  USING (user_id::text = (select auth.jwt()->>'sub'));

CREATE POLICY "Users can create councils"
  ON councils FOR INSERT
  TO authenticated
  WITH CHECK (user_id::text = (select auth.jwt()->>'sub'));

CREATE POLICY "Users can update own councils"
  ON councils FOR UPDATE
  TO authenticated
  USING (user_id::text = (select auth.jwt()->>'sub'))
  WITH CHECK (user_id::text = (select auth.jwt()->>'sub'));

CREATE POLICY "Users can delete own councils"
  ON councils FOR DELETE
  TO authenticated
  USING (user_id::text = (select auth.jwt()->>'sub'));

-- Drop and recreate tasks policies with optimized auth calls
DROP POLICY IF EXISTS "Users can view own tasks" ON tasks;
DROP POLICY IF EXISTS "Users can create tasks" ON tasks;
DROP POLICY IF EXISTS "Users can update own tasks" ON tasks;

CREATE POLICY "Users can view own tasks"
  ON tasks FOR SELECT
  TO authenticated
  USING (user_id::text = (select auth.jwt()->>'sub'));

CREATE POLICY "Users can create tasks"
  ON tasks FOR INSERT
  TO authenticated
  WITH CHECK (user_id::text = (select auth.jwt()->>'sub'));

CREATE POLICY "Users can update own tasks"
  ON tasks FOR UPDATE
  TO authenticated
  USING (user_id::text = (select auth.jwt()->>'sub'))
  WITH CHECK (user_id::text = (select auth.jwt()->>'sub'));

-- Drop and recreate user_accounts policies with optimized auth calls
DROP POLICY IF EXISTS "Users can view own account" ON user_accounts;
DROP POLICY IF EXISTS "Users can update own account" ON user_accounts;
DROP POLICY IF EXISTS "Users can insert own account" ON user_accounts;

CREATE POLICY "Users can view own account"
  ON user_accounts FOR SELECT
  TO authenticated
  USING (user_id::text = (select auth.jwt()->>'sub'));

CREATE POLICY "Users can update own account"
  ON user_accounts FOR UPDATE
  TO authenticated
  USING (user_id::text = (select auth.jwt()->>'sub'))
  WITH CHECK (user_id::text = (select auth.jwt()->>'sub'));

CREATE POLICY "Users can insert own account"
  ON user_accounts FOR INSERT
  TO authenticated
  WITH CHECK (user_id::text = (select auth.jwt()->>'sub'));

-- Drop and recreate credit_transactions policies with optimized auth calls
DROP POLICY IF EXISTS "Users can view own transactions" ON credit_transactions;
DROP POLICY IF EXISTS "Users can insert own transactions" ON credit_transactions;

CREATE POLICY "Users can view own transactions"
  ON credit_transactions FOR SELECT
  TO authenticated
  USING (
    user_account_id IN (
      SELECT id FROM user_accounts WHERE user_id::text = (select auth.jwt()->>'sub')
    )
  );

CREATE POLICY "Users can insert own transactions"
  ON credit_transactions FOR INSERT
  TO authenticated
  WITH CHECK (
    user_account_id IN (
      SELECT id FROM user_accounts WHERE user_id::text = (select auth.jwt()->>'sub')
    )
  );

-- Drop and recreate subscriptions policies with optimized auth calls
DROP POLICY IF EXISTS "Users can view own subscriptions" ON subscriptions;
DROP POLICY IF EXISTS "Users can manage own subscriptions" ON subscriptions;

CREATE POLICY "Users can view own subscriptions"
  ON subscriptions FOR SELECT
  TO authenticated
  USING (
    user_account_id IN (
      SELECT id FROM user_accounts WHERE user_id::text = (select auth.jwt()->>'sub')
    )
  );

CREATE POLICY "Users can manage own subscriptions"
  ON subscriptions FOR UPDATE
  TO authenticated
  USING (
    user_account_id IN (
      SELECT id FROM user_accounts WHERE user_id::text = (select auth.jwt()->>'sub')
    )
  )
  WITH CHECK (
    user_account_id IN (
      SELECT id FROM user_accounts WHERE user_id::text = (select auth.jwt()->>'sub')
    )
  );

-- Fix multiple permissive policies on email_signups
-- Drop the service role policy since "Anyone can sign up" is sufficient
DROP POLICY IF EXISTS "Service role can manage signups" ON email_signups;
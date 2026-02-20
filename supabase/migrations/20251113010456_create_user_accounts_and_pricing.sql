/*
  # User Accounts, Credits, and Pricing System

  1. New Tables
    - `user_accounts`
      - `id` (uuid, primary key)
      - `user_id` (uuid, references auth.users, unique)
      - `credits` (numeric, default 0) - User's current credit balance
      - `total_spent` (numeric, default 0) - Total amount spent by user
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)
    
    - `credit_transactions`
      - `id` (uuid, primary key)
      - `user_account_id` (uuid, references user_accounts)
      - `amount` (numeric) - Positive for purchases, negative for usage
      - `type` (text) - 'purchase', 'usage', 'subscription', 'bonus'
      - `description` (text)
      - `task_id` (uuid, optional reference to tasks)
      - `created_at` (timestamptz)
    
    - `pricing_plans`
      - `id` (uuid, primary key)
      - `name` (text) - Plan name (e.g., 'Starter', 'Pro', 'Enterprise')
      - `description` (text)
      - `price` (numeric) - Monthly price in dollars
      - `credits` (numeric) - Credits included per month
      - `features` (jsonb) - Array of features
      - `is_active` (boolean, default true)
      - `sort_order` (integer, default 0)
      - `created_at` (timestamptz)
    
    - `credit_packages`
      - `id` (uuid, primary key)
      - `name` (text) - Package name (e.g., '100 Credits', '500 Credits')
      - `credits` (numeric) - Number of credits
      - `price` (numeric) - One-time price in dollars
      - `bonus_credits` (numeric, default 0) - Extra credits included
      - `is_active` (boolean, default true)
      - `sort_order` (integer, default 0)
      - `created_at` (timestamptz)
    
    - `subscriptions`
      - `id` (uuid, primary key)
      - `user_account_id` (uuid, references user_accounts)
      - `pricing_plan_id` (uuid, references pricing_plans)
      - `status` (text) - 'active', 'cancelled', 'expired'
      - `started_at` (timestamptz)
      - `cancelled_at` (timestamptz, nullable)
      - `next_billing_date` (timestamptz)
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS on all tables
    - Add policies for authenticated users to manage their own data
    
  3. Important Notes
    - Credits are consumed when running council tasks
    - Users can purchase credits via packages or subscribe to monthly plans
    - Monthly plans automatically add credits on billing date
    - All financial transactions are tracked in credit_transactions
*/

-- Create user_accounts table
CREATE TABLE IF NOT EXISTS user_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE NOT NULL,
  credits numeric DEFAULT 0 CHECK (credits >= 0),
  total_spent numeric DEFAULT 0 CHECK (total_spent >= 0),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE user_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own account"
  ON user_accounts FOR SELECT
  TO authenticated
  USING (user_id::text = auth.jwt()->>'sub');

CREATE POLICY "Users can update own account"
  ON user_accounts FOR UPDATE
  TO authenticated
  USING (user_id::text = auth.jwt()->>'sub')
  WITH CHECK (user_id::text = auth.jwt()->>'sub');

-- Create credit_transactions table
CREATE TABLE IF NOT EXISTS credit_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_account_id uuid NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  amount numeric NOT NULL,
  type text NOT NULL CHECK (type IN ('purchase', 'usage', 'subscription', 'bonus')),
  description text DEFAULT '',
  task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE credit_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own transactions"
  ON credit_transactions FOR SELECT
  TO authenticated
  USING (
    user_account_id IN (
      SELECT id FROM user_accounts WHERE user_id::text = auth.jwt()->>'sub'
    )
  );

CREATE POLICY "Users can insert own transactions"
  ON credit_transactions FOR INSERT
  TO authenticated
  WITH CHECK (
    user_account_id IN (
      SELECT id FROM user_accounts WHERE user_id::text = auth.jwt()->>'sub'
    )
  );

-- Create pricing_plans table
CREATE TABLE IF NOT EXISTS pricing_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text DEFAULT '',
  price numeric NOT NULL CHECK (price >= 0),
  credits numeric NOT NULL CHECK (credits >= 0),
  features jsonb DEFAULT '[]'::jsonb,
  is_active boolean DEFAULT true,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE pricing_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view active pricing plans"
  ON pricing_plans FOR SELECT
  TO public
  USING (is_active = true);

-- Create credit_packages table
CREATE TABLE IF NOT EXISTS credit_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  credits numeric NOT NULL CHECK (credits > 0),
  price numeric NOT NULL CHECK (price > 0),
  bonus_credits numeric DEFAULT 0 CHECK (bonus_credits >= 0),
  is_active boolean DEFAULT true,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE credit_packages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view active credit packages"
  ON credit_packages FOR SELECT
  TO public
  USING (is_active = true);

-- Create subscriptions table
CREATE TABLE IF NOT EXISTS subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_account_id uuid NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  pricing_plan_id uuid NOT NULL REFERENCES pricing_plans(id),
  status text DEFAULT 'active' CHECK (status IN ('active', 'cancelled', 'expired')),
  started_at timestamptz DEFAULT now(),
  cancelled_at timestamptz,
  next_billing_date timestamptz NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own subscriptions"
  ON subscriptions FOR SELECT
  TO authenticated
  USING (
    user_account_id IN (
      SELECT id FROM user_accounts WHERE user_id::text = auth.jwt()->>'sub'
    )
  );

CREATE POLICY "Users can manage own subscriptions"
  ON subscriptions FOR UPDATE
  TO authenticated
  USING (
    user_account_id IN (
      SELECT id FROM user_accounts WHERE user_id::text = auth.jwt()->>'sub'
    )
  )
  WITH CHECK (
    user_account_id IN (
      SELECT id FROM user_accounts WHERE user_id::text = auth.jwt()->>'sub'
    )
  );

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_user_accounts_user_id ON user_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_user_account_id ON credit_transactions(user_account_id);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_created_at ON credit_transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_account_id ON subscriptions(user_account_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);

-- Insert sample pricing plans
INSERT INTO pricing_plans (name, description, price, credits, features, sort_order) VALUES
  ('Starter', 'Perfect for trying out Agentry', 0, 10, '["10 credits per month", "Access to all agents", "Email support", "Community access"]'::jsonb, 1),
  ('Pro', 'For regular users who need more power', 29, 200, '["200 credits per month", "Priority agent access", "Priority email support", "Advanced analytics", "Custom councils"]'::jsonb, 2),
  ('Enterprise', 'For teams and power users', 99, 1000, '["1000 credits per month", "Dedicated support", "Custom agent builder", "Bring your own API keys", "Team collaboration", "Advanced analytics"]'::jsonb, 3)
ON CONFLICT DO NOTHING;

-- Insert sample credit packages
INSERT INTO credit_packages (name, credits, price, bonus_credits, sort_order) VALUES
  ('Starter Pack', 50, 10, 0, 1),
  ('Value Pack', 150, 25, 10, 2),
  ('Power Pack', 350, 50, 25, 3),
  ('Ultimate Pack', 1000, 120, 100, 4)
ON CONFLICT DO NOTHING;
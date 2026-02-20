/*
  # Create Email Signups Table

  ## Overview
  Stores email addresses for users who want to receive announcements about new agents and LLMs.

  ## New Tables
  
  ### `email_signups`
  - `id` (uuid, primary key) - Unique identifier
  - `email` (text, unique, not null) - User's email address
  - `subscribed` (boolean) - Whether still subscribed
  - `created_at` (timestamptz) - Signup timestamp
  - `unsubscribed_at` (timestamptz, nullable) - When they unsubscribed

  ## Security
  - Enable RLS on table
  - Anyone can insert (sign up)
  - Only service role can read/update (for admin purposes)
*/

CREATE TABLE IF NOT EXISTS email_signups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  subscribed boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  unsubscribed_at timestamptz
);

ALTER TABLE email_signups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can sign up"
  ON email_signups FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Service role can manage signups"
  ON email_signups FOR ALL
  USING (false);

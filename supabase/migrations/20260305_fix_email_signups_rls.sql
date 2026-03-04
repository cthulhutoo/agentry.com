-- Fix: Restore RLS policy for email_signups table
-- This policy was dropped during migration cleanup and needs to be recreated

-- Enable RLS on email_signups table (if not already enabled)
ALTER TABLE email_signups ENABLE ROW LEVEL SECURITY;

-- Drop any existing policies to avoid conflicts
DROP POLICY IF EXISTS "Anyone can sign up" ON email_signups;
DROP POLICY IF EXISTS "Service role can manage signups" ON email_signups;

-- Create policy to allow anyone (including anonymous users) to sign up
CREATE POLICY "Anyone can sign up"
  ON email_signups FOR INSERT
  WITH CHECK (true);

-- Create policy to allow service role to manage signups (for admin purposes)
CREATE POLICY "Service role can manage signups"
  ON email_signups FOR ALL
  USING (auth.role() = 'service_role');

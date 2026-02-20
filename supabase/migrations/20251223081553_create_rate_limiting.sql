/*
  # Add Rate Limiting Infrastructure

  1. New Tables
    - `api_rate_limits`
      - `id` (uuid, primary key) - Unique identifier for each rate limit entry
      - `identifier` (text) - IP address, user ID, or API key hash for tracking requests
      - `endpoint` (text) - The API endpoint being rate limited (e.g., 'process-council-task')
      - `request_count` (integer) - Number of requests made in the current window
      - `window_start` (timestamptz) - Start time of the current rate limit window
      - `last_request_at` (timestamptz) - Timestamp of the most recent request
      - `created_at` (timestamptz) - When this rate limit entry was first created
      - `updated_at` (timestamptz) - Last time this entry was updated

  2. Security
    - Enable RLS on `api_rate_limits` table
    - Add policy for service role to manage rate limit data
    - Add index on identifier and endpoint for fast lookups

  3. Notes
    - Rate limits are enforced per identifier (IP/user) per endpoint
    - Default window is 60 seconds with configurable request limits
    - Old entries are automatically cleaned up after 24 hours
*/

CREATE TABLE IF NOT EXISTS api_rate_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier text NOT NULL,
  endpoint text NOT NULL,
  request_count integer DEFAULT 1,
  window_start timestamptz DEFAULT now(),
  last_request_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(identifier, endpoint)
);

ALTER TABLE api_rate_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage rate limits"
  ON api_rate_limits
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_rate_limits_lookup 
  ON api_rate_limits(identifier, endpoint, window_start);

CREATE INDEX IF NOT EXISTS idx_rate_limits_cleanup 
  ON api_rate_limits(created_at);

CREATE OR REPLACE FUNCTION cleanup_old_rate_limits()
RETURNS void AS $$
BEGIN
  DELETE FROM api_rate_limits
  WHERE created_at < now() - interval '24 hours';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
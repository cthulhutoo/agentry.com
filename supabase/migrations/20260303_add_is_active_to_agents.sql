-- Migration: Add missing is_active column to agents table
-- This fixes the schema mismatch where the table exists but lacks the is_active column

-- Add the is_active column if it doesn't exist
ALTER TABLE agents 
ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true;

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_agents_is_active 
ON agents(is_active);

-- Set all existing agents to active
UPDATE agents SET is_active = true WHERE is_active IS NULL;

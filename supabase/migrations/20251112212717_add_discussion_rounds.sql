/*
  # Add Discussion Rounds Support

  ## Overview
  Enables multi-round consensus-building discussions where agents can see and respond to each other's contributions.

  ## Changes
  
  1. Table Modifications
    - Add `discussion_rounds` column to tasks table to store iterative discussion data
    - Add `current_round` column to track which round of discussion is active
    - Add `max_rounds` column to set discussion depth
    
  ## Structure
  
  Each round in `discussion_rounds` contains:
  - `round_number` (integer) - Which iteration this is
  - `agent_responses` (array) - All agent contributions in this round
  - `timestamp` (string) - When the round completed
  
  ## Security
  - No RLS changes needed (inherits from tasks table)
*/

-- Add discussion rounds support to tasks table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tasks' AND column_name = 'discussion_rounds'
  ) THEN
    ALTER TABLE tasks ADD COLUMN discussion_rounds jsonb DEFAULT '[]'::jsonb;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tasks' AND column_name = 'current_round'
  ) THEN
    ALTER TABLE tasks ADD COLUMN current_round integer DEFAULT 1;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tasks' AND column_name = 'max_rounds'
  ) THEN
    ALTER TABLE tasks ADD COLUMN max_rounds integer DEFAULT 3;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tasks' AND column_name = 'consensus_summary'
  ) THEN
    ALTER TABLE tasks ADD COLUMN consensus_summary text DEFAULT '';
  END IF;
END $$;

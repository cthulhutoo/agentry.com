/*
  # Fix User Accounts INSERT Policy

  1. Changes
    - Add INSERT policy for user_accounts table
    - Allows authenticated users to create their own account record
  
  2. Security
    - Users can only insert records where user_id matches their auth ID
    - Prevents users from creating accounts for other users
*/

-- Add policy for users to create their own account
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'user_accounts' 
    AND policyname = 'Users can insert own account'
  ) THEN
    CREATE POLICY "Users can insert own account"
      ON user_accounts FOR INSERT
      TO authenticated
      WITH CHECK (user_id::text = auth.jwt()->>'sub');
  END IF;
END $$;
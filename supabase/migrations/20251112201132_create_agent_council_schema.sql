/*
  # Agent Council Platform Schema

  ## Overview
  Creates the foundational schema for agentry.com - a platform for building custom AI agent councils.
  Users can select specialized agents, bundle them into councils, and task them with research and questions.

  ## New Tables

  ### `agents`
  Catalog of available AI agents with their capabilities and pricing
  - `id` (uuid, primary key) - Unique identifier
  - `name` (text) - Agent name
  - `description` (text) - What the agent does
  - `specialty` (text) - Core expertise area
  - `llm_provider` (text) - Underlying LLM service (openai, anthropic, etc)
  - `llm_model` (text) - Specific model used
  - `base_price` (numeric) - Price per query
  - `capabilities` (jsonb) - Array of capability tags
  - `avatar_url` (text) - Agent avatar image
  - `is_active` (boolean) - Whether available for selection
  - `created_at` (timestamptz) - Creation timestamp

  ### `councils`
  User-created combinations of agents
  - `id` (uuid, primary key) - Unique identifier
  - `user_id` (uuid, nullable) - Owner (null for anonymous sessions)
  - `name` (text) - Council name
  - `description` (text) - Purpose/use case
  - `agent_ids` (jsonb) - Array of selected agent IDs
  - `total_price` (numeric) - Bundled pricing
  - `created_at` (timestamptz) - Creation timestamp
  - `updated_at` (timestamptz) - Last modification

  ### `tasks`
  Questions/research tasks submitted to councils
  - `id` (uuid, primary key) - Unique identifier
  - `council_id` (uuid, foreign key) - Associated council
  - `user_id` (uuid, nullable) - Submitter
  - `prompt` (text) - User's question/request
  - `status` (text) - pending, processing, completed, failed
  - `results` (jsonb) - Agent responses
  - `created_at` (timestamptz) - Submission time
  - `completed_at` (timestamptz, nullable) - Completion time

  ## Security
  - Enable RLS on all tables
  - Public read access to agents catalog
  - Users can manage their own councils and tasks
  - Anonymous users can create temporary councils (stored in session)

  ## Notes
  1. Agents table is populated with seed data for demo purposes
  2. Pricing supports bundle discounts (calculated in application logic)
  3. Tasks store individual agent responses in JSONB for flexibility
  4. Anonymous usage supported for demo/trial experience
*/

-- Create agents table
CREATE TABLE IF NOT EXISTS agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text NOT NULL,
  specialty text NOT NULL,
  llm_provider text NOT NULL,
  llm_model text NOT NULL,
  base_price numeric NOT NULL DEFAULT 0.10,
  capabilities jsonb DEFAULT '[]'::jsonb,
  avatar_url text DEFAULT '',
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Create councils table
CREATE TABLE IF NOT EXISTS councils (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  name text NOT NULL,
  description text DEFAULT '',
  agent_ids jsonb DEFAULT '[]'::jsonb,
  total_price numeric DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create tasks table
CREATE TABLE IF NOT EXISTS tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  council_id uuid REFERENCES councils(id) ON DELETE CASCADE,
  user_id uuid,
  prompt text NOT NULL,
  status text DEFAULT 'pending',
  results jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now(),
  completed_at timestamptz
);

-- Enable RLS
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE councils ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

-- Agents policies (public read access)
CREATE POLICY "Anyone can view active agents"
  ON agents FOR SELECT
  USING (is_active = true);

-- Councils policies
CREATE POLICY "Anyone can view councils"
  ON councils FOR SELECT
  USING (true);

CREATE POLICY "Anyone can create councils"
  ON councils FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Users can update own councils"
  ON councils FOR UPDATE
  USING (user_id IS NULL OR user_id = auth.uid())
  WITH CHECK (user_id IS NULL OR user_id = auth.uid());

CREATE POLICY "Users can delete own councils"
  ON councils FOR DELETE
  USING (user_id IS NULL OR user_id = auth.uid());

-- Tasks policies
CREATE POLICY "Users can view own tasks"
  ON tasks FOR SELECT
  USING (user_id IS NULL OR user_id = auth.uid());

CREATE POLICY "Anyone can create tasks"
  ON tasks FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Users can update own tasks"
  ON tasks FOR UPDATE
  USING (user_id IS NULL OR user_id = auth.uid())
  WITH CHECK (user_id IS NULL OR user_id = auth.uid());

-- Insert seed agents
INSERT INTO agents (name, description, specialty, llm_provider, llm_model, base_price, capabilities) VALUES
  ('Research Analyst', 'Deep dive researcher that finds and synthesizes information from multiple sources', 'Research & Analysis', 'anthropic', 'claude-3-5-sonnet', 0.25, '["research", "analysis", "synthesis", "fact-checking"]'::jsonb),
  ('Code Expert', 'Software engineering specialist for code review, debugging, and architecture', 'Software Development', 'openai', 'gpt-4-turbo', 0.20, '["coding", "debugging", "architecture", "code-review"]'::jsonb),
  ('Creative Writer', 'Generates engaging content, stories, and marketing copy', 'Content Creation', 'anthropic', 'claude-3-opus', 0.30, '["writing", "creativity", "storytelling", "copywriting"]'::jsonb),
  ('Data Scientist', 'Statistical analysis, data visualization, and predictive modeling', 'Data & Analytics', 'openai', 'gpt-4', 0.22, '["statistics", "data-analysis", "visualization", "ml"]'::jsonb),
  ('Business Strategist', 'Market analysis, competitive intelligence, and strategic planning', 'Business Strategy', 'anthropic', 'claude-3-5-sonnet', 0.28, '["strategy", "market-research", "business-planning"]'::jsonb),
  ('Legal Advisor', 'Legal research, contract analysis, and compliance guidance', 'Legal & Compliance', 'openai', 'gpt-4-turbo', 0.35, '["legal-research", "contracts", "compliance"]'::jsonb),
  ('Financial Analyst', 'Financial modeling, investment analysis, and risk assessment', 'Finance', 'anthropic', 'claude-3-opus', 0.32, '["finance", "modeling", "risk-analysis", "investment"]'::jsonb),
  ('UX Designer', 'User experience design, interface optimization, and usability testing', 'Design & UX', 'openai', 'gpt-4', 0.18, '["ux-design", "ui-design", "user-research", "prototyping"]'::jsonb),
  ('Marketing Guru', 'Campaign strategy, SEO optimization, and growth hacking', 'Marketing', 'anthropic', 'claude-3-5-sonnet', 0.24, '["marketing", "seo", "growth", "campaigns"]'::jsonb),
  ('Scientific Advisor', 'Scientific research, technical writing, and peer review', 'Science & Research', 'openai', 'gpt-4-turbo', 0.26, '["science", "research", "technical-writing", "peer-review"]'::jsonb),
  ('Product Manager', 'Product strategy, roadmap planning, and feature prioritization', 'Product Management', 'anthropic', 'claude-3-opus', 0.27, '["product-strategy", "roadmapping", "prioritization", "user-stories"]'::jsonb),
  ('Security Expert', 'Cybersecurity analysis, threat assessment, and security architecture', 'Security', 'openai', 'gpt-4-turbo', 0.30, '["security", "threat-analysis", "penetration-testing", "compliance"]'::jsonb)
ON CONFLICT DO NOTHING;

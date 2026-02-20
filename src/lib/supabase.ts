import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export interface Agent {
  id: string;
  name: string;
  description: string;
  specialty: string;
  llm_provider: string;
  llm_model: string;
  base_price: number;
  capabilities: string[];
  avatar_url: string;
  is_active: boolean;
  created_at: string;
}

export interface Council {
  id: string;
  user_id: string | null;
  name: string;
  description: string;
  agent_ids: string[];
  total_price: number;
  created_at: string;
  updated_at: string;
}

export interface Task {
  id: string;
  council_id: string;
  user_id: string | null;
  prompt: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  results: AgentResponse[];
  created_at: string;
  completed_at: string | null;
}

export interface AgentResponse {
  agent_id: string;
  agent_name: string;
  response: string;
  timestamp: string;
}

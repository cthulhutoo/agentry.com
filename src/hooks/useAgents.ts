import { useState, useEffect } from 'react';
import { supabase, Agent } from '../lib/supabase';

export function useAgents() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAgents();
  }, []);

  async function fetchAgents() {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('agents')
        .select('*')
        .eq('is_active', true)
        .order('specialty', { ascending: true });

      if (error) throw error;
      setAgents(data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch agents');
    } finally {
      setLoading(false);
    }
  }

  return { agents, loading, error, refetch: fetchAgents };
}

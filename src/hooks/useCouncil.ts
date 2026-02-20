import { useState } from 'react';
import { supabase, Council, Agent } from '../lib/supabase';

export function useCouncil() {
  const [selectedAgents, setSelectedAgents] = useState<Agent[]>([]);
  const [saving, setSaving] = useState(false);

  const toggleAgent = (agent: Agent) => {
    setSelectedAgents(prev => {
      const exists = prev.find(a => a.id === agent.id);
      if (exists) {
        return prev.filter(a => a.id !== agent.id);
      } else {
        return [...prev, agent];
      }
    });
  };

  const calculateTotalPrice = () => {
    const baseTotal = selectedAgents.reduce((sum, agent) => sum + agent.base_price, 0);
    const discount = selectedAgents.length >= 5 ? 0.15 : selectedAgents.length >= 3 ? 0.10 : 0;
    return baseTotal * (1 - discount);
  };

  const getDiscount = () => {
    if (selectedAgents.length >= 5) return 15;
    if (selectedAgents.length >= 3) return 10;
    return 0;
  };

  const saveCouncil = async (name: string, description: string) => {
    try {
      setSaving(true);
      const { data, error } = await supabase
        .from('councils')
        .insert({
          name,
          description,
          agent_ids: selectedAgents.map(a => a.id),
          total_price: calculateTotalPrice(),
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (err) {
      throw err;
    } finally {
      setSaving(false);
    }
  };

  const clearCouncil = () => {
    setSelectedAgents([]);
  };

  return {
    selectedAgents,
    toggleAgent,
    calculateTotalPrice,
    getDiscount,
    saveCouncil,
    clearCouncil,
    saving,
  };
}

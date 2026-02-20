import { Check, Plus } from 'lucide-react';
import { Agent } from '../lib/supabase';

interface AgentCardProps {
  agent: Agent;
  isSelected: boolean;
  onToggle: () => void;
}

const providerColors = {
  openai: 'from-emerald-500 to-teal-600',
  anthropic: 'from-orange-500 to-amber-600',
  google: 'from-blue-500 to-sky-600',
};

export function AgentCard({ agent, isSelected, onToggle }: AgentCardProps) {
  const providerColor = providerColors[agent.llm_provider as keyof typeof providerColors] || 'from-gray-500 to-gray-600';

  return (
    <div
      onClick={onToggle}
      className={`relative group cursor-pointer rounded-xl border-2 transition-all duration-200 hover:scale-102 hover:shadow-lg ${
        isSelected
          ? 'border-cyan-500 bg-cyan-50 shadow-md'
          : 'border-slate-200 bg-white hover:border-slate-300'
      }`}
    >
      <div className="p-5">
        <div className="flex items-start justify-between mb-3">
          <div className={`w-12 h-12 rounded-lg bg-gradient-to-br ${providerColor} flex items-center justify-center text-white font-bold text-lg shadow-md`}>
            {agent.name.charAt(0)}
          </div>
          <button
            className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
              isSelected
                ? 'bg-cyan-500 text-white'
                : 'bg-slate-100 text-slate-400 group-hover:bg-slate-200'
            }`}
          >
            {isSelected ? <Check className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          </button>
        </div>

        <h3 className="font-semibold text-slate-900 text-lg mb-1">{agent.name}</h3>
        <p className="text-sm text-cyan-600 font-medium mb-2">{agent.specialty}</p>
        <p className="text-sm text-slate-600 mb-3 line-clamp-2">{agent.description}</p>

        <div className="flex flex-wrap gap-1.5 mb-3">
          {agent.capabilities.slice(0, 3).map((cap) => (
            <span
              key={cap}
              className="px-2 py-1 text-xs font-medium bg-slate-100 text-slate-700 rounded"
            >
              {cap}
            </span>
          ))}
        </div>

        <div className="flex items-center justify-between pt-3 border-t border-slate-200">
          <span className="text-xs text-slate-500 capitalize">{agent.llm_provider} • {agent.llm_model}</span>
          <span className="text-lg font-bold text-slate-900">${agent.base_price.toFixed(2)}</span>
        </div>
      </div>
    </div>
  );
}

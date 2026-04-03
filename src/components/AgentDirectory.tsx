import { useState, useMemo } from 'react';
import { Search, Shield, Filter } from 'lucide-react';
import { Agent } from '../lib/supabase';
import { useAgents } from '../hooks/useAgents';
import { AgentDetailPanel } from './AgentDetailPanel';

const providerColors: Record<string, string> = {
  openai: 'from-emerald-500 to-teal-600',
  anthropic: 'from-orange-500 to-amber-600',
  google: 'from-blue-500 to-sky-600',
};

type ProtocolFilter = 'a2a' | 'mcp' | 'ucp' | 'verified';

export function AgentDirectory() {
  const { agents, loading, error } = useAgents();
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilters, setActiveFilters] = useState<Set<ProtocolFilter>>(new Set());
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);

  const toggleFilter = (filter: ProtocolFilter) => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(filter)) {
        next.delete(filter);
      } else {
        next.add(filter);
      }
      return next;
    });
  };

  const filteredAgents = useMemo(() => {
    return agents.filter((agent) => {
      // Search filter
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const matchesSearch =
          agent.name.toLowerCase().includes(q) ||
          agent.description.toLowerCase().includes(q) ||
          agent.specialty.toLowerCase().includes(q) ||
          agent.capabilities.some((c) => c.toLowerCase().includes(q));
        if (!matchesSearch) return false;
      }

      // Protocol filters (AND logic — agent must match ALL active filters)
      if (activeFilters.has('a2a') && !agent.a2a_enabled) return false;
      if (activeFilters.has('mcp') && !agent.mcp_enabled) return false;
      if (activeFilters.has('ucp') && !agent.ucp_capabilities?.enabled) return false;
      if (activeFilters.has('verified') && !agent.verified) return false;

      return true;
    });
  }, [agents, searchQuery, activeFilters]);

  const filterButtons: { key: ProtocolFilter; label: string; activeClass: string }[] = [
    {
      key: 'a2a',
      label: 'A2A',
      activeClass: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/40',
    },
    {
      key: 'mcp',
      label: 'MCP',
      activeClass: 'bg-blue-500/20 text-blue-400 border-blue-500/40',
    },
    {
      key: 'ucp',
      label: 'UCP',
      activeClass: 'bg-amber-500/20 text-amber-400 border-amber-500/40',
    },
    {
      key: 'verified',
      label: 'Verified',
      activeClass: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40',
    },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-4 border-white/20 border-t-violet-400 rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-20">
        <p className="text-red-400">{error}</p>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-white mb-1">Agent Directory</h2>
        <p className="text-white/60 text-sm">Browse and discover agents by protocol capabilities</p>
      </div>

      {/* Search + Filters */}
      <div className="mb-6 space-y-3">
        {/* Search bar */}
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search agents by name, specialty, or capability..."
            className="w-full pl-10 pr-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-violet-500/50 focus:border-violet-500/50 text-sm"
          />
        </div>

        {/* Filter buttons */}
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-white/40" />
          {filterButtons.map(({ key, label, activeClass }) => (
            <button
              key={key}
              type="button"
              onClick={() => toggleFilter(key)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-full border transition-all ${
                activeFilters.has(key)
                  ? activeClass
                  : 'border-white/10 text-white/50 hover:text-white/70 hover:border-white/20'
              }`}
            >
              {label}
            </button>
          ))}
          {activeFilters.size > 0 && (
            <button
              type="button"
              onClick={() => setActiveFilters(new Set())}
              className="px-3 py-1.5 text-xs text-white/40 hover:text-white/60 transition-colors"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Results count */}
      <div className="mb-4">
        <span className="text-xs text-white/40">
          {filteredAgents.length} {filteredAgents.length === 1 ? 'agent' : 'agents'}
          {activeFilters.size > 0 || searchQuery ? ' found' : ''}
        </span>
      </div>

      {/* Agent Cards Grid */}
      {filteredAgents.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-white/50">No agents match your filters.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredAgents.map((agent) => (
            <DirectoryCard
              key={agent.id}
              agent={agent}
              onClick={() => setSelectedAgent(agent)}
            />
          ))}
        </div>
      )}

      {/* Detail Panel */}
      {selectedAgent && (
        <AgentDetailPanel
          agent={selectedAgent}
          onClose={() => setSelectedAgent(null)}
        />
      )}
    </div>
  );
}

function DirectoryCard({ agent, onClick }: { agent: Agent; onClick: () => void }) {
  const providerColor =
    providerColors[agent.llm_provider] || 'from-gray-500 to-gray-600';

  const hasProtocols = agent.a2a_enabled || agent.mcp_enabled || agent.ucp_capabilities?.enabled;

  return (
    <div
      onClick={onClick}
      className="group cursor-pointer rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20 transition-all duration-200 hover:shadow-lg hover:shadow-purple-500/5"
    >
      <div className="p-5">
        {/* Top row: avatar + badges */}
        <div className="flex items-start justify-between mb-3">
          <div
            className={`w-11 h-11 rounded-lg bg-gradient-to-br ${providerColor} flex items-center justify-center text-white font-bold text-lg shadow-md`}
          >
            {agent.name.charAt(0)}
          </div>

          {/* Protocol badges */}
          {hasProtocols && (
            <div className="flex items-center gap-1.5">
              {agent.a2a_enabled && (
                <span className="badge-a2a px-2 py-0.5 text-[10px] font-bold rounded-full bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
                  A2A
                </span>
              )}
              {agent.mcp_enabled && (
                <span className="badge-mcp px-2 py-0.5 text-[10px] font-bold rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30">
                  MCP
                </span>
              )}
              {agent.ucp_capabilities?.enabled && (
                <span className="badge-ucp px-2 py-0.5 text-[10px] font-bold rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30">
                  UCP
                </span>
              )}
            </div>
          )}
        </div>

        {/* Name + specialty */}
        <h3 className="font-semibold text-white text-base mb-0.5 group-hover:text-violet-300 transition-colors">
          {agent.name}
        </h3>
        <p className="text-xs text-violet-400 font-medium mb-2">{agent.specialty}</p>
        <p className="text-xs text-white/50 mb-3 line-clamp-2">{agent.description}</p>

        {/* Capability tags */}
        <div className="flex flex-wrap gap-1 mb-3">
          {agent.capabilities.slice(0, 3).map((cap) => (
            <span
              key={cap}
              className="px-2 py-0.5 text-[10px] font-medium bg-white/10 text-white/60 rounded"
            >
              {cap}
            </span>
          ))}
          {agent.capabilities.length > 3 && (
            <span className="px-2 py-0.5 text-[10px] text-white/40">
              +{agent.capabilities.length - 3}
            </span>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-3 border-t border-white/10">
          <div className="flex items-center gap-2">
            <span className="text-xs text-white/40 capitalize">{agent.llm_provider}</span>
            {agent.verified && (
              <span className="inline-flex items-center gap-0.5 text-[10px] text-emerald-400">
                <Shield className="w-3 h-3" />
                Verified
              </span>
            )}
          </div>
          <span className="text-sm font-bold text-white">${agent.base_price.toFixed(2)}</span>
        </div>
      </div>
    </div>
  );
}

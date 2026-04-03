import { X, ExternalLink, CheckCircle2, AlertCircle, MinusCircle, Globe, Shield } from 'lucide-react';
import { Agent } from '../lib/supabase';

interface AgentDetailPanelProps {
  agent: Agent;
  onClose: () => void;
}

const UCP_CAPABILITY_LABELS: Record<string, string> = {
  'dev.ucp.shopping.checkout': 'Checkout',
  'dev.ucp.shopping.fulfillment': 'Fulfillment',
  'dev.ucp.common.identity_linking': 'Identity Linking',
  'dev.ucp.shopping.catalog': 'Catalog',
  'dev.ucp.shopping.cart': 'Cart',
  'dev.ucp.shopping.returns': 'Returns',
  'dev.ucp.shopping.orders': 'Orders',
};

function getCapabilityLabel(cap: string): string {
  return UCP_CAPABILITY_LABELS[cap] || cap.split('.').pop()?.replace(/_/g, ' ') || cap;
}

function ValidationStatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'valid':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
          <CheckCircle2 className="w-3 h-3" />
          Valid
        </span>
      );
    case 'invalid':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-red-500/20 text-red-400 border border-red-500/30">
          <AlertCircle className="w-3 h-3" />
          Invalid
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-500/20 text-slate-400 border border-slate-500/30">
          <MinusCircle className="w-3 h-3" />
          Not Validated
        </span>
      );
  }
}

export function AgentDetailPanel({ agent, onClose }: AgentDetailPanelProps) {
  const ucp = agent.ucp_capabilities;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed inset-y-0 right-0 w-full max-w-lg bg-slate-900 border-l border-white/10 shadow-2xl z-50 overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-slate-900/95 backdrop-blur-sm border-b border-white/10 px-6 py-4 flex items-center justify-between z-10">
          <h2 className="text-lg font-bold text-white truncate">{agent.name}</h2>
          <button
            onClick={onClose}
            className="p-2 text-white/60 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-6 space-y-6">
          {/* Agent Info */}
          <div>
            <p className="text-sm text-violet-400 font-medium mb-1">{agent.specialty}</p>
            <p className="text-white/70 text-sm leading-relaxed">{agent.description}</p>
          </div>

          {/* Protocol Badges */}
          <div>
            <h3 className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-3">Protocols</h3>
            <div className="flex flex-wrap gap-2">
              {agent.a2a_enabled && (
                <span className="px-3 py-1.5 text-xs font-semibold rounded-full bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
                  A2A
                </span>
              )}
              {agent.mcp_enabled && (
                <span className="px-3 py-1.5 text-xs font-semibold rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30">
                  MCP
                </span>
              )}
              {ucp?.enabled && (
                <span className="px-3 py-1.5 text-xs font-semibold rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30">
                  UCP
                </span>
              )}
              {agent.verified && (
                <span className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                  <Shield className="w-3 h-3" />
                  Verified
                </span>
              )}
            </div>
          </div>

          {/* Capabilities */}
          <div>
            <h3 className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-3">Capabilities</h3>
            <div className="flex flex-wrap gap-2">
              {agent.capabilities.map((cap) => (
                <span
                  key={cap}
                  className="px-2.5 py-1 text-xs font-medium bg-white/10 text-white/80 rounded-md border border-white/10"
                >
                  {cap}
                </span>
              ))}
            </div>
          </div>

          {/* Model Info */}
          <div>
            <h3 className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-3">Model</h3>
            <div className="bg-white/5 rounded-lg border border-white/10 px-4 py-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-white/70 capitalize">{agent.llm_provider}</span>
                <span className="text-sm text-white font-medium">{agent.llm_model}</span>
              </div>
              <div className="flex items-center justify-between mt-2 pt-2 border-t border-white/10">
                <span className="text-sm text-white/70">Price per query</span>
                <span className="text-sm text-white font-bold">${agent.base_price.toFixed(2)}</span>
              </div>
            </div>
          </div>

          {/* UCP Section — only shown if agent has UCP capabilities */}
          {ucp?.enabled && (
            <div>
              <h3 className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-3">
                Commerce (UCP)
              </h3>
              <div className="bg-amber-500/5 rounded-lg border border-amber-500/20 p-4 space-y-4">
                {/* Version & Validation */}
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs text-white/50">UCP Version</span>
                    <p className="text-sm text-white font-medium">{ucp.version}</p>
                  </div>
                  <ValidationStatusBadge status={ucp.validation_status} />
                </div>

                {/* Supported Capabilities */}
                {ucp.supported_capabilities.length > 0 && (
                  <div>
                    <span className="text-xs text-white/50 block mb-2">Capabilities</span>
                    <div className="flex flex-wrap gap-1.5">
                      {ucp.supported_capabilities.map((cap) => (
                        <span
                          key={cap}
                          className="px-2.5 py-1 text-xs font-medium rounded-md bg-amber-500/15 text-amber-300 border border-amber-500/25"
                        >
                          {getCapabilityLabel(cap)}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Supported Transports */}
                {ucp.supported_transports.length > 0 && (
                  <div>
                    <span className="text-xs text-white/50 block mb-2">Transports</span>
                    <div className="flex flex-wrap gap-1.5">
                      {ucp.supported_transports.map((transport) => (
                        <span
                          key={transport}
                          className="px-2.5 py-1 text-xs font-medium rounded-md bg-white/10 text-white/70 border border-white/10 uppercase"
                        >
                          {transport}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Profile URL */}
                {ucp.profile_url && (
                  <div>
                    <span className="text-xs text-white/50 block mb-1">Profile URL</span>
                    <a
                      href={ucp.profile_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-sm text-amber-400 hover:text-amber-300 transition-colors"
                    >
                      <Globe className="w-3.5 h-3.5" />
                      {ucp.profile_url}
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

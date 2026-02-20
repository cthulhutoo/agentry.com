import { useState } from 'react';
import { X, Sparkles, Save, Send, MessageCircle } from 'lucide-react';
import { Agent } from '../lib/supabase';

interface CouncilSidebarProps {
  selectedAgents: Agent[];
  totalPrice: number;
  discount: number;
  onRemove: (agent: Agent) => void;
  onSave: (name: string, description: string) => Promise<void>;
  onSubmitTask: () => void;
  onStartDiscussion: () => void;
  saving: boolean;
}

export function CouncilSidebar({
  selectedAgents,
  totalPrice,
  discount,
  onRemove,
  onSave,
  onSubmitTask,
  onStartDiscussion,
  saving,
}: CouncilSidebarProps) {
  const [showSaveForm, setShowSaveForm] = useState(false);
  const [councilName, setCouncilName] = useState('');
  const [councilDescription, setCouncilDescription] = useState('');

  const handleSave = async () => {
    if (!councilName.trim()) return;
    await onSave(councilName, councilDescription);
    setCouncilName('');
    setCouncilDescription('');
    setShowSaveForm(false);
  };

  const baseTotal = selectedAgents.reduce((sum, agent) => sum + agent.base_price, 0);

  return (
    <div className="w-96 bg-slate-50 border-l border-slate-200 flex flex-col h-full">
      <div className="p-6 border-b border-slate-200 bg-white">
        <h2 className="text-xl font-bold text-slate-900 mb-1">Your Council</h2>
        <p className="text-sm text-slate-600">
          {selectedAgents.length} {selectedAgents.length === 1 ? 'agent' : 'agents'} selected
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {selectedAgents.length === 0 ? (
          <div className="text-center py-12 px-4">
            <Sparkles className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500 text-sm">Select agents from the marketplace to build your council</p>
          </div>
        ) : (
          selectedAgents.map((agent) => (
            <div
              key={agent.id}
              className="bg-white rounded-lg p-3 border border-slate-200 hover:border-slate-300 transition-colors"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <h4 className="font-medium text-slate-900 text-sm truncate">{agent.name}</h4>
                  <p className="text-xs text-slate-500 mt-0.5">{agent.specialty}</p>
                  <p className="text-sm font-semibold text-slate-900 mt-1">${agent.base_price.toFixed(2)}</p>
                </div>
                <button
                  onClick={() => onRemove(agent)}
                  className="ml-2 w-7 h-7 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors flex-shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {selectedAgents.length > 0 && (
        <div className="border-t border-slate-200 bg-white p-6 space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-600">Subtotal</span>
              <span className="font-medium text-slate-900">${baseTotal.toFixed(2)}</span>
            </div>
            {discount > 0 && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-green-600 font-medium">Bundle Discount ({discount}%)</span>
                <span className="font-medium text-green-600">-${(baseTotal * (discount / 100)).toFixed(2)}</span>
              </div>
            )}
            <div className="flex items-center justify-between text-lg font-bold pt-2 border-t border-slate-200">
              <span className="text-slate-900">Total per Query</span>
              <span className="text-cyan-600">${totalPrice.toFixed(2)}</span>
            </div>
          </div>

          {!showSaveForm ? (
            <div className="space-y-2">
              <button
                onClick={onStartDiscussion}
                className="w-full bg-gradient-to-r from-green-600 to-emerald-600 text-white py-3 rounded-lg font-semibold hover:from-green-700 hover:to-emerald-700 transition-all shadow-md hover:shadow-lg flex items-center justify-center gap-2"
              >
                <MessageCircle className="w-4 h-4" />
                Start Discussion
              </button>
              <button
                onClick={onSubmitTask}
                className="w-full bg-gradient-to-r from-cyan-600 to-blue-600 text-white py-2.5 rounded-lg font-medium hover:from-cyan-700 hover:to-blue-700 transition-all flex items-center justify-center gap-2"
              >
                <Send className="w-4 h-4" />
                Single Task
              </button>
              <button
                onClick={() => setShowSaveForm(true)}
                className="w-full bg-slate-100 text-slate-700 py-2.5 rounded-lg font-medium hover:bg-slate-200 transition-colors flex items-center justify-center gap-2"
              >
                <Save className="w-4 h-4" />
                Save Council
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <input
                type="text"
                placeholder="Council name"
                value={councilName}
                onChange={(e) => setCouncilName(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500"
              />
              <textarea
                placeholder="Description (optional)"
                value={councilDescription}
                onChange={(e) => setCouncilDescription(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500 resize-none"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleSave}
                  disabled={saving || !councilName.trim()}
                  className="flex-1 bg-cyan-600 text-white py-2 rounded-lg font-medium hover:bg-cyan-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {saving ? 'Saving...' : 'Save'}
                </button>
                <button
                  onClick={() => setShowSaveForm(false)}
                  className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg font-medium hover:bg-slate-200 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

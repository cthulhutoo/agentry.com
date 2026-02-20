import { useState } from 'react';
import { X, Send, Loader } from 'lucide-react';
import { Agent } from '../lib/supabase';

interface TaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedAgents: Agent[];
  onSubmit: (prompt: string) => Promise<void>;
}

export function TaskModal({ isOpen, onClose, selectedAgents, onSubmit }: TaskModalProps) {
  const [prompt, setPrompt] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async () => {
    if (!prompt.trim()) return;

    setSubmitting(true);
    try {
      await onSubmit(prompt);
      setPrompt('');
      onClose();
    } catch (error) {
      console.error('Error submitting task:', error);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-6 border-b border-slate-200">
          <h2 className="text-2xl font-bold text-slate-900">Submit Task to Council</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4 flex-1 overflow-y-auto">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Your Council ({selectedAgents.length} agents)
            </label>
            <div className="flex flex-wrap gap-2">
              {selectedAgents.map((agent) => (
                <span
                  key={agent.id}
                  className="px-3 py-1.5 bg-cyan-50 text-cyan-700 rounded-full text-sm font-medium border border-cyan-200"
                >
                  {agent.name}
                </span>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Question or Research Task
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g., 'Analyze the current state of AI agent technology and provide recommendations for building a successful AI startup in 2024'"
              rows={8}
              className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500 resize-none"
            />
            <p className="text-xs text-slate-500 mt-2">
              Each agent will analyze your request from their unique perspective and specialty
            </p>
          </div>
        </div>

        <div className="p-6 border-t border-slate-200 bg-slate-50">
          <button
            onClick={handleSubmit}
            disabled={!prompt.trim() || submitting}
            className="w-full bg-gradient-to-r from-cyan-600 to-blue-600 text-white py-3 rounded-lg font-semibold hover:from-cyan-700 hover:to-blue-700 transition-all shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {submitting ? (
              <>
                <Loader className="w-5 h-5 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <Send className="w-5 h-5" />
                Submit to Council
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

import { CheckCircle, Clock, AlertCircle, Bot } from 'lucide-react';
import { Task } from '../lib/supabase';

interface TaskResultsProps {
  task: Task;
}

const statusConfig = {
  pending: { icon: Clock, color: 'text-amber-600', bg: 'bg-amber-50', label: 'Pending' },
  processing: { icon: Clock, color: 'text-blue-600', bg: 'bg-blue-50', label: 'Processing' },
  completed: { icon: CheckCircle, color: 'text-green-600', bg: 'bg-green-50', label: 'Completed' },
  failed: { icon: AlertCircle, color: 'text-red-600', bg: 'bg-red-50', label: 'Failed' },
};

export function TaskResults({ task }: TaskResultsProps) {
  const config = statusConfig[task.status];
  const Icon = config.icon;

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="p-6 border-b border-slate-200">
        <div className="flex items-start justify-between mb-3">
          <h3 className="text-lg font-semibold text-slate-900">Task Results</h3>
          <span className={`px-3 py-1 rounded-full text-sm font-medium ${config.bg} ${config.color} flex items-center gap-1.5`}>
            <Icon className="w-4 h-4" />
            {config.label}
          </span>
        </div>
        <p className="text-slate-700 text-sm">{task.prompt}</p>
        <p className="text-xs text-slate-500 mt-2">
          Submitted {new Date(task.created_at).toLocaleString()}
        </p>
      </div>

      <div className="p-6 space-y-4">
        {task.status === 'processing' && (
          <div className="flex items-center justify-center py-12">
            <div className="text-center">
              <div className="w-16 h-16 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-full flex items-center justify-center mx-auto mb-4 animate-pulse">
                <Bot className="w-8 h-8 text-white" />
              </div>
              <p className="text-slate-600 font-medium">Council is analyzing your request...</p>
              <p className="text-sm text-slate-500 mt-1">This may take a moment</p>
            </div>
          </div>
        )}

        {task.status === 'completed' && task.results.length > 0 && (
          <div className="space-y-4">
            {task.results.map((result, idx) => (
              <div key={idx} className="border border-slate-200 rounded-lg p-4 hover:border-cyan-300 transition-colors">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-white font-bold text-sm">
                    {result.agent_name.charAt(0)}
                  </div>
                  <span className="font-semibold text-slate-900">{result.agent_name}</span>
                </div>
                <p className="text-slate-700 text-sm whitespace-pre-wrap leading-relaxed">{result.response}</p>
              </div>
            ))}
          </div>
        )}

        {task.status === 'failed' && (
          <div className="text-center py-8">
            <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-3" />
            <p className="text-slate-600 font-medium">Task processing failed</p>
            <p className="text-sm text-slate-500 mt-1">Please try again</p>
          </div>
        )}
      </div>
    </div>
  );
}

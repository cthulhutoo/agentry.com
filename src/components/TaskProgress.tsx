import { useEffect, useState } from 'react';
import { X, Loader, CheckCircle, AlertCircle, Clock } from 'lucide-react';
import { Agent } from '../lib/supabase';

interface AgentProgress {
  agent_id: string;
  agent_name: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
  response?: string;
  error?: string;
  timestamp?: string;
}

interface TaskProgressProps {
  isOpen: boolean;
  onClose: () => void;
  selectedAgents: Agent[];
  taskPrompt: string;
  onComplete: (results: any[]) => void;
}

export function TaskProgress({
  isOpen,
  onClose,
  selectedAgents,
  taskPrompt,
  onComplete
}: TaskProgressProps) {
  const [agentProgress, setAgentProgress] = useState<AgentProgress[]>([]);
  const [overallStatus, setOverallStatus] = useState<'processing' | 'completed' | 'error'>('processing');

  useEffect(() => {
    if (isOpen && selectedAgents.length > 0) {
      initializeProgress();
      processTask();
    }
  }, [isOpen, selectedAgents]);

  const initializeProgress = () => {
    const initialProgress = selectedAgents.map(agent => ({
      agent_id: agent.id,
      agent_name: agent.name,
      status: 'pending' as const,
    }));
    setAgentProgress(initialProgress);
    setOverallStatus('processing');
  };

  const processTask = async () => {
    const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/process-council-task`;

    const headers = {
      'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
    };

    const agentsData = selectedAgents.map(agent => ({
      id: agent.id,
      name: agent.name,
      specialty: agent.specialty,
      llm_provider: agent.llm_provider,
      llm_model: agent.llm_model,
    }));

    for (let i = 0; i < selectedAgents.length; i++) {
      const agent = selectedAgents[i];

      setAgentProgress(prev => prev.map(p =>
        p.agent_id === agent.id
          ? { ...p, status: 'processing' }
          : p
      ));

      try {
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            taskId: `task-${Date.now()}`,
            councilId: 'temp-council',
            prompt: taskPrompt,
            agents: [agentsData[i]],
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error('API Error Response:', errorText);
          throw new Error(`API error (${response.status}): ${errorText}`);
        }

        const data = await response.json();
        const result = data.results[0];

        setAgentProgress(prev => prev.map(p =>
          p.agent_id === agent.id
            ? {
                ...p,
                status: 'completed',
                response: result.response,
                timestamp: result.timestamp,
              }
            : p
        ));
      } catch (error) {
        console.error(`Error processing agent ${agent.name}:`, error);
        setAgentProgress(prev => prev.map(p =>
          p.agent_id === agent.id
            ? {
                ...p,
                status: 'error',
                error: error instanceof Error ? error.message : 'Unknown error',
              }
            : p
        ));
      }
    }

    const finalProgress = agentProgress.filter(p => p.status === 'completed');
    if (finalProgress.length > 0) {
      setOverallStatus('completed');
      onComplete(finalProgress);
    } else {
      setOverallStatus('error');
    }
  };

  const getStatusIcon = (status: AgentProgress['status']) => {
    switch (status) {
      case 'pending':
        return <Clock className="w-5 h-5 text-slate-400" />;
      case 'processing':
        return <Loader className="w-5 h-5 text-cyan-600 animate-spin" />;
      case 'completed':
        return <CheckCircle className="w-5 h-5 text-green-600" />;
      case 'error':
        return <AlertCircle className="w-5 h-5 text-red-600" />;
    }
  };

  const getStatusColor = (status: AgentProgress['status']) => {
    switch (status) {
      case 'pending':
        return 'bg-slate-50 border-slate-200';
      case 'processing':
        return 'bg-cyan-50 border-cyan-300 shadow-md';
      case 'completed':
        return 'bg-green-50 border-green-300';
      case 'error':
        return 'bg-red-50 border-red-300';
    }
  };

  const completedCount = agentProgress.filter(p => p.status === 'completed').length;
  const totalCount = agentProgress.length;
  const progressPercentage = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-6 border-b border-slate-200 bg-gradient-to-r from-cyan-600 to-blue-600 text-white">
          <div>
            <h2 className="text-2xl font-bold">Council Processing Task</h2>
            <p className="text-cyan-50 text-sm mt-1">
              {completedCount} of {totalCount} agents completed
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={overallStatus === 'processing'}
            className="w-8 h-8 rounded-full hover:bg-white/20 flex items-center justify-center transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 pt-4 pb-2">
          <div className="relative h-3 bg-slate-200 rounded-full overflow-hidden">
            <div
              className="absolute top-0 left-0 h-full bg-gradient-to-r from-cyan-500 to-blue-600 transition-all duration-500 ease-out"
              style={{ width: `${progressPercentage}%` }}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-3">
          {agentProgress.map((progress) => (
            <div
              key={progress.agent_id}
              className={`border-2 rounded-lg p-4 transition-all duration-300 ${getStatusColor(progress.status)}`}
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5">
                  {getStatusIcon(progress.status)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <h3 className="font-semibold text-slate-900">{progress.agent_name}</h3>
                    <span className="text-xs text-slate-500 capitalize">{progress.status}</span>
                  </div>

                  {progress.status === 'processing' && (
                    <p className="text-sm text-slate-600">
                      Analyzing your request and generating insights...
                    </p>
                  )}

                  {progress.status === 'completed' && progress.response && (
                    <div className="text-sm text-slate-700 mt-2 space-y-2">
                      <p className="line-clamp-3">{progress.response}</p>
                      <button className="text-cyan-600 hover:text-cyan-700 font-medium text-xs">
                        View full response →
                      </button>
                    </div>
                  )}

                  {progress.status === 'error' && (
                    <p className="text-sm text-red-600 mt-1">
                      Error: {progress.error || 'Failed to process'}
                    </p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {overallStatus === 'completed' && (
          <div className="p-6 border-t border-slate-200 bg-green-50">
            <div className="flex items-center gap-3 text-green-800">
              <CheckCircle className="w-6 h-6" />
              <div>
                <p className="font-semibold">All agents have completed their analysis!</p>
                <p className="text-sm text-green-700">You can now review the full results below.</p>
              </div>
            </div>
          </div>
        )}

        {overallStatus === 'processing' && (
          <div className="p-6 border-t border-slate-200 bg-slate-50">
            <div className="flex items-center gap-3 text-slate-600">
              <Loader className="w-5 h-5 animate-spin" />
              <p className="text-sm">Processing your request... Please wait while agents analyze the task.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

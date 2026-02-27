import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabase';

interface Task {
  id: string;
  prompt: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  max_steps: number;
  steps_completed: number;
  credits_charged: number;
  created_at: string;
  completed_at: string | null;
  error_message: string | null;
  metadata: Record<string, string>;
}

interface Session {
  id: string;
  browser_type: string;
  status: 'active' | 'terminated' | 'expired';
  created_at: string;
  expires_at: string;
  viewport_width: number;
  viewport_height: number;
}

interface CreditBalance {
  credits: number;
}

export const ComputerUseDashboard: React.FC = () => {
  const { user } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [credits, setCredits] = useState<CreditBalance>({ credits: 0 });
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'tasks' | 'sessions' | 'new'>('new');
  const [prompt, setPrompt] = useState('');
  const [maxSteps, setMaxSteps] = useState(20);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!user) return;

    try {
      setLoading(true);

      // Fetch credits
      const { data: creditData } = await supabase
        .from('user_credits')
        .select('credits')
        .eq('user_id', user.id)
        .single();

      if (creditData) {
        setCredits({ credits: creditData.credits || 0 });
      }

      // Fetch tasks
      const { data: taskData } = await supabase
        .from('computer_use_tasks')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(20);

      if (taskData) {
        setTasks(taskData);
      }

      // Fetch active sessions
      const { data: sessionData } = await supabase
        .from('computer_use_sessions')
        .select('*')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .order('created_at', { ascending: false });

      if (sessionData) {
        setSessions(sessionData);
      }
    } catch (err) {
      console.error('Error fetching data:', err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSubmitTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !prompt.trim()) return;

    setSubmitting(true);
    setError(null);

    try {
      const { data, error: submitError } = await supabase.functions.invoke('computer-use-task', {
        body: {
          prompt: prompt.trim(),
          max_steps: maxSteps,
          timeout_ms: maxSteps * 6000,
        }
      });

      if (submitError || data?.error) {
        throw new Error(data?.error || submitError?.message || 'Failed to create task');
      }

      setPrompt('');
      setMaxSteps(20);
      fetchData();
      setActiveTab('tasks');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelTask = async (taskId: string) => {
    try {
      const { error } = await supabase.functions.invoke('computer-use-task', {
        method: 'DELETE',
        body: { task_id: taskId }
      });

      if (error) throw error;
      fetchData();
    } catch (err) {
      console.error('Error cancelling task:', err);
    }
  };

  const handleTerminateSession = async (sessionId: string) => {
    try {
      const { error } = await supabase.functions.invoke('computer-use-session', {
        method: 'DELETE',
        body: { task_id: taskId }
      });

      if (error) throw error;
      fetchData();
    } catch (err) {
      console.error('Error terminating session:', err);
    }
  };

  const getStatusColor = (status: Task['status']) => {
    switch (status) {
      case 'pending': return 'bg-yellow-100 text-yellow-800';
      case 'running': return 'bg-blue-100 text-blue-800';
      case 'completed': return 'bg-green-100 text-green-800';
      case 'failed': return 'bg-red-100 text-red-800';
      case 'cancelled': return 'bg-gray-100 text-gray-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const estimatedCredits = 1 + maxSteps + Math.ceil(maxSteps / 3);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-6">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Computer Use Agents</h1>
        <p className="text-gray-600 mt-2">
          AI-powered browser automation with real-time execution
        </p>
      </div>

      {/* Credit Balance */}
      <div className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-xl p-6 text-white mb-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-blue-100">Available Credits</p>
            <p className="text-4xl font-bold">{credits.credits.toLocaleString()}</p>
          </div>
          <a 
            href="/pricing" 
            className="bg-white text-blue-600 px-4 py-2 rounded-lg font-medium hover:bg-blue-50 transition"
          >
            Get More Credits
          </a>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="flex space-x-8">
          <button
            onClick={() => setActiveTab('new')}
            className={`py-4 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'new'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            New Task
          </button>
          <button
            onClick={() => setActiveTab('tasks')}
            className={`py-4 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'tasks'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Tasks ({tasks.length})
          </button>
          <button
            onClick={() => setActiveTab('sessions')}
            className={`py-4 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'sessions'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Active Sessions ({sessions.length})
          </button>
        </nav>
      </div>

      {/* New Task Form */}
      {activeTab === 'new' && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <form onSubmit={handleSubmitTask}>
            <div className="mb-6">
              <label htmlFor="prompt" className="block text-sm font-medium text-gray-700 mb-2">
                Task Prompt
              </label>
              <textarea
                id="prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={4}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="Describe what you want the AI to do in the browser..."
                required
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
              <div>
                <label htmlFor="maxSteps" className="block text-sm font-medium text-gray-700 mb-2">
                  Max Steps
                </label>
                <input
                  type="number"
                  id="maxSteps"
                  value={maxSteps}
                  onChange={(e) => setMaxSteps(Math.max(1, Math.min(100, parseInt(e.target.value) || 1)))}
                  min={1}
                  max={100}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <p className="text-sm text-gray-500 mt-1">
                  Maximum number of browser actions (1-100)
                </p>
              </div>

              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-sm font-medium text-gray-700">Estimated Cost</p>
                <p className="text-2xl font-bold text-gray-900">{estimatedCredits} credits</p>
                <p className="text-xs text-gray-500 mt-1">
                  Base (1) + Steps ({maxSteps}) + Screenshots ({Math.ceil(maxSteps / 3)})
                </p>
              </div>
            </div>

            {error && (
              <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
                {error}
              </div>
            )}

            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-500">
                Your balance: {credits.credits} credits
              </p>
              <button
                type="submit"
                disabled={submitting || !prompt.trim() || credits.credits < estimatedCredits}
                className="bg-blue-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                {submitting ? (
                  <span className="flex items-center">
                    <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                    </svg>
                    Starting...
                  </span>
                ) : 'Start Task'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Tasks List */}
      {activeTab === 'tasks' && (
        <div className="space-y-4">
          {tasks.length === 0 ? (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
              <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              <h3 className="mt-4 text-lg font-medium text-gray-900">No tasks yet</h3>
              <p className="mt-2 text-gray-500">Create your first computer use task to get started.</p>
              <button
                onClick={() => setActiveTab('new')}
                className="mt-4 bg-blue-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700"
              >
                Create Task
              </button>
            </div>
          ) : (
            tasks.map((task) => (
              <div key={task.id} className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <span className={`px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(task.status)}`}>
                        {task.status}
                      </span>
                      <span className="text-sm text-gray-500">
                        {task.steps_completed}/{task.max_steps} steps
                      </span>
                      <span className="text-sm text-gray-500">
                        {task.credits_charged} credits
                      </span>
                    </div>
                    <p className="text-gray-900 mb-2">{task.prompt}</p>
                    <p className="text-sm text-gray-500">
                      Created {new Date(task.created_at).toLocaleString()}
                      {task.completed_at && ` • Completed ${new Date(task.completed_at).toLocaleString()}`}
                    </p>
                    {task.error_message && (
                      <p className="text-sm text-red-600 mt-2">Error: {task.error_message}</p>
                    )}
                  </div>
                  {task.status === 'pending' || task.status === 'running' ? (
                    <button
                      onClick={() => handleCancelTask(task.id)}
                      className="text-red-600 hover:text-red-700 text-sm font-medium"
                    >
                      Cancel
                    </button>
                  ) : null}
                </div>
                {task.status === 'running' && (
                  <div className="mt-4">
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div 
                        className="bg-blue-600 h-2 rounded-full transition-all"
                        style={{ width: `${(task.steps_completed / task.max_steps) * 100}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* Sessions List */}
      {activeTab === 'sessions' && (
        <div className="space-y-4">
          {sessions.length === 0 ? (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
              <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              <h3 className="mt-4 text-lg font-medium text-gray-900">No active sessions</h3>
              <p className="mt-2 text-gray-500">Sessions will appear here when you run tasks.</p>
            </div>
          ) : (
            sessions.map((session) => (
              <div key={session.id} className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-3 mb-2">
                      <span className="px-3 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                        {session.status}
                      </span>
                      <span className="text-sm text-gray-500">
                        {session.browser_type} • {session.viewport_width}x{session.viewport_height}
                      </span>
                    </div>
                    <p className="text-sm text-gray-500">
                      Created {new Date(session.created_at).toLocaleString()}
                    </p>
                  </div>
                  <button
                    onClick={() => handleTerminateSession(session.id)}
                    className="text-red-600 hover:text-red-700 text-sm font-medium"
                  >
                    Terminate
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};

export default ComputerUseDashboard;

import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { 
  Search, 
  Filter, 
  Trash2, 
  Archive, 
  Clock, 
  CheckCircle, 
  XCircle,
  AlertCircle,
  Calendar,
  ChevronDown,
  ChevronUp,
  Copy
} from 'lucide-react';

interface Task {
  id: string;
  user_id: string;
  agent_type: string;
  prompt: string;
  result: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  credits_used: number;
  created_at: string;
  metadata?: Record<string, any>;
}

interface TaskHistoryProps {
  onSelectTask?: (task: Task) => void;
}

const statusConfig = {
  pending: { icon: Clock, color: 'text-amber-600', bg: 'bg-amber-50', label: 'Pending' },
  processing: { icon: Clock, color: 'text-blue-600', bg: 'bg-blue-50', label: 'Processing' },
  completed: { icon: CheckCircle, color: 'text-green-600', bg: 'bg-green-50', label: 'Completed' },
  failed: { icon: XCircle, color: 'text-red-600', bg: 'bg-red-50', label: 'Failed' }
};

const agentTypeColors: Record<string, string> = {
  research: 'bg-blue-100 text-blue-700',
  content: 'bg-purple-100 text-purple-700',
  code: 'bg-green-100 text-green-700',
  data: 'bg-orange-100 text-orange-700',
  communication: 'bg-pink-100 text-pink-700'
};

const TaskHistory: React.FC<TaskHistoryProps> = ({ onSelectTask }) => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [selectedAgent, setSelectedAgent] = useState<string>('all');
  const [expandedTask, setExpandedTask] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    fetchTasks();
  }, []);

  const fetchTasks = async () => {
    try {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setError('User not authenticated');
        return;
      }

      const { data, error } = await supabase
        .from('tasks')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      setTasks(data || []);
    } catch (err: any) {
      console.error('Failed to fetch tasks:', err);
      setError(err.message || 'Failed to load task history');
    } finally {
      setLoading(false);
    }
  };

  const deleteTask = async (taskId: string) => {
    if (!confirm('Are you sure you want to delete this task?')) return;

    try {
      const { error } = await supabase
        .from('tasks')
        .delete()
        .eq('id', taskId);

      if (error) throw error;
      setTasks(prev => prev.filter(t => t.id !== taskId));
    } catch (err: any) {
      console.error('Failed to delete task:', err);
      alert('Failed to delete task. Please try again.');
    }
  };

  const archiveTask = async (taskId: string) => {
    try {
      const { error } = await supabase
        .from('tasks')
        .update({ status: 'archived' as any })
        .eq('id', taskId);

      if (error) throw error;
      setTasks(prev => prev.filter(t => t.id !== taskId));
    } catch (err: any) {
      console.error('Failed to archive task:', err);
      alert('Failed to archive task. Please try again.');
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      alert('Copied to clipboard!');
    }).catch(err => {
      console.error('Failed to copy:', err);
      alert('Failed to copy. Please try again.');
    });
  };

  const filteredTasks = tasks.filter(task => {
    const matchesSearch = 
      task.prompt.toLowerCase().includes(searchQuery.toLowerCase()) ||
      task.result.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesStatus = selectedStatus === 'all' || task.status === selectedStatus;
    const matchesAgent = selectedAgent === 'all' || task.agent_type === selectedAgent;

    return matchesSearch && matchesStatus && matchesAgent;
  });

  const uniqueAgentTypes = Array.from(new Set(tasks.map(t => t.agent_type)));

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-slate-200 border-t-slate-600 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-600">Loading task history...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
        <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-3" />
        <p className="text-red-700 font-medium">Error loading task history</p>
        <p className="text-sm text-red-600 mt-1">{error}</p>
        <button
          onClick={fetchTasks}
          className="mt-4 px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
        >
          Try Again
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200">
      <div className="p-6 border-b border-slate-200">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-slate-900">Task History</h2>
          <span className="text-sm text-slate-500">{filteredTasks.length} tasks</span>
        </div>

        {/* Search */}
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-5 h-5" />
          <input
            type="text"
            placeholder="Search tasks by prompt or result..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-slate-500 focus:border-transparent"
          />
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="flex items-center gap-2 px-3 py-2 text-sm border border-slate-300 rounded-lg hover:bg-slate-50"
          >
            <Filter className="w-4 h-4" />
            Filters
            {showFilters ? (
              <ChevronUp className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
          </button>

          {showFilters && (
            <>
              <select
                value={selectedAgent}
                onChange={(e) => setSelectedAgent(e.target.value)}
                className="px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-slate-500"
              >
                <option value="all">All Agents</option>
                {uniqueAgentTypes.map(type => (
                  <option key={type} value={type}>
                    {type.charAt(0).toUpperCase() + type.slice(1)}
                  </option>
                ))}
              </select>

              <select
                value={selectedStatus}
                onChange={(e) => setSelectedStatus(e.target.value)}
                className="px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-slate-500"
              >
                <option value="all">All Status</option>
                <option value="completed">Completed</option>
                <option value="processing">Processing</option>
                <option value="failed">Failed</option>
                <option value="pending">Pending</option>
              </select>
            </>
          )}

          {(searchQuery || selectedAgent !== 'all' || selectedStatus !== 'all') && (
            <button
              onClick={() => {
                setSearchQuery('');
                setSelectedAgent('all');
                setSelectedStatus('all');
              }}
              className="px-3 py-2 text-sm text-slate-600 hover:text-slate-900"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {/* Task List */}
      <div className="divide-y divide-slate-100">
        {filteredTasks.length === 0 ? (
          <div className="p-12 text-center">
            <Calendar className="w-16 h-16 text-slate-300 mx-auto mb-4" />
            <p className="text-slate-600 font-medium">No tasks found</p>
            <p className="text-sm text-slate-500 mt-1">
              {searchQuery || selectedAgent !== 'all' || selectedStatus !== 'all'
                ? 'Try adjusting your filters'
                : 'Your task history will appear here'}
            </p>
          </div>
        ) : (
          filteredTasks.map(task => {
            const config = statusConfig[task.status] || statusConfig.pending;
            const Icon = config.icon;
            const isExpanded = expandedTask === task.id;

            return (
              <div
                key={task.id}
                className="p-4 hover:bg-slate-50 transition-colors"
              >
                <div className="flex items-start gap-4">
                  {/* Status Icon */}
                  <div className={`w-10 h-10 rounded-lg ${config.bg} flex items-center justify-center flex-shrink-0`}>
                    <Icon className={`w-5 h-5 ${config.color}`} />
                  </div>

                  {/* Task Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${agentTypeColors[task.agent_type] || 'bg-slate-100 text-slate-700'}`}>
                            {task.agent_type.charAt(0).toUpperCase() + task.agent_type.slice(1)}
                          </span>
                          <span className={`text-xs ${config.color}`}>
                            {config.label}
                          </span>
                        </div>
                        <p className="text-sm text-slate-900 font-medium truncate">
                          {task.prompt}
                        </p>
                        <p className="text-xs text-slate-500 mt-1">
                          {formatDate(task.created_at)} • {task.credits_used} credits
                        </p>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={() => copyToClipboard(task.result)}
                          className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded"
                          title="Copy result"
                        >
                          <Copy className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setExpandedTask(isExpanded ? null : task.id)}
                          className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded"
                          title={isExpanded ? 'Collapse' : 'Expand'}
                        >
                          {isExpanded ? (
                            <ChevronUp className="w-4 h-4" />
                          ) : (
                            <ChevronDown className="w-4 h-4" />
                          )}
                        </button>
                        <button
                          onClick={() => archiveTask(task.id)}
                          className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded"
                          title="Archive"
                        >
                          <Archive className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => deleteTask(task.id)}
                          className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {/* Expanded Content */}
                    {isExpanded && (
                      <div className="mt-4 pt-4 border-t border-slate-200">
                        <div className="mb-3">
                          <h4 className="text-sm font-medium text-slate-700 mb-2">Prompt:</h4>
                          <p className="text-sm text-slate-600 whitespace-pre-wrap">{task.prompt}</p>
                        </div>
                        <div>
                          <h4 className="text-sm font-medium text-slate-700 mb-2">Result:</h4>
                          <div className="bg-slate-50 rounded-lg p-3">
                            <p className="text-sm text-slate-600 whitespace-pre-wrap max-h-64 overflow-y-auto">
                              {task.result}
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => onSelectTask?.(task)}
                          className="mt-4 w-full py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors font-medium"
                        >
                          View Full Details
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default TaskHistory;

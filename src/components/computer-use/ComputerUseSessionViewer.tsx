import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabase';

interface Action {
  id: string;
  action_type: string;
  action_data: Record<string, any>;
  screenshot_url: string | null;
  created_at: string;
  duration_ms: number;
  status: 'pending' | 'running' | 'completed' | 'failed';
  error_message: string | null;
}

interface SessionViewerProps {
  sessionId: string;
  onClose?: () => void;
}

export const ComputerUseSessionViewer: React.FC<SessionViewerProps> = ({ sessionId, onClose }) => {
  const { user } = useAuth();
  const [actions, setActions] = useState<Action[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAction, setSelectedAction] = useState<Action | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const screenshotRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const fetchActions = async () => {
      if (!user) return;

      try {
        const { data, error } = await supabase
          .from('computer_use_actions')
          .select('*')
          .eq('session_id', sessionId)
          .order('created_at', { ascending: true });

        if (error) throw error;
        setActions(data || []);
        
        if (data && data.length > 0) {
          setSelectedAction(data[data.length - 1]);
        }
      } catch (err) {
        console.error('Error fetching actions:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchActions();

    // Subscribe to new actions
    const channel = supabase
      .channel(`session-${sessionId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'computer_use_actions',
        filter: `session_id=eq.${sessionId}`
      }, (payload) => {
        setActions(prev => [...prev, payload.new as Action]);
        setSelectedAction(payload.new as Action);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [sessionId, user]);

  const getActionIcon = (type: string) => {
    switch (type) {
      case 'navigate': return '🌐';
      case 'click': return '👆';
      case 'type': return '⌨️';
      case 'scroll': return '📜';
      case 'screenshot': return '📸';
      case 'wait': return '⏱️';
      case 'extract': return '📄';
      default: return '⚡';
    }
  };

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className={`bg-white rounded-xl shadow-lg ${isFullscreen ? 'fixed inset-0 z-50' : 'h-full'} flex flex-col`}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200">
        <h2 className="text-lg font-semibold text-gray-900">Session Viewer</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg"
          >
            {isFullscreen ? '⛶' : '⛶'}
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Screenshot Panel */}
        <div className="flex-1 bg-gray-900 p-4 flex items-center justify-center">
          {selectedAction?.screenshot_url ? (
            <img
              ref={screenshotRef}
              src={selectedAction.screenshot_url}
              alt="Current screen"
              className="max-w-full max-h-full object-contain rounded-lg"
            />
          ) : (
            <div className="text-gray-500">No screenshot available</div>
          )}
        </div>

        {/* Actions Panel */}
        <div className="w-80 border-l border-gray-200 flex flex-col">
          <div className="p-3 border-b border-gray-200 bg-gray-50">
            <h3 className="font-medium text-gray-900">Actions ({actions.length})</h3>
          </div>
          <div className="flex-1 overflow-y-auto">
            {actions.map((action, index) => (
              <button
                key={action.id}
                onClick={() => setSelectedAction(action)}
                className={`w-full p-3 text-left border-b border-gray-100 hover:bg-gray-50 transition ${
                  selectedAction?.id === action.id ? 'bg-blue-50 border-l-4 border-l-blue-600' : ''
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-lg">{getActionIcon(action.action_type)}</span>
                  <span className="font-medium text-gray-900">{action.action_type}</span>
                  <span className={`ml-auto text-xs px-2 py-0.5 rounded ${
                    action.status === 'completed' ? 'bg-green-100 text-green-800' :
                    action.status === 'failed' ? 'bg-red-100 text-red-800' :
                    action.status === 'running' ? 'bg-blue-100 text-blue-800' :
                    'bg-gray-100 text-gray-800'
                  }`}>
                    {action.status}
                  </span>
                </div>
                <div className="text-sm text-gray-500 mt-1">
                  {formatDuration(action.duration_ms)}
                </div>
                {action.error_message && (
                  <div className="text-xs text-red-600 mt-1 truncate">
                    {action.error_message}
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Action Details */}
      {selectedAction && (
        <div className="p-4 border-t border-gray-200 bg-gray-50">
          <h4 className="font-medium text-gray-900 mb-2">
            {getActionIcon(selectedAction.action_type)} {selectedAction.action_type}
          </h4>
          <pre className="text-xs text-gray-600 overflow-x-auto">
            {JSON.stringify(selectedAction.action_data, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
};

export default ComputerUseSessionViewer;

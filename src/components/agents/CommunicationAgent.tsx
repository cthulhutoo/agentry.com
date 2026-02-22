import React, { useState } from 'react';

interface CommunicationAgentProps {
  onTaskComplete?: (result: string) => void;
  credits?: number;
}

interface CommTask {
  channel: 'email' | 'social' | 'slack' | 'discord';
  action: 'compose' | 'schedule' | 'respond' | 'summarize';
  context: string;
  tone: string;
  platform: string;
}

const CommunicationAgent: React.FC<CommunicationAgentProps> = ({ onTaskComplete, credits = 0 }) => {
  const [task, setTask] = useState<CommTask>({
    channel: 'email',
    action: 'compose',
    context: '',
    tone: 'professional',
    platform: 'twitter'
  });
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<string>('');

  const handleProcess = async () => {
    if (!task.context.trim()) return;
    
    setIsProcessing(true);
    try {
      // TODO: Connect to backend communication API
      const mockResult = task.action === 'compose'
        ? task.channel === 'email'
          ? `Subject: ${task.context.slice(0, 50)}...\n\nDear [Recipient],\n\nI hope this message finds you well.\n\n${task.context}\n\nBest regards,\n[Your Name]`
          : `📱 ${task.platform} Post:\n\n"${task.context.slice(0, 280)}"\n\n#hashtags #trending`
        : task.action === 'schedule'
        ? `📅 Scheduled for optimal engagement:\n\n- Best time: Tuesday 10:00 AM\n- Expected reach: 2,500+\n- Recommended hashtags: #trending #tech`
        : task.action === 'respond'
        ? `💬 Suggested Response:\n\n"Thank you for reaching out! I appreciate your message and will get back to you shortly with more details."`
        : `📋 Communication Summary:\n\n- 5 messages processed\n- 2 require follow-up\n- Key topics: meetings, deadlines, collaboration`;
      
      setResult(mockResult);
      onTaskComplete?.(mockResult);
    } catch (error) {
      console.error('Communication processing failed:', error);
      setResult('Processing failed. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  const channelIcons = {
    email: '📧',
    social: '📱',
    slack: '💬',
    discord: '🎮'
  };

  const actionIcons = {
    compose: '✍️',
    schedule: '📅',
    respond: '↩️',
    summarize: '📋'
  };

  return (
    <div className="bg-white rounded-lg shadow-lg p-6 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-12 h-12 bg-pink-100 rounded-full flex items-center justify-center">
          <span className="text-2xl">💬</span>
        </div>
        <div>
          <h3 className="text-xl font-bold text-gray-800">Communication Agent</h3>
          <p className="text-sm text-gray-500">Email, social media & messaging</p>
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Channel
          </label>
          <div className="grid grid-cols-4 gap-2">
            {(['email', 'social', 'slack', 'discord'] as const).map((channel) => (
              <button
                key={channel}
                onClick={() => setTask(prev => ({ ...prev, channel }))}
                className={`px-3 py-2 rounded-md flex items-center justify-center gap-1 ${
                  task.channel === channel
                    ? 'bg-pink-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                <span>{channelIcons[channel]}</span>
                <span className="capitalize text-sm">{channel}</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Action
          </label>
          <div className="grid grid-cols-4 gap-2">
            {(['compose', 'schedule', 'respond', 'summarize'] as const).map((action) => (
              <button
                key={action}
                onClick={() => setTask(prev => ({ ...prev, action }))}
                className={`px-3 py-2 rounded-md flex items-center justify-center gap-1 ${
                  task.action === action
                    ? 'bg-pink-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                <span>{actionIcons[action]}</span>
                <span className="capitalize text-sm">{action}</span>
              </button>
            ))}
          </div>
        </div>

        {task.channel === 'social' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Platform
            </label>
            <select
              value={task.platform}
              onChange={(e) => setTask(prev => ({ ...prev, platform: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
            >
              <option value="twitter">Twitter/X</option>
              <option value="linkedin">LinkedIn</option>
              <option value="instagram">Instagram</option>
              <option value="facebook">Facebook</option>
              <option value="threads">Threads</option>
            </select>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {task.action === 'compose' ? 'Topic / Message Brief' : 
             task.action === 'respond' ? 'Message to Respond To' :
             'Context'}
          </label>
          <textarea
            value={task.context}
            onChange={(e) => setTask(prev => ({ ...prev, context: e.target.value }))}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-pink-500 focus:border-transparent"
            rows={4}
            placeholder={task.action === 'compose' 
              ? 'What would you like to communicate?' 
              : 'Paste the message or context...'}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Tone
          </label>
          <select
            value={task.tone}
            onChange={(e) => setTask(prev => ({ ...prev, tone: e.target.value }))}
            className="w-full px-3 py-2 border border-gray-300 rounded-md"
          >
            <option value="professional">Professional</option>
            <option value="friendly">Friendly</option>
            <option value="casual">Casual</option>
            <option value="formal">Formal</option>
            <option value="humorous">Humorous</option>
          </select>
        </div>

        <button
          onClick={handleProcess}
          disabled={isProcessing || !task.context.trim()}
          className="w-full py-2 px-4 bg-pink-600 text-white rounded-md hover:bg-pink-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
        >
          {isProcessing ? 'Processing...' : `${task.action.charAt(0).toUpperCase() + task.action.slice(1)} Message`}
        </button>

        {result && (
          <div className="mt-4 p-4 bg-gray-50 rounded-md">
            <h4 className="font-medium text-gray-700 mb-2">Output:</h4>
            <pre className="text-gray-600 whitespace-pre-wrap text-sm">{result}</pre>
          </div>
        )}
      </div>

      <div className="mt-4 pt-4 border-t border-gray-200">
        <p className="text-xs text-gray-500">
          Credits required: {task.action === 'schedule' ? 2 : 1} • 
          Your balance: {credits} credits
        </p>
      </div>
    </div>
  );
};

export default CommunicationAgent;

import React, { useState, useRef } from 'react';
import { Loader, CheckCircle, XCircle, MessageSquare } from 'lucide-react';
import { streamAgentResponse, StreamingResult } from '../../services/streamingService';
import { supabase } from '../../lib/supabase';

interface CommunicationAgentProps {
  onTaskComplete?: (taskData: {
    agent_type: string;
    prompt: string;
    result: string;
    credits_used: number;
    status: string;
    created_at: string;
  }) => void;
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
  const [streamedText, setStreamedText] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [creditsUsed, setCreditsUsed] = useState<number>(0);
  const [progress, setProgress] = useState<number>(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  const getCreditRequirement = (): number => {
    const baseCredits = 1;
    const actionMultipliers = { compose: 1, schedule: 2, respond: 1.5, summarize: 2 };
    return Math.ceil(baseCredits * actionMultipliers[task.action]);
  };

  const handleProcess = async () => {
    if (!task.context.trim()) return;
    
    const requiredCredits = getCreditRequirement();
    if (credits < requiredCredits) {
      setError(`Insufficient credits. You need ${requiredCredits} credits but only have ${credits}.`);
      return;
    }

    setIsProcessing(true);
    setResult('');
    setStreamedText('');
    setError(null);
    setCreditsUsed(0);
    setProgress(0);
    
    abortControllerRef.current = new AbortController();

    try {
      const prompt = buildCommunicationPrompt(task);

      const streamingResult: StreamingResult = await streamAgentResponse('communication', prompt, {
        onToken: (token, fullText) => {
          setStreamedText(fullText);
          setProgress(Math.min(fullText.length / 5, 100));
        },
        onError: (err) => {
          setError(err.message);
        }
      });

      setResult(streamingResult.text);
      setCreditsUsed(streamingResult.creditsUsed || 0);
      setProgress(100);

      onTaskComplete?.({
        agent_type: 'communicationagent',
        prompt: prompt.substring(0, 1000),
        result: result || streamingResult?.text || '',
        credits_used: creditsUsed || streamingResult?.creditsUsed || 0,
        status: 'completed',
        created_at: new Date().toISOString()
      });

      await saveTaskToDatabase('communication', task.context, streamingResult.text, streamingResult.creditsUsed || 0);

    } catch (err: any) {
      console.error('Communication processing failed:', err);
      setError(err.message || 'Processing failed. Please try again.');
    } finally {
      setIsProcessing(false);
      abortControllerRef.current = null;
    }
  };

  const handleStop = () => {
    abortControllerRef.current?.abort();
    setIsProcessing(false);
  };

  const buildCommunicationPrompt = (task: CommTask): string => {
    const channelConfig = {
      email: { format: 'Professional email format', max_length: '500-1000 words' },
      social: { format: `Social media post for ${task.platform}`, max_length: '280 characters for Twitter, 1500 for others' },
      slack: { format: 'Slack message format', max_length: '200-400 characters per message' },
      discord: { format: 'Discord message format with markdown', max_length: '2000 characters' }
    };

    const actionInstructions = {
      compose: 'Create new communication content',
      schedule: 'Determine optimal scheduling and provide posting recommendations',
      respond: 'Draft an appropriate response to the provided message',
      summarize: 'Summarize and extract key points from the communication'
    };

    let prompt = `Communication ${task.action.toUpperCase()} Task\n\n`;
    prompt += `Channel: ${task.channel}\n`;
    if (task.channel === 'social') {
      prompt += `Platform: ${task.platform}\n`;
    }
    prompt += `Action: ${task.action}\n`;
    prompt += `Tone: ${task.tone}\n\n`;

    const config = channelConfig[task.channel];
    prompt += `Format Requirements:\n`;
    prompt += `- ${config.format}\n`;
    prompt += `- Target length: ${config.max_length}\n\n`;

    prompt += `Instructions: ${actionInstructions[task.action]}\n\n`;
    prompt += `Context/Message:\n${task.context}\n\n`;

    if (task.action === 'compose') {
      prompt += `Requirements:\n`;
      prompt += `- Create engaging ${task.channel} content\n`;
      prompt += `- Match the specified tone: ${task.tone}\n`;
      if (task.channel === 'social') {
        prompt += `- Include relevant hashtags\n`;
        prompt += `- Add call-to-action if appropriate\n`;
      } else if (task.channel === 'email') {
        prompt += `- Include clear subject line\n`;
        prompt += `- Professional email structure\n`;
        prompt += `- Appropriate greeting and sign-off\n`;
      }
      prompt += `- Make it compelling and actionable`;
    } else if (task.action === 'schedule') {
      prompt += `Requirements:\n`;
      prompt += `- Analyze best posting times for ${task.channel}${task.channel === 'social' ? `/${task.platform}` : ''}\n`;
      prompt += `- Consider audience engagement patterns\n`;
      prompt += `- Provide specific date/time recommendations\n`;
      prompt += `- Suggest frequency and posting strategy`;
    } else if (task.action === 'respond') {
      prompt += `Requirements:\n`;
      prompt += `- Address key points in the original message\n`;
      prompt += `- Maintain ${task.tone} tone\n`;
      prompt += `- Be constructive and helpful\n`;
      prompt += `- Keep response appropriate for ${task.channel}\n`;
      prompt += `- Handle any sensitive topics diplomatically`;
    } else if (task.action === 'summarize') {
      prompt += `Requirements:\n`;
      prompt += `- Extract main points and key information\n`;
      prompt += `- Identify action items and deadlines\n`;
      prompt += `- Note important context or details\n`;
      prompt += `- Format for easy reading\n`;
      prompt += `- Highlight critical information`;
    }

    return prompt;
  };

  const saveTaskToDatabase = async (
    agentType: string,
    prompt: string,
    result: string,
    creditsUsed: number
  ) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { error } = await supabase.from('tasks').insert({
        user_id: user.id,
        agent_type: agentType,
        prompt: prompt.substring(0, 1000),
        result: result.substring(0, 10000),
        status: 'completed',
        credits_used: creditsUsed,
        metadata: {
          channel: task.channel,
          action: task.action,
          tone: task.tone,
          platform: task.platform
        }
      });

      if (error) console.error('Failed to save task:', error);
    } catch (err) {
      console.error('Error saving task:', err);
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
        <div className="flex-1">
          <h3 className="text-xl font-bold text-gray-800">Communication Agent</h3>
          <p className="text-sm text-gray-500">Email, social media & messaging</p>
        </div>
        {isProcessing && (
          <Loader className="w-6 h-6 text-pink-500 animate-spin" />
        )}
        {!isProcessing && result && (
          <CheckCircle className="w-6 h-6 text-green-500" />
        )}
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
                onClick={() => !isProcessing && setTask(prev => ({ ...prev, channel }))}
                disabled={isProcessing}
                className={`px-3 py-2 rounded-md flex items-center justify-center gap-1 transition-all ${
                  task.channel === channel
                    ? 'bg-pink-600 text-white shadow-md'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50'
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
                onClick={() => !isProcessing && setTask(prev => ({ ...prev, action }))}
                disabled={isProcessing}
                className={`px-3 py-2 rounded-md flex items-center justify-center gap-1 transition-all ${
                  task.action === action
                    ? 'bg-pink-600 text-white shadow-md'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50'
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
              onChange={(e) => !isProcessing && setTask(prev => ({ ...prev, platform: e.target.value }))}
              disabled={isProcessing}
              className="w-full px-3 py-2 border border-gray-300 rounded-md disabled:bg-gray-50 disabled:cursor-not-allowed"
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
            disabled={isProcessing}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-pink-500 focus:border-transparent disabled:bg-gray-50 disabled:cursor-not-allowed"
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
            onChange={(e) => !isProcessing && setTask(prev => ({ ...prev, tone: e.target.value }))}
            disabled={isProcessing}
            className="w-full px-3 py-2 border border-gray-300 rounded-md disabled:bg-gray-50 disabled:cursor-not-allowed"
          >
            <option value="professional">Professional</option>
            <option value="friendly">Friendly</option>
            <option value="casual">Casual</option>
            <option value="formal">Formal</option>
            <option value="humorous">Humorous</option>
          </select>
        </div>

        <div className="flex gap-2">
          {!isProcessing ? (
            <button
              onClick={handleProcess}
              disabled={!task.context.trim()}
              className="flex-1 py-2 px-4 bg-pink-600 text-white rounded-md hover:bg-pink-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors font-medium flex items-center justify-center gap-2"
            >
              <MessageSquare className="w-4 h-4" />
              {task.action.charAt(0).toUpperCase() + task.action.slice(1)} Message
            </button>
          ) : (
            <button
              onClick={handleStop}
              className="flex-1 py-2 px-4 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors font-medium flex items-center justify-center gap-2"
            >
              <XCircle className="w-4 h-4" />
              Stop
            </button>
          )}
        </div>

        {isProcessing && (
          <div className="space-y-2">
            <div className="flex justify-between text-sm text-gray-600">
              <span>Processing...</span>
              <span>{progress.toFixed(0)}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div 
                className="bg-pink-600 h-2 rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-md">
            <div className="flex items-start gap-2">
              <XCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          </div>
        )}

        {(streamedText || result) && (
          <div className="mt-4 p-4 bg-gray-50 rounded-md border border-gray-200">
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-medium text-gray-700">
                {isProcessing ? 'Processing...' : 'Output:'}
              </h4>
              {isProcessing && (
                <span className="text-xs text-pink-600 flex items-center gap-1">
                  <Loader className="w-3 h-3 animate-spin" />
                  Live
                </span>
              )}
            </div>
            <div className="prose prose-sm max-w-none">
              <div className="text-gray-600 whitespace-pre-wrap leading-relaxed">
                {streamedText || result}
              </div>
              {isProcessing && (
                <span className="inline-block w-2 h-4 bg-pink-600 animate-pulse ml-1" />
              )}
            </div>
          </div>
        )}
      </div>

      <div className="mt-4 pt-4 border-t border-gray-200">
        <div className="flex justify-between items-center">
          <p className="text-xs text-gray-500">
            Credits required: {getCreditRequirement()} • Your balance: {credits} credits
          </p>
          {creditsUsed > 0 && (
            <p className="text-xs text-green-600 font-medium flex items-center gap-1">
              <CheckCircle className="w-3 h-3" />
              {creditsUsed} credits used
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default CommunicationAgent;

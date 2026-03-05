import React, { useState, useRef } from 'react';
import { Loader, CheckCircle, XCircle, Clock, FileText } from 'lucide-react';
import { streamAgentResponse, StreamingResult } from '../../services/streamingService';
import { supabase } from '../../lib/supabase';

interface ContentAgentProps {
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

interface ContentTask {
  type: 'write' | 'edit' | 'rewrite' | 'translate';
  input: string;
  style: string;
  tone: string;
  length: 'short' | 'medium' | 'long';
}

const ContentAgent: React.FC<ContentAgentProps> = ({ onTaskComplete, credits = 0 }) => {
  const [task, setTask] = useState<ContentTask>({
    type: 'write',
    input: '',
    style: 'professional',
    tone: 'neutral',
    length: 'medium'
  });
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<string>('');
  const [streamedText, setStreamedText] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [creditsUsed, setCreditsUsed] = useState<number>(0);
  const [progress, setProgress] = useState<number>(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  const getCreditRequirement = (): number => {
    const lengthMultipliers = { short: 1, medium: 2, long: 4 };
    const base = lengthMultipliers[task.length];
    const actionMultipliers = { write: 1.5, edit: 1, rewrite: 1.2, translate: 1.3 };
    return Math.ceil(base * actionMultipliers[task.type]);
  };

  const handleGenerate = async () => {
    if (!task.input.trim()) return;
    
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
      const prompt = buildContentPrompt(task);

      const streamingResult: StreamingResult = await streamAgentResponse('content', prompt, {
        onToken: (token, fullText) => {
          setStreamedText(fullText);
          setProgress(Math.min(fullText.length / 10, 100));
        },
        onError: (err) => {
          setError(err.message);
        }
      });

      setResult(streamingResult.text);
      setCreditsUsed(streamingResult.creditsUsed || 0);
      setProgress(100);

      onTaskComplete?.({
        agent_type: 'contentagent',
        prompt: prompt.substring(0, 1000),
        result: result || streamingResult?.text || '',
        credits_used: creditsUsed || streamingResult?.creditsUsed || 0,
        status: 'completed',
        created_at: new Date().toISOString()
      });

      await saveTaskToDatabase('content', task.input, streamingResult.text, streamingResult.creditsUsed || 0);

    } catch (err: any) {
      console.error('Content generation failed:', err);
      setError(err.message || 'Content generation failed. Please try again.');
    } finally {
      setIsProcessing(false);
      abortControllerRef.current = null;
    }
  };

  const handleStop = () => {
    abortControllerRef.current?.abort();
    setIsProcessing(false);
  };

  const buildContentPrompt = (task: ContentTask): string => {
    const lengthInstructions = {
      short: 'Keep it concise (100-200 words)',
      medium: 'Provide moderate detail (300-500 words)',
      long: 'Go into depth (600-1000 words)'
    };

    const typeInstructions = {
      write: 'Create new content from the topic/brief provided',
      edit: 'Improve and polish the provided content',
      rewrite: 'Rephrase the content while maintaining the core message',
      translate: 'Translate the content (note: specify target language in input)'
    };

    let prompt = `Content ${task.type.toUpperCase()} Task\n\n`;
    prompt += `Type: ${task.type}\n`;
    prompt += `Style: ${task.style}\n`;
    prompt += `Tone: ${task.tone}\n`;
    prompt += `Length: ${task.length} (${lengthInstructions[task.length]})\n\n`;
    prompt += `Instructions: ${typeInstructions[task.type]}\n\n`;
    prompt += `Input/Content:\n${task.input}\n\n`;
    prompt += `Requirements:\n`;
    prompt += `- Ensure content matches the specified style and tone\n`;
    prompt += `- Follow the length guidelines\n`;
    prompt += `- Use engaging, clear language\n`;
    prompt += `- Structure with appropriate headings and paragraphs\n`;
    prompt += `- Make it actionable and valuable to the reader`;

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
          type: task.type,
          style: task.style,
          tone: task.tone,
          length: task.length
        }
      });

      if (error) console.error('Failed to save task:', error);
    } catch (err) {
      console.error('Error saving task:', err);
    }
  };

  const typeIcons = {
    write: '✍️',
    edit: '✂️',
    rewrite: '🔄',
    translate: '🌐'
  };

  return (
    <div className="bg-white rounded-lg shadow-lg p-6 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-12 h-12 bg-purple-100 rounded-full flex items-center justify-center">
          <span className="text-2xl">📝</span>
        </div>
        <div className="flex-1">
          <h3 className="text-xl font-bold text-gray-800">Content Agent</h3>
          <p className="text-sm text-gray-500">Writing, editing & content creation</p>
        </div>
        {isProcessing && (
          <Loader className="w-6 h-6 text-purple-500 animate-spin" />
        )}
        {!isProcessing && result && (
          <CheckCircle className="w-6 h-6 text-green-500" />
        )}
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Content Type
          </label>
          <div className="grid grid-cols-4 gap-2">
            {(['write', 'edit', 'rewrite', 'translate'] as const).map((type) => (
              <button
                key={type}
                onClick={() => !isProcessing && setTask(prev => ({ ...prev, type }))}
                disabled={isProcessing}
                className={`px-3 py-2 rounded-md flex items-center justify-center gap-1 transition-all ${
                  task.type === type
                    ? 'bg-purple-600 text-white shadow-md'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50'
                }`}
              >
                <span>{typeIcons[type]}</span>
                <span className="capitalize text-sm">{type}</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {task.type === 'write' ? 'Topic / Brief' : 'Content to Process'}
          </label>
          <textarea
            value={task.input}
            onChange={(e) => setTask(prev => ({ ...prev, input: e.target.value }))}
            disabled={isProcessing}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-transparent disabled:bg-gray-50 disabled:cursor-not-allowed"
            rows={4}
            placeholder={task.type === 'write' ? 'Describe what you want to write...' : 'Paste content to edit or rewrite...'}
          />
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Style
            </label>
            <select
              value={task.style}
              onChange={(e) => !isProcessing && setTask(prev => ({ ...prev, style: e.target.value }))}
              disabled={isProcessing}
              className="w-full px-3 py-2 border border-gray-300 rounded-md disabled:bg-gray-50 disabled:cursor-not-allowed"
            >
              <option value="professional">Professional</option>
              <option value="casual">Casual</option>
              <option value="creative">Creative</option>
              <option value="technical">Technical</option>
              <option value="academic">Academic</option>
            </select>
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
              <option value="neutral">Neutral</option>
              <option value="friendly">Friendly</option>
              <option value="formal">Formal</option>
              <option value="persuasive">Persuasive</option>
              <option value="humorous">Humorous</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Length
            </label>
            <select
              value={task.length}
              onChange={(e) => !isProcessing && setTask(prev => ({ ...prev, length: e.target.value }))}
              disabled={isProcessing}
              className="w-full px-3 py-2 border border-gray-300 rounded-md disabled:bg-gray-50 disabled:cursor-not-allowed"
            >
              <option value="short">Short</option>
              <option value="medium">Medium</option>
              <option value="long">Long</option>
            </select>
          </div>
        </div>

        <div className="flex gap-2">
          {!isProcessing ? (
            <button
              onClick={handleGenerate}
              disabled={!task.input.trim()}
              className="flex-1 py-2 px-4 bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors font-medium flex items-center justify-center gap-2"
            >
              <FileText className="w-4 h-4" />
              Generate Content
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
              <span>Generating content...</span>
              <span>{progress.toFixed(0)}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div 
                className="bg-purple-600 h-2 rounded-full transition-all duration-300"
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
                {isProcessing ? 'Generating...' : 'Generated Content:'}
              </h4>
              {isProcessing && (
                <span className="text-xs text-purple-600 flex items-center gap-1">
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
                <span className="inline-block w-2 h-4 bg-purple-600 animate-pulse ml-1" />
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

export default ContentAgent;

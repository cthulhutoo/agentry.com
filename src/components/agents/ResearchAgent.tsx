import React, { useState, useRef } from 'react';
import { Loader, CheckCircle, XCircle, Clock } from 'lucide-react';
import { streamAgentResponse, StreamingResult } from '../../services/streamingService';
import { supabase } from '../../lib/supabase';

interface ResearchAgentProps {
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

interface ResearchTask {
  query: string;
  depth: 'quick' | 'standard' | 'deep';
  sources: string[];
}

const ResearchAgent: React.FC<ResearchAgentProps> = ({ onTaskComplete, credits = 0 }) => {
  const [task, setTask] = useState<ResearchTask>({
    query: '',
    depth: 'standard',
    sources: []
  });
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<string>('');
  const [streamedText, setStreamedText] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [creditsUsed, setCreditsUsed] = useState<number>(0);
  const [progress, setProgress] = useState<number>(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  const getCreditRequirement = (): number => {
    switch (task.depth) {
      case 'quick': return 1;
      case 'standard': return 3;
      case 'deep': return 5;
      default: return 3;
    }
  };

  const handleResearch = async () => {
    if (!task.query.trim()) return;
    
    // Check credit balance
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
    
    // Create abort controller for cancellation
    abortControllerRef.current = new AbortController();

    try {
      // Build research prompt based on task parameters
      const prompt = buildResearchPrompt(task);

      // Stream the response using the streaming service
      const streamingResult: StreamingResult = await streamAgentResponse('research', prompt, {
        onToken: (token, fullText) => {
          setStreamedText(fullText);
          // Simulate progress (this would be estimated based on expected output length)
          setProgress(Math.min(fullText.length / 10, 100));
        },
        onProgress: (prog) => {
          setProgress(prog);
        },
        onError: (err) => {
          setError(err.message);
        }
      });

      // Set final result
      setResult(streamingResult.text);
      setCreditsUsed(streamingResult.creditsUsed || 0);
      setProgress(100);

      // Call completion callback
      onTaskComplete?.({
        agent_type: 'research',
        prompt: prompt.substring(0, 1000),
        result: streamingResult.text,
        credits_used: streamingResult.creditsUsed || 0,
        status: 'completed',
        created_at: new Date().toISOString()
      });

      // Save task to database
      await saveTaskToDatabase('research', task.query, streamingResult.text, streamingResult.creditsUsed || 0);

    } catch (err: any) {
      console.error('Research failed:', err);
      setError(err.message || 'Research failed. Please try again.');
    } finally {
      setIsProcessing(false);
      abortControllerRef.current = null;
    }
  };

  const handleStop = () => {
    abortControllerRef.current?.abort();
    setIsProcessing(false);
  };

  const buildResearchPrompt = (task: ResearchTask): string => {
    const sourceConfig = {
      web: 'Web sources',
      academic: 'Academic and scholarly sources',
      news: 'News and media sources',
      social: 'Social media sources'
    };

    const selectedSources = task.sources
      .map(s => sourceConfig[s as keyof typeof sourceConfig])
      .filter(Boolean)
      .join(', ');

    const depthInstructions = {
      quick: 'Provide a concise summary with 3-5 key points.',
      standard: 'Provide comprehensive analysis with 5-8 key findings and supporting evidence.',
      deep: 'Conduct exhaustive research with 10+ detailed findings, multiple perspectives, citations, and actionable insights.'
    };

    let prompt = `Research Task: ${task.query}\n\n`;
    prompt += `Research Depth: ${task.depth}\n`;
    prompt += `${depthInstructions[task.depth]}\n\n`;
    
    if (selectedSources) {
      prompt += `Preferred Sources: ${selectedSources}\n\n`;
    }

    prompt += `Please structure your response with:\n`;
    prompt += `1. Executive Summary\n`;
    prompt += `2. Key Findings\n`;
    prompt += `3. Supporting Details\n`;
    prompt += `4. Sources & References (when applicable)\n\n`;
    prompt += `Provide thorough, well-researched information that directly addresses the query.`;

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
        prompt: prompt.substring(0, 1000), // Truncate for storage
        result: result.substring(0, 10000), // Truncate for storage
        status: 'completed',
        credits_used: creditsUsed,
        metadata: {
          depth: task.depth,
          sources: task.sources,
          model: 'anthropic/claude-3-5-sonnet'
        }
      });

      if (error) {
        console.error('Failed to save task:', error);
      }
    } catch (err) {
      console.error('Error saving task to database:', err);
    }
  };

  const toggleSource = (source: string) => {
    setTask(prev => ({
      ...prev,
      sources: prev.sources.includes(source)
        ? prev.sources.filter(s => s !== source)
        : [...prev.sources, source]
    }));
  };

  return (
    <div className="bg-white rounded-lg shadow-lg p-6 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
          <span className="text-2xl">🔍</span>
        </div>
        <div className="flex-1">
          <h3 className="text-xl font-bold text-gray-800">Research Agent</h3>
          <p className="text-sm text-gray-500">Web search, data synthesis & summarization</p>
        </div>
        {isProcessing && (
          <Loader className="w-6 h-6 text-blue-500 animate-spin" />
        )}
        {!isProcessing && result && (
          <CheckCircle className="w-6 h-6 text-green-500" />
        )}
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Research Query
          </label>
          <textarea
            value={task.query}
            onChange={(e) => setTask(prev => ({ ...prev, query: e.target.value }))}
            disabled={isProcessing}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50 disabled:cursor-not-allowed"
            rows={3}
            placeholder="What would you like to research?"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Research Depth
          </label>
          <div className="flex gap-2">
            {(['quick', 'standard', 'deep'] as const).map((depth) => (
              <button
                key={depth}
                onClick={() => !isProcessing && setTask(prev => ({ ...prev, depth }))}
                disabled={isProcessing}
                className={`px-4 py-2 rounded-md capitalize transition-all ${
                  task.depth === depth
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed'
                }`}
              >
                {depth}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Sources
          </label>
          <div className="flex flex-wrap gap-2">
            {['Web', 'Academic', 'News', 'Social'].map((source) => (
              <button
                key={source}
                onClick={() => !isProcessing && toggleSource(source.toLowerCase())}
                disabled={isProcessing}
                className={`px-3 py-1 rounded-full text-sm transition-all ${
                  task.sources.includes(source.toLowerCase())
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed'
                }`}
              >
                {source}
              </button>
            ))}
          </div>
        </div>

        <div className="flex gap-2">
          {!isProcessing ? (
            <button
              onClick={handleResearch}
              disabled={!task.query.trim()}
              className="flex-1 py-2 px-4 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors font-medium flex items-center justify-center gap-2"
            >
              <Clock className="w-4 h-4" />
              Start Research
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

        {/* Progress Indicator */}
        {isProcessing && (
          <div className="space-y-2">
            <div className="flex justify-between text-sm text-gray-600">
              <span>Researching...</span>
              <span>{progress.toFixed(0)}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div 
                className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {/* Error Display */}
        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-md">
            <div className="flex items-start gap-2">
              <XCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          </div>
        )}

        {/* Streaming/Result Display */}
        {(streamedText || result) && (
          <div className="mt-4 p-4 bg-gray-50 rounded-md border border-gray-200">
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-medium text-gray-700">
                {isProcessing ? 'Streaming Results...' : 'Results:'}
              </h4>
              {isProcessing && (
                <span className="text-xs text-blue-600 flex items-center gap-1">
                  <Loader className="w-3 h-3 animate-spin" />
                  Live
                </span>
              )}
            </div>
            <div className="prose prose-sm max-w-none">
              <p className="text-gray-600 whitespace-pre-wrap leading-relaxed">
                {streamedText || result}
              </p>
              {isProcessing && (
                <span className="inline-block w-2 h-4 bg-blue-600 animate-pulse ml-1" />
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

export default ResearchAgent;

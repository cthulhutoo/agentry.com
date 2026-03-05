import React, { useState, useRef } from 'react';
import { Loader, CheckCircle, XCircle, Terminal } from 'lucide-react';
import { streamAgentResponse, StreamingResult } from '../../services/streamingService';
import { supabase } from '../../lib/supabase';

interface CodeAgentProps {
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

interface CodeTask {
  action: 'generate' | 'review' | 'debug' | 'refactor';
  language: string;
  code: string;
  description: string;
}

const CodeAgent: React.FC<CodeAgentProps> = ({ onTaskComplete, credits = 0 }) => {
  const [task, setTask] = useState<CodeTask>({
    action: 'generate',
    language: 'typescript',
    code: '',
    description: ''
  });
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<string>('');
  const [streamedText, setStreamedText] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [creditsUsed, setCreditsUsed] = useState<number>(0);
  const [progress, setProgress] = useState<number>(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  const getCreditRequirement = (): number => {
    const actionCosts = { generate: 3, review: 2, debug: 4, refactor: 3 };
    return actionCosts[task.action];
  };

  const handleProcess = async () => {
    if (!task.description.trim() && !task.code.trim()) return;
    
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
      const prompt = buildCodePrompt(task);

      const streamingResult: StreamingResult = await streamAgentResponse('code', prompt, {
        onToken: (token, fullText) => {
          setStreamedText(fullText);
          setProgress(Math.min(fullText.length / 15, 100));
        },
        onError: (err) => {
          setError(err.message);
        }
      });

      setResult(streamingResult.text);
      setCreditsUsed(streamingResult.creditsUsed || 0);
      setProgress(100);

      onTaskComplete?.({
        agent_type: 'codeagent',
        prompt: prompt.substring(0, 1000),
        result: result || streamingResult?.text || '',
        credits_used: creditsUsed || streamingResult?.creditsUsed || 0,
        status: 'completed',
        created_at: new Date().toISOString()
      });

      await saveTaskToDatabase('code', task.description || task.code, streamingResult.text, streamingResult.creditsUsed || 0);

    } catch (err: any) {
      console.error('Code processing failed:', err);
      setError(err.message || 'Code processing failed. Please try again.');
    } finally {
      setIsProcessing(false);
      abortControllerRef.current = null;
    }
  };

  const handleStop = () => {
    abortControllerRef.current?.abort();
    setIsProcessing(false);
  };

  const buildCodePrompt = (task: CodeTask): string => {
    const actionInstructions = {
      generate: 'Create new code based on the description',
      review: 'Review the provided code for bugs, improvements, and best practices',
      debug: 'Find and fix bugs in the provided code',
      refactor: 'Improve code quality, readability, and performance'
    };

    let prompt = `Code ${task.action.toUpperCase()} Task\n\n`;
    prompt += `Language: ${task.language}\n`;
    prompt += `Action: ${task.action}\n\n`;
    prompt += `Instructions: ${actionInstructions[task.action]}\n\n`;

    if (task.action === 'generate') {
      prompt += `Description of what to create:\n${task.description}\n\n`;
      prompt += `Requirements:\n`;
      prompt += `- Write clean, well-documented ${task.language} code\n`;
      prompt += `- Include proper error handling\n`;
      prompt += `- Follow best practices and conventions\n`;
      prompt += `- Add comments for complex logic\n`;
      prompt += `- Include type hints if applicable\n\n`;
      prompt += `Please provide the complete code with explanations.`;
    } else {
      prompt += `Code to process:\n\n\`\`\`${task.language}\n${task.code}\n\`\`\`\n\n`;
      
      if (task.description) {
        prompt += `Additional context/requirements:\n${task.description}\n\n`;
      }

      prompt += `Requirements:\n`;
      prompt += `- Provide thorough analysis\n`;
      prompt += `- Include specific line references for issues\n`;
      prompt += `- Suggest concrete improvements\n`;
      prompt += `- Provide corrected code when applicable\n`;
      prompt += `- Explain your reasoning`;
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
          action: task.action,
          language: task.language,
          model: 'anthropic/claude-3.5-sonnet'
        }
      });

      if (error) console.error('Failed to save task:', error);
    } catch (err) {
      console.error('Error saving task:', err);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (task.action === 'generate') {
      setTask(prev => ({ ...prev, description: e.target.value }));
    } else {
      setTask(prev => ({ ...prev, code: e.target.value }));
    }
  };

  const languages = ['typescript', 'javascript', 'python', 'rust', 'go', 'java', 'c++', 'ruby', 'swift', 'kotlin'];

  const actionConfig = [
    { key: 'generate', icon: '✨', label: 'Generate' },
    { key: 'review', icon: '👀', label: 'Review' },
    { key: 'debug', icon: '🐛', label: 'Debug' },
    { key: 'refactor', icon: '🔧', label: 'Refactor' }
  ];

  return (
    <div className="bg-white rounded-lg shadow-lg p-6 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
          <span className="text-2xl">💻</span>
        </div>
        <div className="flex-1">
          <h3 className="text-xl font-bold text-gray-800">Code Agent</h3>
          <p className="text-sm text-gray-500">Code generation, review & debugging</p>
        </div>
        {isProcessing && (
          <Loader className="w-6 h-6 text-green-500 animate-spin" />
        )}
        {!isProcessing && result && (
          <CheckCircle className="w-6 h-6 text-green-500" />
        )}
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Action
          </label>
          <div className="grid grid-cols-4 gap-2">
            {actionConfig.map(({ key, icon, label }) => (
              <button
                key={key}
                onClick={() => !isProcessing && setTask(prev => ({ ...prev, action: key as CodeTask['action'] }))}
                disabled={isProcessing}
                className={`px-3 py-2 rounded-md flex items-center justify-center gap-1 transition-all ${
                  task.action === key
                    ? 'bg-green-600 text-white shadow-md'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50'
                }`}
              >
                <span>{icon}</span>
                <span className="text-sm">{label}</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Programming Language
          </label>
          <select
            value={task.language}
            onChange={(e) => !isProcessing && setTask(prev => ({ ...prev, language: e.target.value }))}
            disabled={isProcessing}
            className="w-full px-3 py-2 border border-gray-300 rounded-md disabled:bg-gray-50 disabled:cursor-not-allowed"
          >
            {languages.map(lang => (
              <option key={lang} value={lang}>{lang.charAt(0).toUpperCase() + lang.slice(1)}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {task.action === 'generate' ? 'Description of what to create' : 'Code to process'}
          </label>
          <textarea
            value={task.action === 'generate' ? task.description : task.code}
            onChange={handleInputChange}
            disabled={isProcessing}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-green-500 focus:border-transparent font-mono text-sm disabled:bg-gray-50 disabled:cursor-not-allowed"
            rows={6}
            placeholder={task.action === 'generate' ? 'Describe the code you want to generate...' : 'Paste your code here...'}
          />
        </div>

        <div className="flex gap-2">
          {!isProcessing ? (
            <button
              onClick={handleProcess}
              disabled={!task.description.trim() && !task.code.trim()}
              className="flex-1 py-2 px-4 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors font-medium flex items-center justify-center gap-2"
            >
              <Terminal className="w-4 h-4" />
              {task.action.charAt(0).toUpperCase() + task.action.slice(1)} Code
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
                className="bg-green-600 h-2 rounded-full transition-all duration-300"
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
                <span className="text-xs text-green-600 flex items-center gap-1">
                  <Loader className="w-3 h-3 animate-spin" />
                  Live
                </span>
              )}
            </div>
            <pre className="text-gray-600 whitespace-pre-wrap font-mono text-sm overflow-x-auto">
              {streamedText || result}
              {isProcessing && (
                <span className="inline-block w-2 h-4 bg-green-600 animate-pulse ml-1" />
              )}
            </pre>
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

export default CodeAgent;

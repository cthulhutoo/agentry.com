import React, { useState, useRef } from 'react';
import { Loader, CheckCircle, XCircle, BarChart3 } from 'lucide-react';
import { streamAgentResponse, StreamingResult } from '../../services/streamingService';
import { supabase } from '../../lib/supabase';

interface DataAgentProps {
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

interface DataTask {
  action: 'analyze' | 'visualize' | 'transform' | 'predict';
  dataType: string;
  data: string;
  outputFormat: string;
}

const DataAgent: React.FC<DataAgentProps> = ({ onTaskComplete, credits = 0 }) => {
  const [task, setTask] = useState<DataTask>({
    action: 'analyze',
    dataType: 'csv',
    data: '',
    outputFormat: 'summary'
  });
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<string>('');
  const [streamedText, setStreamedText] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [creditsUsed, setCreditsUsed] = useState<number>(0);
  const [progress, setProgress] = useState<number>(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  const getCreditRequirement = (): number => {
    const actionCosts = { analyze: 2, visualize: 3, transform: 3, predict: 5 };
    return actionCosts[task.action];
  };

  const handleProcess = async () => {
    if (!task.data.trim()) return;
    
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
      const prompt = buildDataPrompt(task);

      const streamingResult: StreamingResult = await streamAgentResponse('data', prompt, {
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
        agent_type: 'dataagent',
        prompt: prompt.substring(0, 1000),
        result: result || streamingResult?.text || '',
        credits_used: creditsUsed || streamingResult?.creditsUsed || 0,
        status: 'completed',
        created_at: new Date().toISOString()
      });

      await saveTaskToDatabase('data', task.data, streamingResult.text, streamingResult.creditsUsed || 0);

    } catch (err: any) {
      console.error('Data processing failed:', err);
      setError(err.message || 'Data processing failed. Please try again.');
    } finally {
      setIsProcessing(false);
      abortControllerRef.current = null;
    }
  };

  const handleStop = () => {
    abortControllerRef.current?.abort();
    setIsProcessing(false);
  };

  const buildDataPrompt = (task: DataTask): string => {
    const actionInstructions = {
      analyze: 'Analyze the data and provide statistical summary, patterns, and insights',
      visualize: 'Describe the visualizations that would best represent this data',
      transform: 'Transform the data according to the specified output format',
      predict: 'Analyze the data and make predictions based on patterns and trends'
    };

    let prompt = `Data ${task.action.toUpperCase()} Task\n\n`;
    prompt += `Action: ${task.action}\n`;
    prompt += `Data Type: ${task.dataType}\n`;
    prompt += `Output Format: ${task.outputFormat}\n\n`;
    prompt += `Instructions: ${actionInstructions[task.action]}\n\n`;
    prompt += `Data Input:\n${task.data}\n\n`;

    const dataLines = task.data.split('\n').filter(line => line.trim());
    prompt += `Data Summary:\n`;
    prompt += `- Total lines: ${dataLines.length}\n`;
    prompt += `- Data type: ${task.dataType}\n\n`;

    prompt += `Requirements:\n`;
    prompt += `- Provide thorough ${task.action} of the data\n`;
    prompt += `- Identify patterns, trends, and outliers\n`;
    prompt += `- Include specific data points as examples\n`;
    prompt += `- Format output as ${task.outputFormat}\n`;
    prompt += `- Include actionable insights\n`;
    
    if (task.action === 'predict') {
      prompt += `- Provide confidence levels for predictions\n`;
      prompt += `- Explain methodology used for predictions`;
    } else if (task.action === 'visualize') {
      prompt += `- Describe chart types and axes\n`;
      prompt += `- Explain color coding and legends`;
    } else if (task.action === 'transform') {
      prompt += `- Show transformed data sample\n`;
      prompt += `- Document transformations applied`;
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
          dataType: task.dataType,
          outputFormat: task.outputFormat,
          dataLines: task.data.split('\n').length
        }
      });

      if (error) console.error('Failed to save task:', error);
    } catch (err) {
      console.error('Error saving task:', err);
    }
  };

  const actionConfig = [
    { key: 'analyze', icon: '📊', label: 'Analyze' },
    { key: 'visualize', icon: '📈', label: 'Visualize' },
    { key: 'transform', icon: '🔄', label: 'Transform' },
    { key: 'predict', icon: '🎯', label: 'Predict' }
  ];

  return (
    <div className="bg-white rounded-lg shadow-lg p-6 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-12 h-12 bg-orange-100 rounded-full flex items-center justify-center">
          <span className="text-2xl">📊</span>
        </div>
        <div className="flex-1">
          <h3 className="text-xl font-bold text-gray-800">Data Agent</h3>
          <p className="text-sm text-gray-500">Analysis, visualization & predictions</p>
        </div>
        {isProcessing && (
          <Loader className="w-6 h-6 text-orange-500 animate-spin" />
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
                onClick={() => !isProcessing && setTask(prev => ({ ...prev, action: key as DataTask['action'] }))}
                disabled={isProcessing}
                className={`px-3 py-2 rounded-md flex items-center justify-center gap-1 transition-all ${
                  task.action === key
                    ? 'bg-orange-600 text-white shadow-md'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50'
                }`}
              >
                <span>{icon}</span>
                <span className="text-sm">{label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Data Type
            </label>
            <select
              value={task.dataType}
              onChange={(e) => !isProcessing && setTask(prev => ({ ...prev, dataType: e.target.value }))}
              disabled={isProcessing}
              className="w-full px-3 py-2 border border-gray-300 rounded-md disabled:bg-gray-50 disabled:cursor-not-allowed"
            >
              <option value="csv">CSV</option>
              <option value="json">JSON</option>
              <option value="excel">Excel</option>
              <option value="database">Database</option>
              <option value="text">Text/Log</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Output Format
            </label>
            <select
              value={task.outputFormat}
              onChange={(e) => !isProcessing && setTask(prev => ({ ...prev, outputFormat: e.target.value }))}
              disabled={isProcessing}
              className="w-full px-3 py-2 border border-gray-300 rounded-md disabled:bg-gray-50 disabled:cursor-not-allowed"
            >
              <option value="summary">Summary</option>
              <option value="chart">Chart</option>
              <option value="table">Table</option>
              <option value="report">Full Report</option>
              <option value="json">JSON</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Data Input
          </label>
          <textarea
            value={task.data}
            onChange={(e) => setTask(prev => ({ ...prev, data: e.target.value }))}
            disabled={isProcessing}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-orange-500 focus:border-transparent font-mono text-sm disabled:bg-gray-50 disabled:cursor-not-allowed"
            rows={5}
            placeholder="Paste your data here (CSV, JSON, etc.)..."
          />
        </div>

        <div className="flex gap-2">
          {!isProcessing ? (
            <button
              onClick={handleProcess}
              disabled={!task.data.trim()}
              className="flex-1 py-2 px-4 bg-orange-600 text-white rounded-md hover:bg-orange-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors font-medium flex items-center justify-center gap-2"
            >
              <BarChart3 className="w-4 h-4" />
              Process Data
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
                className="bg-orange-600 h-2 rounded-full transition-all duration-300"
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
                {isProcessing ? 'Processing...' : 'Results:'}
              </h4>
              {isProcessing && (
                <span className="text-xs text-orange-600 flex items-center gap-1">
                  <Loader className="w-3 h-3 animate-spin" />
                  Live
                </span>
              )}
            </div>
            <pre className="text-gray-600 whitespace-pre-wrap text-sm overflow-x-auto">
              {streamedText || result}
              {isProcessing && (
                <span className="inline-block w-2 h-4 bg-orange-600 animate-pulse ml-1" />
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

export default DataAgent;

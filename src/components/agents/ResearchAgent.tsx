import React, { useState } from 'react';

interface ResearchAgentProps {
  onTaskComplete?: (result: string) => void;
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

  const handleResearch = async () => {
    if (!task.query.trim()) return;
    
    setIsProcessing(true);
    try {
      // TODO: Connect to backend research API
      const mockResult = `Research completed for: "${task.query}"\n\nKey findings:\n- Comprehensive analysis of the topic\n- Multiple sources consulted\n- Summary generated with citations`;
      setResult(mockResult);
      onTaskComplete?.(mockResult);
    } catch (error) {
      console.error('Research failed:', error);
      setResult('Research failed. Please try again.');
    } finally {
      setIsProcessing(false);
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
        <div>
          <h3 className="text-xl font-bold text-gray-800">Research Agent</h3>
          <p className="text-sm text-gray-500">Web search, data synthesis & summarization</p>
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Research Query
          </label>
          <textarea
            value={task.query}
            onChange={(e) => setTask(prev => ({ ...prev, query: e.target.value }))}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
                onClick={() => setTask(prev => ({ ...prev, depth }))}
                className={`px-4 py-2 rounded-md capitalize ${
                  task.depth === depth
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
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
                onClick={() => toggleSource(source.toLowerCase())}
                className={`px-3 py-1 rounded-full text-sm ${
                  task.sources.includes(source.toLowerCase())
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {source}
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={handleResearch}
          disabled={isProcessing || !task.query.trim()}
          className="w-full py-2 px-4 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
        >
          {isProcessing ? 'Researching...' : 'Start Research'}
        </button>

        {result && (
          <div className="mt-4 p-4 bg-gray-50 rounded-md">
            <h4 className="font-medium text-gray-700 mb-2">Results:</h4>
            <p className="text-gray-600 whitespace-pre-wrap">{result}</p>
          </div>
        )}
      </div>

      <div className="mt-4 pt-4 border-t border-gray-200">
        <p className="text-xs text-gray-500">
          Credits required: {task.depth === 'quick' ? 1 : task.depth === 'standard' ? 3 : 5} • 
          Your balance: {credits} credits
        </p>
      </div>
    </div>
  );
};

export default ResearchAgent;

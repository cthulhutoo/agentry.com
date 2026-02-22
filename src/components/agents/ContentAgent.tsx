import React, { useState } from 'react';

interface ContentAgentProps {
  onTaskComplete?: (result: string) => void;
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

  const handleGenerate = async () => {
    if (!task.input.trim()) return;
    
    setIsProcessing(true);
    try {
      // TODO: Connect to backend content API
      const mockResult = `Generated ${task.type} content:\n\n${task.input}\n\nStyle: ${task.style}\nTone: ${task.tone}\nLength: ${task.length}`;
      setResult(mockResult);
      onTaskComplete?.(mockResult);
    } catch (error) {
      console.error('Content generation failed:', error);
      setResult('Content generation failed. Please try again.');
    } finally {
      setIsProcessing(false);
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
        <div>
          <h3 className="text-xl font-bold text-gray-800">Content Agent</h3>
          <p className="text-sm text-gray-500">Writing, editing & content creation</p>
        </div>
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
                onClick={() => setTask(prev => ({ ...prev, type }))}
                className={`px-3 py-2 rounded-md flex items-center justify-center gap-1 ${
                  task.type === type
                    ? 'bg-purple-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
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
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500 focus:border-transparent"
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
              onChange={(e) => setTask(prev => ({ ...prev, style: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
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
              onChange={(e) => setTask(prev => ({ ...prev, tone: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
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
              onChange={(e) => setTask(prev => ({ ...prev, length: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
            >
              <option value="short">Short</option>
              <option value="medium">Medium</option>
              <option value="long">Long</option>
            </select>
          </div>
        </div>

        <button
          onClick={handleGenerate}
          disabled={isProcessing || !task.input.trim()}
          className="w-full py-2 px-4 bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
        >
          {isProcessing ? 'Generating...' : 'Generate Content'}
        </button>

        {result && (
          <div className="mt-4 p-4 bg-gray-50 rounded-md">
            <h4 className="font-medium text-gray-700 mb-2">Generated Content:</h4>
            <p className="text-gray-600 whitespace-pre-wrap">{result}</p>
          </div>
        )}
      </div>

      <div className="mt-4 pt-4 border-t border-gray-200">
        <p className="text-xs text-gray-500">
          Credits required: {task.length === 'short' ? 1 : task.length === 'medium' ? 2 : 4} • 
          Your balance: {credits} credits
        </p>
      </div>
    </div>
  );
};

export default ContentAgent;

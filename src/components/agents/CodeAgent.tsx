import React, { useState } from 'react';

interface CodeAgentProps {
  onTaskComplete?: (result: string) => void;
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

  const handleProcess = async () => {
    if (!task.description.trim() && !task.code.trim()) return;
    
    setIsProcessing(true);
    try {
      const mockResult = task.action === 'generate'
        ? `// Generated ${task.language} code\n\nfunction example() {\n  // Implementation based on: ${task.description}\n  return 'Generated code placeholder';\n}`
        : task.action === 'review'
        ? `Code Review Results:\n\n✓ Code structure is good\n⚠ Consider adding error handling\n💡 Suggestion: Use async/await for better readability`
        : task.action === 'debug'
        ? `Debug Analysis:\n\n🔍 Potential issues found:\n- Check variable scope on line 5\n- Missing null check on line 12\n\nSuggested fixes applied.`
        : `Refactored Code:\n\n// Improved readability and performance\n// Removed redundant code\n// Applied best practices`;
      
      setResult(mockResult);
      onTaskComplete?.(mockResult);
    } catch (error) {
      console.error('Code processing failed:', error);
      setResult('Code processing failed. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (task.action === 'generate') {
      setTask(prev => ({ ...prev, description: e.target.value }));
    } else {
      setTask(prev => ({ ...prev, code: e.target.value }));
    }
  };

  const languages = ['typescript', 'javascript', 'python', 'rust', 'go', 'java', 'c++', 'ruby'];

  return (
    <div className="bg-white rounded-lg shadow-lg p-6 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
          <span className="text-2xl">💻</span>
        </div>
        <div>
          <h3 className="text-xl font-bold text-gray-800">Code Agent</h3>
          <p className="text-sm text-gray-500">Code generation, review & debugging</p>
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Action
          </label>
          <div className="grid grid-cols-4 gap-2">
            {([
              { key: 'generate', icon: '✨', label: 'Generate' },
              { key: 'review', icon: '👀', label: 'Review' },
              { key: 'debug', icon: '🐛', label: 'Debug' },
              { key: 'refactor', icon: '🔧', label: 'Refactor' }
            ] as const).map(({ key, icon, label }) => (
              <button
                key={key}
                onClick={() => setTask(prev => ({ ...prev, action: key }))}
                className={`px-3 py-2 rounded-md flex items-center justify-center gap-1 ${
                  task.action === key
                    ? 'bg-green-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
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
            onChange={(e) => setTask(prev => ({ ...prev, language: e.target.value }))}
            className="w-full px-3 py-2 border border-gray-300 rounded-md"
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
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-green-500 focus:border-transparent font-mono text-sm"
            rows={6}
            placeholder={task.action === 'generate' ? 'Describe the code you want to generate...' : 'Paste your code here...'}
          />
        </div>

        <button
          onClick={handleProcess}
          disabled={isProcessing || (!task.description.trim() && !task.code.trim())}
          className="w-full py-2 px-4 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
        >
          {isProcessing ? 'Processing...' : `${task.action.charAt(0).toUpperCase() + task.action.slice(1)} Code`}
        </button>

        {result && (
          <div className="mt-4 p-4 bg-gray-50 rounded-md">
            <h4 className="font-medium text-gray-700 mb-2">Output:</h4>
            <pre className="text-gray-600 whitespace-pre-wrap font-mono text-sm overflow-x-auto">{result}</pre>
          </div>
        )}
      </div>

      <div className="mt-4 pt-4 border-t border-gray-200">
        <p className="text-xs text-gray-500">
          Credits required: {task.action === 'generate' ? 3 : task.action === 'review' ? 2 : 4} • 
          Your balance: {credits} credits
        </p>
      </div>
    </div>
  );
};

export default CodeAgent;

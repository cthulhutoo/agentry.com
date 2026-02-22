import React, { useState } from 'react';

interface DataAgentProps {
  onTaskComplete?: (result: string) => void;
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

  const handleProcess = async () => {
    if (!task.data.trim()) return;
    
    setIsProcessing(true);
    try {
      // TODO: Connect to backend data API
      const mockResult = task.action === 'analyze'
        ? `Data Analysis Results:\n\n📊 Dataset Summary:\n- Rows: 1,000\n- Columns: 15\n- Missing values: 23 cells\n\n📈 Key Statistics:\n- Mean: 45.2\n- Median: 42.0\n- Std Dev: 12.3\n\n🔍 Insights:\n- Strong correlation between columns A and B\n- Outliers detected in column C`
        : task.action === 'visualize'
        ? `Visualization Generated:\n\n[Chart would be displayed here]\n\nType: ${task.outputFormat}\nData points: ${task.data.split('\n').length}`
        : task.action === 'transform'
        ? `Data Transformed:\n\n✓ Cleaned missing values\n✓ Normalized numeric columns\n✓ Encoded categorical variables\\nOutput format: ${task.outputFormat}`
        : `Prediction Results:\n\n🎯 Model: Linear Regression\n📈 Accuracy: 87.3%\n\nPredictions generated for next 7 periods`;
      
      setResult(mockResult);
      onTaskComplete?.(mockResult);
    } catch (error) {
      console.error('Data processing failed:', error);
      setResult('Data processing failed. Please try again.');
    } finally {
      setIsProcessing(false);
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
        <div>
          <h3 className="text-xl font-bold text-gray-800">Data Agent</h3>
          <p className="text-sm text-gray-500">Analysis, visualization & predictions</p>
        </div>
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
                onClick={() => setTask(prev => ({ ...prev, action: key as DataTask['action'] }))}
                className={`px-3 py-2 rounded-md flex items-center justify-center gap-1 ${
                  task.action === key
                    ? 'bg-orange-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
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
              onChange={(e) => setTask(prev => ({ ...prev, dataType: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
            >
              <option value="csv">CSV</option>
              <option value="json">JSON</option>
              <option value="excel">Excel</option>
              <option value="database">Database</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Output Format
            </label>
            <select
              value={task.outputFormat}
              onChange={(e) => setTask(prev => ({ ...prev, outputFormat: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
            >
              <option value="summary">Summary</option>
              <option value="chart">Chart</option>
              <option value="table">Table</option>
              <option value="report">Full Report</option>
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
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-orange-500 focus:border-transparent font-mono text-sm"
            rows={5}
            placeholder="Paste your data here (CSV, JSON, etc.)..."
          />
        </div>

        <button
          onClick={handleProcess}
          disabled={isProcessing || !task.data.trim()}
          className="w-full py-2 px-4 bg-orange-600 text-white rounded-md hover:bg-orange-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
        >
          {isProcessing ? 'Processing...' : `Process Data`}
        </button>

        {result && (
          <div className="mt-4 p-4 bg-gray-50 rounded-md">
            <h4 className="font-medium text-gray-700 mb-2">Results:</h4>
            <pre className="text-gray-600 whitespace-pre-wrap text-sm overflow-x-auto">{result}</pre>
          </div>
        )}
      </div>

      <div className="mt-4 pt-4 border-t border-gray-200">
        <p className="text-xs text-gray-500">
          Credits required: {task.action === 'predict' ? 5 : task.action === 'analyze' ? 2 : 3} • 
          Your balance: {credits} credits
        </p>
      </div>
    </div>
  );
};

export default DataAgent;

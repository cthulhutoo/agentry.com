import React, { useState } from 'react';
import { 
  CheckCircle, 
  Clock, 
  AlertCircle, 
  Bot,
  Download,
  FileText,
  Copy,
  Star,
  Share2,
  ExternalLink
} from 'lucide-react';
import { Task } from '../lib/supabase';

interface TaskResultsProps {
  task: Task;
  onRateTask?: (rating: number) => void;
}

interface Result {
  agent_name: string;
  response: string;
}

const statusConfig = {
  pending: { icon: Clock, color: 'text-amber-600', bg: 'bg-amber-50', label: 'Pending' },
  processing: { icon: Clock, color: 'text-blue-600', bg: 'bg-blue-50', label: 'Processing' },
  completed: { icon: CheckCircle, color: 'text-green-600', bg: 'bg-green-50', label: 'Completed' },
  failed: { icon: AlertCircle, color: 'text-red-600', bg: 'bg-red-50', label: 'Failed' },
  archived: { icon: Clock, color: 'text-slate-600', bg: 'bg-slate-50', label: 'Archived' }
};

export function TaskResults({ task, onRateTask }: TaskResultsProps) {
  const [rating, setRating] = useState<number>(task.rating || 0);
  const [hoverRating, setHoverRating] = useState<number>(0);
  const [copied, setCopied] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [expandedResult, setExpandedResult] = useState<number | null>(null);

  // Handle legacy task format (results array) vs new format (result string)
  const hasResultsArray = 'results' in task && Array.isArray((task as any).results) && (task as any).results.length > 0;
  const results: Result[] = hasResultsArray ? (task as any).results : [{
    agent_name: task.agent_type || 'Agent',
    response: task.result || ''
  }];

  const config = statusConfig[task.status as keyof typeof statusConfig] || statusConfig.pending;
  const Icon = config.icon;

  const handleRate = async (newRating: number) => {
    setRating(newRating);
    if (onRateTask) {
      onRateTask(newRating);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const exportToMarkdown = () => {
    const markdown = generateMarkdown(task, results);
    downloadFile(markdown, `task-${task.id.slice(0, 8)}.md`, 'text/markdown');
    setExportMenuOpen(false);
  };

  const exportToPDF = async () => {
    // Simple PDF export using print functionality
    const printContent = generateHTMLForPrint(task, results);
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(printContent);
      printWindow.document.close();
      printWindow.focus();
      setTimeout(() => {
        printWindow.print();
      }, 250);
    }
    setExportMenuOpen(false);
  };

  const copyAllToClipboard = () => {
    const allText = results.map(r => `## ${r.agent_name}\n\n${r.response}\n\n`).join('\n---\n\n');
    copyToClipboard(allText);
    setExportMenuOpen(false);
  };

  const downloadFile = (content: string, filename: string, mimeType: string) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const generateMarkdown = (task: Task, results: Result[]): string => {
    const date = new Date(task.created_at).toLocaleString();
    let md = `# Task Result\n\n`;
    md += `**Date:** ${date}\n`;
    md += `**Status:** ${config.label}\n`;
    md += `**Agent:** ${task.agent_type}\n\n`;
    md += `## Prompt\n\n${task.prompt}\n\n`;
    md += `## Results\n\n`;
    
    results.forEach((result, idx) => {
      md += `### ${result.agent_name}\n\n${result.response}\n\n`;
    });
    
    if (task.credits_used) {
      md += `---\n\n**Credits Used:** ${task.credits_used}\n`;
    }
    
    return md;
  };

  const generateHTMLForPrint = (task: Task, results: Result[]): string => {
    const date = new Date(task.created_at).toLocaleString();
    let html = `<!DOCTYPE html>
<html>
<head>
  <title>Task Result - ${task.id.slice(0, 8)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; line-height: 1.6; }
    h1 { color: #1e293b; border-bottom: 2px solid #e2e8f0; padding-bottom: 10px; }
    h2 { color: #334155; margin-top: 30px; }
    h3 { color: #475569; }
    .meta { color: #64748b; margin-bottom: 20px; }
    .prompt { background: #f8fafc; padding: 15px; border-radius: 8px; margin-bottom: 20px; border-left: 4px solid #6366f1; }
    .result { background: #f8fafc; padding: 15px; border-radius: 8px; margin-bottom: 20px; }
    .agent-name { font-weight: 600; color: #4f46e5; margin-bottom: 10px; }
    .response { white-space: pre-wrap; }
    pre { background: #1e293b; color: #e2e8f0; padding: 15px; border-radius: 8px; overflow-x: auto; }
    code { background: #e2e8f0; padding: 2px 6px; border-radius: 4px; font-size: 0.9em; }
    .credits { color: #64748b; font-size: 0.9em; margin-top: 30px; }
  </style>
</head>
<body>
  <h1>Task Result</h1>
  <div class="meta">
    <p><strong>Date:</strong> ${date}</p>
    <p><strong>Status:</strong> ${config.label}</p>
    <p><strong>Agent:</strong> ${task.agent_type}</p>
  </div>
  
  <h2>Prompt</h2>
  <div class="prompt">${task.prompt}</div>
  
  <h2>Results</h2>`;

    results.forEach((result) => {
      html += `
  <div class="result">
    <div class="agent-name">${result.agent_name}</div>
    <div class="response">${result.response}</div>
  </div>`;
    });

    if (task.credits_used) {
      html += `
  <div class="credits">Credits Used: ${task.credits_used}</div>`;
    }

    html += `
</body>
</html>`;

    return html;
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="p-6 border-b border-slate-200">
        <div className="flex items-start justify-between mb-3">
          <h3 className="text-lg font-semibold text-slate-900">Task Results</h3>
          <div className="flex items-center gap-2">
            <span className={`px-3 py-1 rounded-full text-sm font-medium ${config.bg} ${config.color} flex items-center gap-1.5`}>
              <Icon className="w-4 h-4" />
              {config.label}
            </span>
          </div>
        </div>
        <p className="text-slate-700 text-sm">{task.prompt}</p>
        <div className="flex items-center gap-4 mt-2 text-xs text-slate-500">
          <span>Submitted {new Date(task.created_at).toLocaleString()}</span>
          {task.credits_used && (
            <span>• {task.credits_used} credits</span>
          )}
        </div>
      </div>

      {/* Rating (only for completed tasks) */}
      {task.status === 'completed' && (
        <div className="px-6 py-3 bg-slate-50 border-b border-slate-200">
          <div className="flex items-center gap-4">
            <span className="text-sm text-slate-600">Rate this result:</span>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  onClick={() => handleRate(star)}
                  onMouseEnter={() => setHoverRating(star)}
                  onMouseLeave={() => setHoverRating(0)}
                  className="focus:outline-none focus:ring-2 focus:ring-slate-400 rounded"
                  title={`${star} star${star > 1 ? 's' : ''}`}
                >
                  <Star
                    className={`w-5 h-5 transition-colors ${
                      star <= (hoverRating || rating)
                        ? 'text-amber-400 fill-amber-400'
                        : 'text-slate-300'
                    }`}
                  />
                </button>
              ))}
            </div>
            {rating > 0 && (
              <span className="text-xs text-slate-500">({rating} / 5)</span>
            )}
          </div>
        </div>
      )}

      {/* Export Actions */}
      {task.status === 'completed' && (
        <div className="px-6 py-3 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <div className="relative">
              <button
                onClick={() => setExportMenuOpen(!exportMenuOpen)}
                className="flex items-center gap-2 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <Download className="w-4 h-4" />
                Export
              </button>

              {exportMenuOpen && (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setExportMenuOpen(false)}
                  />
                  <div className="absolute top-full left-0 mt-1 w-48 bg-white rounded-lg shadow-lg border border-slate-200 py-1 z-20">
                    <button
                      onClick={exportToMarkdown}
                      className="w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                    >
                      <FileText className="w-4 h-4" />
                      Markdown (.md)
                    </button>
                    <button
                      onClick={exportToPDF}
                      className="w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                    >
                      <Download className="w-4 h-4" />
                      Print / PDF
                    </button>
                    <button
                      onClick={copyAllToClipboard}
                      className="w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                    >
                      <Copy className="w-4 h-4" />
                      Copy All
                    </button>
                  </div>
                </>
              )}
            </div>

            <button
              onClick={() => {
                const allText = results.map(r => `${r.agent_name}: ${r.response}`).join('\n\n');
                copyToClipboard(allText);
              }}
              className="flex items-center gap-2 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
              title="Copy to clipboard"
            >
              {copied ? (
                <>
                  <CheckCircle className="w-4 h-4 text-green-500" />
                  Copied!
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" />
                  Copy
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Results Content */}
      <div className="p-6 space-y-4">
        {task.status === 'processing' && (
          <div className="flex items-center justify-center py-12">
            <div className="text-center">
              <div className="w-16 h-16 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-full flex items-center justify-center mx-auto mb-4 animate-pulse">
                <Bot className="w-8 h-8 text-white" />
              </div>
              <p className="text-slate-600 font-medium">Council is analyzing your request...</p>
              <p className="text-sm text-slate-500 mt-1">This may take a moment</p>
            </div>
          </div>
        )}

        {task.status === 'completed' && results.length > 0 && (
          <div className="space-y-4">
            {results.map((result, idx) => (
              <div
                key={idx}
                className={`border border-slate-200 rounded-lg overflow-hidden hover:border-slate-300 transition-colors ${
                  expandedResult === idx ? 'ring-2 ring-slate-200' : ''
                }`}
              >
                <div
                  className="flex items-center justify-between p-4 cursor-pointer hover:bg-slate-50"
                  onClick={() => setExpandedResult(expandedResult === idx ? null : idx)}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-white font-bold">
                      {result.agent_name.charAt(0)}
                    </div>
                    <span className="font-semibold text-slate-900">{result.agent_name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        copyToClipboard(result.response);
                      }}
                      className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded"
                      title="Copy"
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpandedResult(expandedResult === idx ? null : idx);
                      }}
                      className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded"
                      title={expandedResult === idx ? 'Collapse' : 'Expand'}
                    >
                      <ExternalLink className={`w-4 h-4 transition-transform ${expandedResult === idx ? 'rotate-180' : ''}`} />
                    </button>
                  </div>
                </div>

                {expandedResult === idx && (
                  <div className="p-4 pt-0">
                    <div className="bg-slate-50 rounded-lg p-4">
                      <p className="text-slate-700 text-sm whitespace-pre-wrap leading-relaxed">
                        {result.response}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {task.status === 'failed' && (
          <div className="text-center py-8">
            <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-3" />
            <p className="text-slate-600 font-medium">Task processing failed</p>
            <p className="text-sm text-slate-500 mt-1">Please try again</p>
          </div>
        )}

        {task.status === 'pending' && (
          <div className="text-center py-8">
            <Clock className="w-12 h-12 text-amber-500 mx-auto mb-3" />
            <p className="text-slate-600 font-medium">Task is pending</p>
            <p className="text-sm text-slate-500 mt-1">Waiting in queue</p>
          </div>
        )}
      </div>
    </div>
  );
}

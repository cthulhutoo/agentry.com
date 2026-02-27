/**
 * StreamingText Component
 * Displays streaming AI response with cursor, markdown rendering, and copy functionality
 * 
 * Features:
 * - Blinking cursor animation during streaming
 * - Markdown rendering support
 * - Copy to clipboard button
 * - Auto-scroll to bottom
 * - Smooth animations with Framer Motion
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

// Simple markdown parsing - in production, use react-markdown
const parseMarkdown = (text: string): string => {
  let html = text;
  
  // Escape HTML first
  html = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  
  // Headers
  html = html.replace(/^### (.*$)/gim, '<h3 class="text-lg font-semibold mt-4 mb-2">$1</h3>');
  html = html.replace(/^## (.*$)/gim, '<h2 class="text-xl font-semibold mt-4 mb-2">$1</h2>');
  html = html.replace(/^# (.*$)/gim, '<h1 class="text-2xl font-bold mt-4 mb-2">$1</h1>');
  
  // Bold and Italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/___(.+?)___/g, '<strong><em>$1</em></strong>');
  html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
  html = html.replace(/_(.+?)_/g, '<em>$1</em>');
  
  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code class="bg-gray-800 px-1.5 py-0.5 rounded text-sm text-pink-400 font-mono">$1</code>');
  
  // Code blocks
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    return `<pre class="bg-gray-900 p-4 rounded-lg overflow-x-auto my-4"><code class="text-sm font-mono text-gray-100">${code.trim()}</code></pre>`;
  });
  
  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="text-blue-400 hover:text-blue-300 underline" target="_blank" rel="noopener noreferrer">$1</a>');
  
  // Unordered lists
  html = html.replace(/^\s*[-*+]\s+(.*$)/gim, '<li class="ml-4">$1</li>');
  
  // Ordered lists
  html = html.replace(/^\s*\d+\.\s+(.*$)/gim, '<li class="ml-4 list-decimal">$1</li>');
  
  // Blockquotes
  html = html.replace(/^>\s+(.*$)/gim, '<blockquote class="border-l-4 border-gray-600 pl-4 italic text-gray-400 my-2">$1</blockquote>');
  
  // Line breaks - convert double newlines to paragraphs
  html = html.replace(/\n\n/g, '</p><p class="my-2">');
  html = '<p class="my-2">' + html + '</p>';
  
  // Single line breaks to <br>
  html = html.replace(/\n/g, '<br>');
  
  // Clean up empty paragraphs
  html = html.replace(/<p class="my-2"><\/p>/g, '');
  
  return html;
};

interface StreamingTextProps {
  text: string;
  isStreaming: boolean;
  showCursor?: boolean;
  cursorBlinkRate?: number;
  onCopy?: (text: string) => void;
  className?: string;
}

export const StreamingText: React.FC<StreamingTextProps> = ({
  text,
  isStreaming,
  showCursor = true,
  cursorBlinkRate = 530,
  onCopy,
  className = '',
}) => {
  const [isBlinking, setIsBlinking] = useState(true);
  const [copied, setCopied] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Cursor blink animation
  useEffect(() => {
    if (!isStreaming) {
      setIsBlinking(false);
      return;
    }

    const interval = setInterval(() => {
      setIsBlinking(prev => !prev);
    }, cursorBlinkRate);

    return () => clearInterval(interval);
  }, [isStreaming, cursorBlinkRate]);

  // Auto-scroll to bottom on new content
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [text]);

  // Handle copy to clipboard
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      onCopy?.(text);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy text:', err);
    }
  }, [text, onCopy]);

  return (
    <div className={`relative ${className}`}>
      {/* Content container */}
      <div 
        ref={containerRef}
        className="prose prose-invert max-w-none overflow-y-auto max-h-[500px] pr-4"
      >
        {/* Render markdown */}
        <div 
          className="text-gray-100 leading-relaxed"
          dangerouslySetInnerHTML={{ __html: parseMarkdown(text) }}
        />
        
        {/* Cursor */}
        {showCursor && (
          <span
            className={`inline-block w-0.5 h-5 ml-0.5 align-middle transition-opacity duration-100 ${
              isStreaming && isBlinking 
                ? 'bg-gradient-to-r from-blue-400 to-purple-500 animate-pulse' 
                : 'bg-transparent'
            }`}
            aria-hidden="true"
          />
        )}
      </div>

      {/* Copy button */}
      <AnimatePresence>
        {!isStreaming && text && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ duration: 0.2 }}
            className="absolute top-2 right-2"
          >
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 
                         text-gray-300 hover:text-white rounded-lg transition-all duration-200
                         text-sm font-medium border border-gray-700 hover:border-gray-600
                         shadow-lg hover:shadow-xl"
              aria-label={copied ? 'Copied!' : 'Copy to clipboard'}
            >
              {copied ? (
                <>
                  <svg 
                    className="w-4 h-4 text-green-400" 
                    fill="none" 
                    viewBox="0 0 24 24" 
                    stroke="currentColor"
                  >
                    <path 
                      strokeLinecap="round" 
                      strokeLinejoin="round" 
                      strokeWidth={2} 
                      d="M5 13l4 4L19 7" 
                    />
                  </svg>
                  <span className="text-green-400">Copied!</span>
                </>
              ) : (
                <>
                  <svg 
                    className="w-4 h-4" 
                    fill="none" 
                    viewBox="0 0 24 24" 
                    stroke="currentColor"
                  >
                    <path 
                      strokeLinecap="round" 
                      strokeLinejoin="round" 
                      strokeWidth={2} 
                      d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" 
                    />
                  </svg>
                  <span>Copy</span>
                </>
              )}
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Streaming indicator */}
      {isStreaming && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute bottom-2 right-2 flex items-center gap-2"
        >
          <span className="flex gap-1">
            <span className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
            <span className="w-2 h-2 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
            <span className="w-2 h-2 bg-pink-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
          </span>
          <span className="text-xs text-gray-500">Streaming...</span>
        </motion.div>
      )}
    </div>
  );
};

// Export as default
export default StreamingText;

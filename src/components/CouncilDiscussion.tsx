import { useState, useEffect, useRef } from 'react';
import { X, Send, Loader, Bot, User, Sparkles, CheckCircle, RefreshCw } from 'lucide-react';
import { Agent, supabase } from '../lib/supabase';

interface Message {
  id: string;
  type: 'user' | 'agent' | 'system' | 'round';
  content: string;
  agentName?: string;
  agentSpecialty?: string;
  timestamp: Date;
  roundNumber?: number;
}

interface CouncilDiscussionProps {
  isOpen: boolean;
  onClose: () => void;
  selectedAgents: Agent[];
}

export function CouncilDiscussion({
  isOpen,
  onClose,
  selectedAgents,
}: CouncilDiscussionProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingAgent, setProcessingAgent] = useState<string | null>(null);
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);
  const [currentRound, setCurrentRound] = useState(1);
  const [maxRounds] = useState(3);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen && messages.length === 0) {
      setMessages([
        {
          id: 'welcome',
          type: 'system',
          content: `Welcome to your AI Council! You have ${selectedAgents.length} expert${selectedAgents.length > 1 ? 's' : ''} ready to provide insights: ${selectedAgents.map(a => a.name).join(', ')}. What would you like to discuss?`,
          timestamp: new Date(),
        },
      ]);
    }
  }, [isOpen, selectedAgents]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = async () => {
    if (!input.trim() || isProcessing) return;

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      type: 'user',
      content: input.trim(),
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    const promptContent = input.trim();
    setInput('');
    setIsProcessing(true);
    setCurrentRound(1);

    const { data: taskData, error: taskError } = await supabase
      .from('tasks')
      .insert({
        council_id: null,
        prompt: promptContent,
        status: 'processing',
      })
      .select()
      .single();

    if (taskError || !taskData) {
      console.error('Failed to create task:', taskError);
      setIsProcessing(false);
      return;
    }

    setCurrentTaskId(taskData.id);
    await processRound(taskData.id, promptContent, 1);
  };

  const processRound = async (taskId: string, prompt: string, roundNumber: number) => {
    setMessages(prev => [
      ...prev,
      {
        id: `round-${roundNumber}`,
        type: 'round',
        content: `Round ${roundNumber} of ${maxRounds}`,
        timestamp: new Date(),
        roundNumber,
      },
    ]);

    const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/process-council-task`;
    const headers = {
      'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
    };

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          taskId,
          councilId: 'live-discussion',
          prompt,
          agents: selectedAgents.map(agent => ({
            id: agent.id,
            name: agent.name,
            specialty: agent.specialty,
            llm_provider: agent.llm_provider,
            llm_model: agent.llm_model,
          })),
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to process council task');
      }

      const data = await response.json();

      for (const result of data.results) {
        const agentMessage: Message = {
          id: `agent-${Date.now()}-${result.agent_id}-r${roundNumber}`,
          type: 'agent',
          content: result.response,
          agentName: result.agent_name,
          agentSpecialty: selectedAgents.find(a => a.id === result.agent_id)?.specialty,
          timestamp: new Date(),
          roundNumber,
        };
        setMessages(prev => [...prev, agentMessage]);
      }

      if (data.shouldContinue && roundNumber < maxRounds) {
        setCurrentRound(roundNumber + 1);
        await new Promise(resolve => setTimeout(resolve, 2000));
        await processRound(taskId, prompt, roundNumber + 1);
      } else {
        setMessages(prev => [
          ...prev,
          {
            id: 'consensus',
            type: 'system',
            content: '✓ Discussion complete! The council has reached a consensus after reviewing multiple perspectives.',
            timestamp: new Date(),
          },
        ]);
        setIsProcessing(false);
        setProcessingAgent(null);
        setCurrentTaskId(null);
      }
    } catch (error) {
      console.error('Error processing round:', error);
      setIsProcessing(false);
      setProcessingAgent(null);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl h-[85vh] flex flex-col">
        <div className="flex items-center justify-between p-6 border-b border-slate-200 bg-gradient-to-r from-cyan-600 to-blue-600 text-white rounded-t-xl">
          <div>
            <h2 className="text-2xl font-bold flex items-center gap-2">
              <Sparkles className="w-6 h-6" />
              Council Discussion
            </h2>
            <p className="text-cyan-50 text-sm mt-1">
              In conversation with {selectedAgents.length} expert{selectedAgents.length > 1 ? 's' : ''}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full hover:bg-white/20 flex items-center justify-center transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-slate-50">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex gap-3 ${
                message.type === 'user' ? 'flex-row-reverse' : 'flex-row'
              }`}
            >
              {message.type === 'user' ? (
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center flex-shrink-0">
                  <User className="w-5 h-5 text-white" />
                </div>
              ) : message.type === 'agent' ? (
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center flex-shrink-0">
                  <Bot className="w-5 h-5 text-white" />
                </div>
              ) : message.type === 'round' ? (
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center flex-shrink-0">
                  <RefreshCw className="w-5 h-5 text-white" />
                </div>
              ) : (
                <div className="w-10 h-10 rounded-full bg-slate-300 flex items-center justify-center flex-shrink-0">
                  <Sparkles className="w-5 h-5 text-slate-600" />
                </div>
              )}

              <div
                className={`flex-1 ${
                  message.type === 'user' ? 'max-w-md ml-auto' : 'max-w-3xl'
                }`}
              >
                {message.type === 'agent' && (
                  <div className="mb-1 flex items-center gap-2">
                    <span className="font-semibold text-slate-900 text-sm">
                      {message.agentName}
                    </span>
                    <span className="text-xs text-slate-500 px-2 py-0.5 bg-slate-200 rounded-full">
                      {message.agentSpecialty}
                    </span>
                  </div>
                )}

                <div
                  className={`rounded-2xl p-4 ${
                    message.type === 'user'
                      ? 'bg-gradient-to-br from-cyan-600 to-blue-600 text-white'
                      : message.type === 'agent'
                      ? 'bg-white border-2 border-slate-200 text-slate-900'
                      : message.type === 'round'
                      ? 'bg-gradient-to-r from-amber-100 to-orange-100 border-2 border-amber-300 text-amber-900 font-semibold text-center'
                      : 'bg-amber-50 border-2 border-amber-200 text-amber-900'
                  }`}
                >
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">
                    {message.content}
                  </p>
                </div>

                <p className="text-xs text-slate-400 mt-1 px-2">
                  {message.timestamp.toLocaleTimeString()}
                </p>
              </div>
            </div>
          ))}

          {isProcessing && processingAgent && (
            <div className="flex gap-3">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center flex-shrink-0">
                <Loader className="w-5 h-5 text-white animate-spin" />
              </div>
              <div className="flex-1 max-w-3xl">
                <div className="mb-1 flex items-center gap-2">
                  <span className="font-semibold text-slate-900 text-sm">
                    {processingAgent}
                  </span>
                  <span className="text-xs text-slate-500 px-2 py-0.5 bg-slate-200 rounded-full">
                    Thinking...
                  </span>
                </div>
                <div className="bg-white border-2 border-cyan-300 rounded-2xl p-4">
                  <div className="flex items-center gap-2 text-cyan-600">
                    <Loader className="w-4 h-4 animate-spin" />
                    <span className="text-sm">Analyzing your question...</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        <div className="p-6 border-t border-slate-200 bg-white rounded-b-xl">
          <div className="flex gap-3">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Ask your council a question or share your thoughts..."
              rows={2}
              disabled={isProcessing}
              className="flex-1 px-4 py-3 border-2 border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent resize-none disabled:opacity-50 disabled:cursor-not-allowed"
            />
            <button
              onClick={handleSubmit}
              disabled={!input.trim() || isProcessing}
              className="px-6 py-3 bg-gradient-to-r from-cyan-600 to-blue-600 text-white rounded-xl font-semibold hover:from-cyan-700 hover:to-blue-700 transition-all shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 self-end"
            >
              {isProcessing ? (
                <>
                  <Loader className="w-5 h-5 animate-spin" />
                  Processing
                </>
              ) : (
                <>
                  <Send className="w-5 h-5" />
                  Send
                </>
              )}
            </button>
          </div>
          <p className="text-xs text-slate-500 mt-2">
            Press Enter to send, Shift+Enter for new line
          </p>
        </div>
      </div>
    </div>
  );
}

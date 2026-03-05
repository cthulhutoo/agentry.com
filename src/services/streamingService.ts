/**
 * Streaming Service Layer
 * 
 * Provides a simplified service layer for agent streaming operations.
 * Wraps the useStreamingResponse hook functionality for direct API calls.
 * 
 * Features:
 * - Connect to /api/stream endpoint via SSE
 * - Handle authentication with Supabase tokens
 * - Manage reconnection logic
 * - Parse and forward streaming events
 * - Credit deduction tracking
 */

import { supabase } from '../lib/supabase';

// ============================================================================
// TYPES
// ============================================================================

export interface StreamingMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface StreamingOptions {
  provider?: 'openai' | 'anthropic' | 'openrouter';
  model?: string;
  councilId?: string;
  agentId?: string;
  temperature?: number;
  maxTokens?: number;
  onToken?: (token: string, fullText: string) => void;
  onProgress?: (progress: number) => void;
  onComplete?: (result: StreamingResult) => void;
  onError?: (error: Error) => void;
}

export interface StreamingResult {
  text: string;
  usage?: UsageStats;
  creditsUsed?: number;
  finishReason?: string;
}

export interface UsageStats {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export type StreamingStatus = 'idle' | 'connecting' | 'streaming' | 'complete' | 'error';

// ============================================================================
// STREAMING SERVICE CLASS
// ============================================================================

export class StreamingService {
  private abortController: AbortController | null = null;
  private eventSource: EventSource | null = null;
  private currentStatus: StreamingStatus = 'idle';
  private accumulatedText = '';
  private tokenCount = 0;

  // Default configuration
  private readonly defaults = {
    provider: 'openrouter' as const,
    model: 'anthropic/claude-3.5-sonnet',
    temperature: 0.7,
    maxTokens: 4096,
  };

  /**
   * Get authentication token from Supabase
   * Refreshes the session if needed to ensure a valid token
   */
  private async getAuthToken(): Promise<string> {
    const { data: { session } } = await supabase.auth.getSession();

    if (!session) {
      throw new Error('Not authenticated. Please log in to continue.');
    }

    // Refresh session to ensure we have a valid token
    // This handles expired access tokens automatically
    const { data: { session: refreshedSession }, error } = await supabase.auth.refreshSession();

    if (error) {
      console.error('Error refreshing session:', error);
      throw new Error('Session expired. Please log in again.');
    }

    if (!refreshedSession?.access_token) {
      throw new Error('Failed to obtain valid access token. Please log in again.');
    }

    return refreshedSession.access_token;
  }

  /**
   * Calculate credits used based on token count and provider
   */
  private calculateCredits(usage: UsageStats, provider: string): number {
    // Credit calculation (adjust based on pricing)
    const rates: Record<string, number> = {
      openai: 0.00003, // ~$0.03 per 1K tokens
      anthropic: 0.00004, // ~$0.04 per 1K tokens
      openrouter: 0.00002, // ~$0.02 per 1K tokens
    };
    const rate = rates[provider] || rates.openrouter;
    return Math.ceil(usage.total_tokens * rate * 100) / 100;
  }

  /**
   * Start streaming a response
   */
  async stream(
    messages: StreamingMessage[],
    options: StreamingOptions = {}
  ): Promise<StreamingResult> {
    const opts = { ...this.defaults, ...options };
    this.currentStatus = 'connecting';
    this.accumulatedText = '';
    this.tokenCount = 0;

    // Create abort controller for cancellation
    this.abortController = new AbortController();
    const { signal } = this.abortController;

    try {
      // Get auth token
      const token = await this.getAuthToken();

      // Determine endpoint
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'http://localhost:54321';
      const endpoint = `${supabaseUrl}/functions/v1/stream`;

      this.currentStatus = 'streaming';

      // Make request
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          messages,
          provider: opts.provider,
          model: opts.model,
          council_id: opts.councilId,
          agent_id: opts.agentId,
          temperature: opts.temperature,
          max_tokens: opts.maxTokens,
        }),
        signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `HTTP ${response.status}: ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('Response body is not readable');
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let usage: UsageStats | undefined;
      let finishReason: string | undefined;

      // Read stream
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ') || line === 'data: ') continue;

          const data = this.parseSSEData(line.slice(6));
          if (!data) continue;

          switch (data.type) {
            case 'token':
              this.accumulatedText += data.token;
              this.tokenCount++;
              opts.onToken?.(data.token, this.accumulatedText);
              break;

            case 'done':
              usage = data.usage;
              finishReason = data.finish_reason;
              break;

            case 'error':
              const err = new Error(data.error);
              this.currentStatus = 'error';
              opts.onError?.(err);
              throw err;
          }
        }
      }

      this.currentStatus = 'complete';
      
      const creditsUsed = usage ? this.calculateCredits(usage, opts.provider) : 0;
      const result: StreamingResult = {
        text: this.accumulatedText,
        usage,
        creditsUsed,
        finishReason,
      };

      opts.onComplete?.(result);
      return result;

    } catch (err: any) {
      this.currentStatus = 'error';
      if (err.name !== 'AbortError') {
        opts.onError?.(err);
      }
      throw err;
    }
  }

  /**
   * Stop the current stream
   */
  stop(): void {
    this.abortController?.abort();
    this.currentStatus = 'idle';
  }

  /**
   * Get current status
   */
  getStatus(): StreamingStatus {
    return this.currentStatus;
  }

  /**
   * Get accumulated text so far
   */
  getAccumulatedText(): string {
    return this.accumulatedText;
  }

  /**
   * Parse SSE data
   */
  private parseSSEData(data: string): any {
    try {
      return JSON.parse(data);
    } catch {
      return null;
    }
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

export const streamingService = new StreamingService();

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Create a streaming request for a specific agent type
 */
export async function streamAgentResponse(
  agentType: string,
  prompt: string,
  options: StreamingOptions = {}
): Promise<StreamingResult> {
  const messages: StreamingMessage[] = [
    {
      role: 'system',
      content: getSystemPromptForAgent(agentType),
    },
    {
      role: 'user',
      content: prompt,
    },
  ];

  return streamingService.stream(messages, {
    ...options,
    agentId: agentType,
  });
}

/**
 * Get system prompt for specific agent type
 */
function getSystemPromptForAgent(agentType: string): string {
  const prompts: Record<string, string> = {
    research: 'You are a Research Agent. Your task is to conduct comprehensive research on the given topic, gather information from multiple sources, and provide well-structured findings with citations.',
    content: 'You are a Content Agent. Your task is to create high-quality, engaging content for blogs, social media, marketing materials, or any other specified format.',
    code: 'You are a Code Agent. Your task is to write, debug, review, and explain code in any programming language. Provide clean, well-documented, and efficient solutions.',
    data: 'You are a Data Agent. Your task is to analyze data, create visualizations, identify patterns, and provide insights from datasets.',
    communication: 'You are a Communication Agent. Your task is to craft professional emails, social media posts, and other communications with the appropriate tone and style.',
  };

  return prompts[agentType] || 'You are a helpful AI assistant.';
}

// ============================================================================
// EXPORTS
// ============================================================================

export default streamingService;

/**
 * Agentry.com Streaming Edge Function
 * Real-time streaming API for AI agent responses with SSE
 * 
 * Features:
 * - Multi-provider support (OpenAI, Anthropic, OpenRouter)
 * - JWT authentication via Supabase
 * - Per-user rate limiting
 * - Session tracking
 * - SSE event streaming
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts';

// ============================================================================
// TYPES
// ============================================================================

interface StreamRequest {
  messages: Message[];
  provider: 'openai' | 'anthropic' | 'openrouter';
  model: string;
  council_id?: string;
  agent_id?: string;
  temperature?: number;
  max_tokens?: number;
  stream_options?: {
    include_usage?: boolean;
    include_reasoning?: boolean;
  };
}

interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

interface SSEEvent {
  type: 'token' | 'error' | 'done' | 'heartbeat';
  token?: string;
  index?: number;
  done?: boolean;
  error?: string;
  code?: string;
  retry?: boolean;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  finish_reason?: string;
  timestamp?: number;
}

// Valid models per provider
const VALID_MODELS: Record<string, string[]> = {
  openai: ['gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo', 'gpt-4o', 'gpt-4o-mini', 'o1', 'o1-mini'],
  anthropic: ['claude-3-5-sonnet-20241022', 'claude-3-opus-20240229', 'claude-3-sonnet-20240229', 'claude-3-haiku-20240307'],
  openrouter: ['openai/gpt-4-turbo', 'anthropic/claude-3.5-sonnet', 'google/gemini-pro', 'meta-llama/llama-3.1-70b-instruct'],
};

// Rate limit configuration
const RATE_LIMIT = {
  requestsPerMinute: 60,
  concurrentStreams: 5,
};

// ============================================================================
// AUTHENTICATION MIDDLEWARE
// ============================================================================

async function authenticateRequest(req: Request): Promise<{ userId: string }> {
  const authHeader = req.headers.get('Authorization');
  
  if (!authHeader) {
    throw new Error('Missing authorization header', { cause: 'unauthorized' });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  
  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error } = await supabase.auth.getUser(token);
  
  if (error || !user) {
    throw new Error('Invalid or expired token', { cause: 'unauthorized' });
  }

  return { userId: user.id };
}

// ============================================================================
// RATE LIMITING
// ============================================================================

async function checkRateLimit(supabase: any, userId: string, endpoint: string): Promise<{
  allowed: boolean;
  retryAfter?: number;
  remaining?: number;
  limit?: number;
}> {
  const windowStart = new Date();
  windowStart.setSeconds(windowStart.getSeconds() - 60);

  // Check request count in current window
  const { data: rateData, error } = await supabase
    .from('api_rate_limits')
    .select('requests_count')
    .eq('user_id', userId)
    .eq('endpoint', endpoint)
    .gte('window_start', windowStart.toISOString())
    .single();

  if (error && error.code !== 'PGRST116') {
    console.error('Rate limit check error:', error);
    return { allowed: true }; // Fail open on DB errors
  }

  const currentCount = rateData?.requests_count ?? 0;
  const limit = RATE_LIMIT.requestsPerMinute;
  const remaining = Math.max(0, limit - currentCount);

  if (currentCount >= limit) {
    return {
      allowed: false,
      retryAfter: 60,
      remaining: 0,
      limit,
    };
  }

  // Increment the counter
  if (rateData) {
    await supabase
      .from('api_rate_limits')
      .update({ requests_count: currentCount + 1 })
      .eq('user_id', userId)
      .eq('endpoint', endpoint)
      .gte('window_start', windowStart.toISOString());
  } else {
    await supabase
      .from('api_rate_limits')
      .insert({
        user_id: userId,
        endpoint,
        requests_count: 1,
        window_start: new Date().toISOString(),
      });
  }

  return { allowed: true, remaining, limit };
}

// ============================================================================
// INPUT VALIDATION
// ============================================================================

const StreamRequestSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(['system', 'user', 'assistant', 'tool']),
    content: z.string().min(1).max(100000),
  })).min(1),
  provider: z.enum(['openai', 'anthropic', 'openrouter']),
  model: z.string().min(1).max(100),
  council_id: z.string().uuid().optional(),
  agent_id: z.string().uuid().optional(),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().min(1).max(32000).optional(),
  stream_options: z.object({
    include_usage: z.boolean().optional(),
    include_reasoning: z.boolean().optional(),
  }).optional(),
});

function validateRequest(body: unknown): StreamRequest {
  const result = StreamRequestSchema.safeParse(body);
  if (!result.success) {
    throw new Error(`Validation error: ${result.error.errors.map(e => e.message).join(', ')}`, {
      cause: 'invalid_request',
    });
  }
  
  const request = result.data;
  
  // Validate model
  const validModels = VALID_MODELS[request.provider];
  if (!validModels.includes(request.model)) {
    throw new Error(`Invalid model '${request.model}' for provider '${request.provider}'. Valid models: ${validModels.join(', ')}`, {
      cause: 'invalid_request',
    });
  }
  
  return request;
}

// ============================================================================
// PROVIDER IMPLEMENTATIONS
// ============================================================================

async function* streamWithOpenAI(request: StreamRequest): AsyncGenerator<SSEEvent> {
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) {
    throw new Error('OpenAI API key not configured', { cause: 'provider_error' });
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: request.model,
      messages: request.messages,
      temperature: request.temperature ?? 0.7,
      max_tokens: request.max_tokens ?? 4096,
      stream: true,
      stream_options: request.stream_options?.include_usage 
        ? { include_usage: true } 
        : undefined,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API error: ${error}`, { cause: 'provider_error' });
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('Failed to read response stream', { cause: 'provider_error' });
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let index = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      if (line.includes('[DONE]')) continue;

      const data = line.slice(6);
      try {
        const chunk = JSON.parse(data);
        const delta = chunk.choices?.[0]?.delta;
        
        if (delta?.content) {
          yield {
            type: 'token',
            token: delta.content,
            index: index++,
            done: false,
          };
        }

        // Handle usage in final chunk
        if (chunk.usage) {
          yield {
            type: 'done',
            done: true,
            usage: {
              prompt_tokens: chunk.usage.prompt_tokens,
              completion_tokens: chunk.usage.completion_tokens,
              total_tokens: chunk.usage.total_tokens,
            },
            finish_reason: chunk.choices?.[0]?.finish_reason || 'stop',
          };
        }
      } catch {
        // Skip malformed JSON
      }
    }
  }
}

async function* streamWithAnthropic(request: StreamRequest): AsyncGenerator<SSEEvent> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) {
    throw new Error('Anthropic API key not configured', { cause: 'provider_error' });
  }

  // Convert messages to Anthropic format
  const anthropicMessages = request.messages.map(m => ({
    role: m.role === 'system' ? 'user' : m.role,
    content: m.content,
  }));

  // Add system prompt if present
  const systemMessages = request.messages.filter(m => m.role === 'system');
  const system = systemMessages.map(m => m.content).join('\n');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: request.model,
      messages: anthropicMessages,
      system: system || undefined,
      temperature: request.temperature ?? 0.7,
      max_tokens: request.max_tokens ?? 4096,
      stream: true,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Anthropic API error: ${error}`, { cause: 'provider_error' });
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('Failed to read response stream', { cause: 'provider_error' });
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let index = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;

      const data = line.slice(6);
      try {
        const chunk = JSON.parse(data);
        
        if (chunk.type === 'content_block_delta') {
          const delta = chunk.delta;
          if (delta.type === 'text_delta') {
            yield {
              type: 'token',
              token: delta.text,
              index: index++,
              done: false,
            };
          }
        } else if (chunk.type === 'message_delta') {
          yield {
            type: 'done',
            done: true,
            usage: {
              prompt_tokens: chunk.usage.input_tokens,
              completion_tokens: chunk.usage.output_tokens,
              total_tokens: chunk.usage.input_tokens + chunk.usage.output_tokens,
            },
            finish_reason: chunk.delta?.stop_reason || 'stop',
          };
        }
      } catch {
        // Skip malformed JSON
      }
    }
  }
}

async function* streamWithOpenRouter(request: StreamRequest): AsyncGenerator<SSEEvent> {
  const apiKey = Deno.env.get('OPENROUTER_API_KEY');
  if (!apiKey) {
    throw new Error('OpenRouter API key not configured', { cause: 'provider_error' });
  }

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://agentry.com',
      'X-Title': 'Agentry.com',
    },
    body: JSON.stringify({
      model: request.model,
      messages: request.messages,
      temperature: request.temperature ?? 0.7,
      max_tokens: request.max_tokens ?? 4096,
      stream: true,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenRouter API error: ${error}`, { cause: 'provider_error' });
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('Failed to read response stream', { cause: 'provider_error' });
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let index = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      if (line.includes('[DONE]')) continue;

      const data = line.slice(6);
      try {
        const chunk = JSON.parse(data);
        const delta = chunk.choices?.[0]?.delta;
        
        if (delta?.content) {
          yield {
            type: 'token',
            token: delta.content,
            index: index++,
            done: false,
          };
        }

        if (chunk.usage) {
          yield {
            type: 'done',
            done: true,
            usage: {
              prompt_tokens: chunk.usage.prompt_tokens,
              completion_tokens: chunk.usage.completion_tokens,
              total_tokens: chunk.usage.total_tokens,
            },
            finish_reason: chunk.choices?.[0]?.finish_reason || 'stop',
          };
        }
      } catch {
        // Skip malformed JSON
      }
    }
  }
}

// ============================================================================
// SSE ENCODING
// ============================================================================

function encodeSSE(event: SSEEvent): string {
  const data = JSON.stringify(event);
  return `data: ${data}\n\n`;
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
    });
  }

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  };

  try {
    // 1. Authenticate
    const { userId } = await authenticateRequest(req);

    // 2. Parse and validate request
    const body = await req.json();
    const request = validateRequest(body);

    // 3. Check rate limits
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const rateLimit = await checkRateLimit(supabase, userId, '/api/stream');
    if (!rateLimit.allowed) {
      return new Response(
        JSON.stringify({
          error: 'rate_limit',
          message: 'Rate limit exceeded. Please try again later.',
        }),
        {
          status: 429,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
            'Retry-After': String(rateLimit.retryAfter || 60),
            'X-RateLimit-Limit': String(rateLimit.limit || 60),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + (rateLimit.retryAfter || 60)),
          },
        }
      );
    }

    // 4. Create streaming session
    const { data: session, error: sessionError } = await supabase
      .from('streaming_sessions')
      .insert({
        user_id: userId,
        council_id: request.council_id,
        agent_id: request.agent_id,
        provider: request.provider,
        model: request.model,
        status: 'streaming',
      })
      .select()
      .single();

    if (sessionError) {
      console.error('Failed to create session:', sessionError);
    }

    // 5. Stream response
    const encoder = new TextEncoder();
    let tokenIndex = 0;

    const stream = new ReadableStream({
      async start(controller) {
        try {
          let generator: AsyncGenerator<SSEEvent>;
          
          switch (request.provider) {
            case 'openai':
              generator = streamWithOpenAI(request);
              break;
            case 'anthropic':
              generator = streamWithAnthropic(request);
              break;
            case 'openrouter':
              generator = streamWithOpenRouter(request);
              break;
            default:
              throw new Error(`Unknown provider: ${request.provider}`);
          }

          for await (const event of generator) {
            // Send heartbeat every 30 seconds
            if (tokenIndex > 0 && tokenIndex % 30 === 0) {
              controller.enqueue(encoder.encode(encodeSSE({
                type: 'heartbeat',
                timestamp: Math.floor(Date.now() / 1000),
              })));
            }
            
            controller.enqueue(encoder.encode(encodeSSE(event)));
            tokenIndex++;
          }

          // Update session as completed
          if (session) {
            await supabase
              .from('streaming_sessions')
              .update({ status: 'completed', ended_at: new Date().toISOString() })
              .eq('id', session.id);
          }

        } catch (error: any) {
          const errorCode = error.cause || 'unknown';
          const isRetryable = ['provider_error', 'rate_limit', 'timeout'].includes(errorCode);
          
          controller.enqueue(encoder.encode(encodeSSE({
            type: 'error',
            error: error.message || 'An unexpected error occurred',
            code: errorCode,
            retry: isRetryable,
          })));

          // Update session as error
          if (session) {
            await supabase
              .from('streaming_sessions')
              .update({
                status: 'error',
                ended_at: new Date().toISOString(),
                error_code: errorCode,
                error_message: error.message,
              })
              .eq('id', session.id);
          }
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, { headers: corsHeaders });

  } catch (error: any) {
    const errorCode = error.cause || 'unknown';
    const isAuthError = errorCode === 'unauthorized';
    const isValidationError = errorCode === 'invalid_request';

    console.error('Stream error:', error);

    return new Response(
      JSON.stringify({
        error: isAuthError ? 'unauthorized' : isValidationError ? 'invalid_request' : 'server_error',
        message: error.message,
        code: errorCode,
      }),
      {
        status: isAuthError ? 401 : isValidationError ? 400 : 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});

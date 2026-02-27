/**
 * Agentry.com Analytics Events Edge Function
 * Event collection API for tracking AI agent interactions
 *
 * Features:
 * - Batch event collection
 * - Event validation
 * - Automatic cost calculation
 * - Real-time insertion
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts';

// ============================================================================
// TYPES
// ============================================================================

interface UsageEvent {
  user_id?: string;
  agent_id: string;
  event_type: 'conversation_start' | 'conversation_message' | 'conversation_end' | 'tool_execution' | 'agent_invocation' | 'api_call';
  event_subtype?: string;
  tokens_used?: number;
  cost_cents?: number;
  model_used?: string;
  response_time_ms?: number;
  success?: boolean;
  error_message?: string;
  metadata?: Record<string, unknown>;
}

// Valid event types
const VALID_EVENT_TYPES = [
  'conversation_start',
  'conversation_message',
  'conversation_end',
  'tool_execution',
  'agent_invocation',
  'api_call'
] as const;

// Cost calculation per 1K tokens (in cents)
const TOKEN_COSTS: Record<string, number> = {
  'gpt-4o': 15.0,
  'gpt-4o-mini': 0.15,
  'gpt-4-turbo': 10.0,
  'gpt-4': 30.0,
  'gpt-3.5-turbo': 0.5,
  'o1': 60.0,
  'o1-mini': 10.0,
  'claude-3-5-sonnet-20241022': 15.0,
  'claude-3-opus-20240229': 75.0,
  'claude-3-sonnet-20240229': 15.0,
  'claude-3-haiku-20240307': 0.25,
};

// ============================================================================
// VALIDATION SCHEMAS
// ============================================================================

const eventSchema = z.object({
  user_id: z.string().uuid().optional(),
  agent_id: z.string().uuid(),
  event_type: z.enum(VALID_EVENT_TYPES),
  event_subtype: z.string().optional(),
  tokens_used: z.number().int().min(0).optional(),
  cost_cents: z.number().int().min(0).optional(),
  model_used: z.string().optional(),
  response_time_ms: z.number().int().min(0).optional(),
  success: z.boolean().optional(),
  error_message: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const batchEventSchema = z.object({
  events: z.array(eventSchema).min(1).max(100),
});

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function calculateCost(tokens: number, model: string | undefined): number {
  if (!model || !tokens) return 0;
  const costPer1K = TOKEN_COSTS[model] || 1.0; // Default fallback
  return Math.round((tokens / 1000) * costPer1K * 100); // Convert to cents
}

function getUserIdFromToken(authHeader: string, supabaseUrl: string, supabaseServiceKey: string): string | null {
  try {
    const token = authHeader.replace('Bearer ', '');
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { data: { user } } = supabase.auth.getUser(token);
    return user?.id || null;
  } catch {
    return null;
  }
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

Deno.serve(async (req) => {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed', message: 'Only POST method is supported' }),
      { status: 405, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Get environment variables
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  
  if (!supabaseUrl || !supabaseServiceKey) {
    return new Response(
      JSON.stringify({ error: 'Configuration error', message: 'Missing Supabase configuration' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Create Supabase client with service role (for internal API)
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // Parse request body
    const body = await req.json();
    
    // Validate input - support both single event and batch
    let events: UsageEvent[];
    if (body.events) {
      // Batch events
      const parsed = batchEventSchema.safeParse(body);
      if (!parsed.success) {
        return new Response(
          JSON.stringify({ error: 'Validation error', details: parsed.error.errors }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }
      events = parsed.data.events;
    } else {
      // Single event
      const parsed = eventSchema.safeParse(body);
      if (!parsed.success) {
        return new Response(
          JSON.stringify({ error: 'Validation error', details: parsed.error.errors }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }
      events = [parsed.data];
    }

    // Get user ID from auth header if available
    const authHeader = req.headers.get('Authorization');
    let userId: string | null = null;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      userId = getUserIdFromToken(authHeader, supabaseUrl, supabaseServiceKey);
    }

    // Process events
    const processedEvents = events.map(event => ({
      user_id: event.user_id || userId,
      agent_id: event.agent_id,
      event_type: event.event_type,
      event_subtype: event.event_subtype,
      tokens_used: event.tokens_used || 0,
      cost_cents: event.cost_cents ?? calculateCost(event.tokens_used || 0, event.model_used),
      model_used: event.model_used,
      response_time_ms: event.response_time_ms,
      success: event.success ?? true,
      error_message: event.error_message,
      metadata: event.metadata || {},
      created_at: new Date().toISOString(),
    }));

    // Insert events into database
    const { data, error } = await supabase
      .from('usage_events')
      .insert(processedEvents)
      .select();

    if (error) {
      console.error('Database error:', error);
      return new Response(
        JSON.stringify({ error: 'Database error', message: error.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Refresh materialized views asynchronously (non-blocking)
    // Note: In production, you might want to do this via a background job
    
    return new Response(
      JSON.stringify({
        success: true,
        message: `Successfully recorded ${data.length} event(s)`,
        events: data.map(e => ({ id: e.id })),
      }),
      { status: 201, headers: { 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Unexpected error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', message: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});

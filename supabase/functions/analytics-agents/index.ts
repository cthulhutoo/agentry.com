/**
 * Agentry.com Analytics Agents Edge Function
 * Agent performance API
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

Deno.serve(async (req) => {
  if (req.method !== 'GET') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const { searchParams } = new URL(req.url);
    const startDate = searchParams.get('start_date') || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const endDate = searchParams.get('end_date') || new Date().toISOString();
    const limit = parseInt(searchParams.get('limit') || '50');

    // Get agent performance from materialized view
    const { data: agentData, error } = await supabase
      .from('agent_usage_agg')
      .select('*')
      .order('total_cost', { ascending: false })
      .limit(limit);

    if (error) throw error;

    // Format response
    const agents = (agentData || []).map(agent => ({
      agent_id: agent.agent_id,
      total_conversations: agent.total_conversations || 0,
      total_tokens: agent.total_tokens || 0,
      total_cost_cents: agent.total_cost || 0,
      avg_response_time_ms: Math.round(agent.avg_response_time || 0),
      success_rate: Math.round((agent.success_rate_percent || 0) * 100) / 100,
      models_used: agent.models_used || 0,
      first_usage: agent.first_usage,
      last_usage: agent.last_usage,
    }));

    return new Response(
      JSON.stringify({ agents }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});

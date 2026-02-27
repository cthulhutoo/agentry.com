/**
 * Agentry.com Analytics Costs Edge Function
 * Cost analytics API
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

    // Get cost by agent
    const { data: agentCosts } = await supabase
      .from('agent_usage_agg')
      .select('agent_id, total_cost, total_tokens')
      .order('total_cost', { ascending: false });

    // Get daily cost trend
    const { data: dailyCosts } = await supabase
      .from('daily_usage_agg')
      .select('usage_date, total_cost, total_tokens')
      .gte('usage_date', startDate)
      .lte('usage_date', endDate)
      .order('usage_date', { ascending: true });

    // Calculate totals
    const totalCostCents = agentCosts?.reduce((sum, a) => sum + (a.total_cost || 0), 0) || 0;
    const totalTokens = agentCosts?.reduce((sum, a) => sum + (a.total_tokens || 0), 0) || 0;

    // Format cost by agent
    const costByAgent = (agentCosts || []).map(a => ({
      agent_id: a.agent_id,
      cost_cents: a.total_cost || 0,
      percentage: totalCostCents > 0 ? ((a.total_cost || 0) / totalCostCents * 100).toFixed(2) : 0,
    }));

    // Format cost trend
    const costTrend = (dailyCosts || []).map(d => ({
      date: d.usage_date,
      cost_cents: d.total_cost || 0,
    }));

    return new Response(
      JSON.stringify({
        total_cost_cents: totalCostCents,
        total_tokens: totalTokens,
        cost_by_agent: costByAgent,
        cost_trend: costTrend,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});

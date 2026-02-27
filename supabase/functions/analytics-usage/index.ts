/**
 * Agentry.com Analytics Usage Edge Function
 * Usage analytics API
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
    const granularity = searchParams.get('granularity') || 'daily';
    const agentId = searchParams.get('agent_id');
    const userId = searchParams.get('user_id');

    let query = supabase
      .from('daily_usage_agg')
      .select('*')
      .gte('usage_date', startDate)
      .lte('usage_date', endDate);

    if (agentId) query = query.eq('agent_id', agentId);
    if (userId) {
      // Join with usage_events to filter by user
      const { data: userEvents } = await supabase
        .from('usage_events')
        .select('created_at, tokens_used, total_events, cost_cents')
        .gte('created_at', startDate)
        .lte('created_at', endDate)
        .eq('user_id', userId);
      
      return new Response(
        JSON.stringify({ 
          granularity,
          data: userEvents || []
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const { data, error } = await query.order('usage_date', { ascending: true });

    if (error) throw error;

    // Aggregate by granularity
    const aggregated = aggregateByGranularity(data || [], granularity);

    return new Response(
      JSON.stringify({ granularity, data: aggregated }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});

function aggregateByGranularity(data: any[], granularity: string) {
  const grouped: Record<string, any> = {};

  for (const row of data) {
    const date = new Date(row.usage_date);
    let key: string;

    switch (granularity) {
      case 'hourly':
        key = `${date.toISOString().slice(0, 13)}:00:00Z`;
        break;
      case 'weekly':
        key = date.toISOString().slice(0, 10);
        break;
      case 'monthly':
        key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        break;
      default: // daily
        key = date.toISOString().slice(0, 10);
    }

    if (!grouped[key]) {
      grouped[key] = {
        period: key,
        tokens_used: 0,
        event_count: 0,
        total_cost: 0,
        unique_users: 0,
      };
    }

    grouped[key].tokens_used += row.total_tokens || 0;
    grouped[key].event_count += row.total_events || 0;
    grouped[key].total_cost += row.total_cost || 0;
    grouped[key].unique_users = Math.max(grouped[key].unique_users, row.unique_users || 0);
  }

  return Object.values(grouped);
}

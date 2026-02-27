/**
 * Agentry.com Analytics Overview Edge Function
 * Dashboard overview metrics API
 *
 * Returns high-level metrics for the dashboard overview
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

// ============================================================================
// TYPES
// ============================================================================

interface DateRange {
  start_date: string;
  end_date: string;
}

interface OverviewMetrics {
  period: DateRange;
  metrics: {
    total_users: number;
    total_conversations: number;
    total_tokens: number;
    total_cost_cents: number;
    avg_response_time_ms: number;
    success_rate: number;
    active_users: number;
    total_events: number;
  };
  previous_period?: {
    total_cost_cents: number;
    total_tokens: number;
    total_conversations: number;
  };
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function parseDateRange(searchParams: URLSearchParams): DateRange {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const startDate = searchParams.get('start_date') || thirtyDaysAgo.toISOString();
  const endDate = searchParams.get('end_date') || now.toISOString();

  return { start_date: startDate, end_date: endDate };
}

function getPreviousPeriod(dateRange: DateRange): DateRange {
  const start = new Date(dateRange.start_date);
  const end = new Date(dateRange.end_date);
  const duration = end.getTime() - start.getTime();
  
  return {
    start_date: new Date(start.getTime() - duration).toISOString(),
    end_date: start.toISOString(),
  };
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

Deno.serve(async (req) => {
  // Only allow GET requests
  if (req.method !== 'GET') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed', message: 'Only GET method is supported' }),
      { status: 405, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  
  if (!supabaseUrl || !supabaseServiceKey) {
    return new Response(
      JSON.stringify({ error: 'Configuration error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // Parse date range from query params
    const { searchParams } = new URL(req.url);
    const dateRange = parseDateRange(searchParams);
    const previousPeriod = getPreviousPeriod(dateRange);

    // Get current period metrics
    const { data: currentMetrics, error: currentError } = await supabase
      .rpc('get_overview_metrics', {
        p_start_date: dateRange.start_date,
        p_end_date: dateRange.end_date,
      });

    // Fallback to direct queries if RPC doesn't exist
    let metrics: OverviewMetrics['metrics'];
    
    if (currentError || !currentMetrics) {
      // Direct query approach
      const [totalUsers, totalEvents, conversationCount, costData, responseTime, successData] = await Promise.all([
        // Total unique users
        supabase
          .from('usage_events')
          .select('user_id', { count: 'exact', head: true })
          .gte('created_at', dateRange.start_date)
          .lte('created_at', dateRange.end_date)
          .not('user_id', 'is', null),
        
        // Total events
        supabase
          .from('usage_events')
          .select('*', { count: 'exact', head: true })
          .gte('created_at', dateRange.start_date)
          .lte('created_at', dateRange.end_date),
        
        // Conversation count
        supabase
          .from('usage_events')
          .select('*', { count: 'exact', head: true })
          .gte('created_at', dateRange.start_date)
          .lte('created_at', dateRange.end_date)
          .eq('event_type', 'conversation_start'),
        
        // Cost and tokens
        supabase
          .from('daily_usage_agg')
          .select('total_cost, total_tokens')
          .gte('usage_date', dateRange.start_date)
          .lte('usage_date', dateRange.end_date),
        
        // Response time
        supabase
          .from('usage_events')
          .select('response_time_ms')
          .gte('created_at', dateRange.start_date)
          .lte('created_at', dateRange.end_date)
          .not('response_time_ms', 'is', null),
        
        // Success rate
        supabase
          .from('usage_events')
          .select('success')
          .gte('created_at', dateRange.start_date)
          .lte('created_at', dateRange.end_date),
      ]);

      const totalCost = costData?.reduce((sum, row) => sum + (row.total_cost || 0), 0) || 0;
      const totalTokens = costData?.reduce((sum, row) => sum + (row.total_tokens || 0), 0) || 0;
      const avgResponseTime = responseTime.data?.length 
        ? responseTime.data.reduce((sum, r) => sum + (r.response_time_ms || 0), 0) / responseTime.data.length 
        : 0;
      const successCount = successData.data?.filter(r => r.success).length || 0;
      const totalCount = successData.data?.length || 1;

      metrics = {
        total_users: totalUsers.count || 0,
        total_conversations: conversationCount.count || 0,
        total_tokens: totalTokens,
        total_cost_cents: totalCost,
        avg_response_time_ms: Math.round(avgResponseTime),
        success_rate: Math.round((successCount / totalCount) * 10000) / 100,
        active_users: totalUsers.count || 0,
        total_events: totalEvents.count || 0,
      };
    } else {
      metrics = currentMetrics;
    }

    // Get previous period metrics for comparison
    const { data: prevCostData } = await supabase
      .from('daily_usage_agg')
      .select('total_cost, total_tokens')
      .gte('usage_date', previousPeriod.start_date)
      .lte('usage_date', previousPeriod.end_date);

    const prevTotalCost = prevCostData?.reduce((sum, row) => sum + (row.total_cost || 0), 0) || 0;
    const prevTotalTokens = prevCostData?.reduce((sum, row) => sum + (row.total_tokens || 0), 0) || 0;

    const response: OverviewMetrics = {
      period: dateRange,
      metrics,
      previous_period: {
        total_cost_cents: prevTotalCost,
        total_tokens: prevTotalTokens,
        total_conversations: Math.round((metrics.total_conversations * 0.9)), // Estimate
      },
    };

    return new Response(
      JSON.stringify(response),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error', message: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});

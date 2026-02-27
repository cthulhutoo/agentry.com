/**
 * Agentry.com Analytics Performance Edge Function
 * Performance metrics API
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

    // Get performance metrics from daily aggregation
    const { data: dailyData } = await supabase
      .from('daily_usage_agg')
      .select('avg_response_time, p50_response_time, p95_response_time, max_response_time, successful_events, failed_events, total_events')
      .gte('usage_date', startDate)
      .lte('usage_date', endDate);

    // Get error breakdown
    const { data: errorData } = await supabase
      .from('usage_events')
      .select('error_message, event_type')
      .gte('created_at', startDate)
      .lte('created_at', endDate)
      .eq('success', false);

    // Calculate aggregates
    let totalEvents = 0;
    let totalSuccessful = 0;
    let totalFailed = 0;
    let sumResponseTime = 0;
    let sumP50 = 0;
    let sumP95 = 0;
    let count = 0;

    for (const row of dailyData || []) {
      totalEvents += row.total_events || 0;
      totalSuccessful += row.successful_events || 0;
      totalFailed += row.failed_events || 0;
      if (row.avg_response_time) {
        sumResponseTime += row.avg_response_time;
        count++;
      }
      if (row.p50_response_time) sumP50 += row.p50_response_time;
      if (row.p95_response_time) sumP95 += row.p95_response_time;
    }

    const avgResponseTime = count > 0 ? sumResponseTime / count : 0;
    const avgP50 = count > 0 ? sumP50 / count : 0;
    const avgP95 = count > 0 ? sumP95 / count : 0;
    const successRate = totalEvents > 0 ? (totalSuccessful / totalEvents) * 100 : 0;

    // Error breakdown
    const errorBreakdown: Record<string, { count: number; percentage: number }> = {};
    for (const err of errorData || []) {
      const key = err.error_message || 'Unknown error';
      errorBreakdown[key] = (errorBreakdown[key] || { count: 0, percentage: 0 }).count + 1;
    }

    const errorList = Object.entries(errorBreakdown).map(([error_type, val]) => ({
      error_type,
      count: val.count,
      percentage: (val.count / (totalFailed || 1)) * 100,
    })).sort((a, b) => b.count - a.count).slice(0, 10);

    return new Response(
      JSON.stringify({
        avg_response_time_ms: Math.round(avgResponseTime),
        p50_response_time_ms: Math.round(avgP50),
        p95_response_time_ms: Math.round(avgP95),
        success_rate: Math.round(successRate * 100) / 100,
        error_rate: Math.round((100 - successRate) * 100) / 100,
        error_breakdown: errorList,
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

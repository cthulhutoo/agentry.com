/**
 * Agentry.com Analytics Export Edge Function
 * CSV/JSON export API
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
    const format = searchParams.get('format') || 'json'; // json or csv
    const dataType = searchParams.get('type') || 'usage'; // usage, costs, performance

    let data: any[] = [];

    switch (dataType) {
      case 'usage':
        const { data: usageData } = await supabase
          .from('daily_usage_agg')
          .select('*')
          .gte('usage_date', startDate)
          .lte('usage_date', endDate);
        data = usageData || [];
        break;

      case 'costs':
        const { data: costData } = await supabase
          .from('agent_usage_agg')
          .select('agent_id, total_cost, total_tokens, avg_cost_per_event');
        data = costData || [];
        break;

      case 'performance':
        const { data: perfData } = await supabase
          .from('daily_usage_agg')
          .select('usage_date, avg_response_time, p50_response_time, p95_response_time, successful_events, failed_events')
          .gte('usage_date', startDate)
          .lte('usage_date', endDate);
        data = perfData || [];
        break;

      default:
        return new Response(
          JSON.stringify({ error: 'Invalid export type' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
    }

    // Format output
    if (format === 'csv') {
      const headers = Object.keys(data[0] || {}).join(',');
      const rows = data.map(row => 
        Object.values(row).map(v => 
          typeof v === 'string' && v.includes(',') ? `"${v}"` : v
        ).join(',')
      );
      const csv = [headers, ...rows].join('\n');

      return new Response(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="analytics-${dataType}-export.csv"`,
        },
      });
    }

    // JSON format
    return new Response(
      JSON.stringify({ data, exported_at: new Date().toISOString() }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="analytics-${dataType}-export.json"`,
        },
      }
    );

  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});

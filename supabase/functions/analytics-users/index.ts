/**
 * Agentry.com Analytics Users Edge Function
 * User analytics API
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

    // Get DAU (daily active users)
    const { data: dauData } = await supabase
      .from('usage_events')
      .select('user_id, created_at')
      .gte('created_at', startDate)
      .lte('created_at', endDate);

    // Calculate DAU
    const dauByDate: Record<string, Set<string>> = {};
    for (const event of dauData || []) {
      const date = new Date(event.created_at).toISOString().slice(0, 10);
      if (!dauByDate[date]) dauByDate[date] = new Set();
      if (event.user_id) dauByDate[date].add(event.user_id);
    }

    const dau = Object.values(dauByDate).pop()?.size || 0;
    const mau = new Set((dauData || []).map(e => e.user_id).filter(Boolean)).size;
    const dauMauRatio = mau > 0 ? (dau / mau) * 100 : 0;

    // Get user segments
    const { data: userData } = await supabase
      .from('user_usage_agg')
      .select('user_id, total_cost, total_events, avg_response_time')
      .order('total_cost', { ascending: false });

    const userSegments = categorizeUsers(userData || []);

    return new Response(
      JSON.stringify({
        dau,
        mau,
        dau_mau_ratio: Math.round(dauMauRatio * 100) / 100,
        user_segments: userSegments,
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

function categorizeUsers(users: any[]) {
  const segments = {
    power: 0,    // > 1000 events
    regular: 0,  // 100-1000 events
    casual: 0,  // < 100 events
  };

  for (const user of users) {
    const events = user.total_events || 0;
    if (events > 1000) segments.power++;
    else if (events >= 100) segments.regular++;
    else segments.casual++;
  }

  return segments;
}

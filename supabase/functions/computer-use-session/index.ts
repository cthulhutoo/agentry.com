import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS, DELETE",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface SessionRequest {
  browser_type?: string;
  allowed_domains?: string[];
  blocked_domains?: string[];
  user_agent?: string;
  viewport?: {
    width: number;
    height: number;
    device_scale_factor?: number;
  };
  enable_recordings?: boolean;
  enable_downloads?: boolean;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // GET - List sessions
    if (req.method === "GET") {
      const url = new URL(req.url);
      const sessionId = url.pathname.split("/").pop();
      
      // Get single session
      if (sessionId && sessionId !== 'computer-use-session') {
        const { data: session, error: fetchError } = await supabase
          .from('computer_use_sessions')
          .select('*')
          .eq('id', sessionId)
          .eq('user_id', user.id)
          .single();

        if (fetchError || !session) {
          return new Response(
            JSON.stringify({ error: "Session not found" }),
            { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        return new Response(
          JSON.stringify(session),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // List all sessions
      const { data: sessions, error: listError } = await supabase
        .from('computer_use_sessions')
        .select('*')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .order('created_at', { ascending: false });

      if (listError) {
        return new Response(
          JSON.stringify({ error: listError.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ sessions: sessions || [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // POST - Create session
    let body: SessionRequest | null = null;
    const contentType = req.headers.get("content-type");
    
    if (contentType?.includes("application/json")) {
      body = await req.json();
    }

    // Handle DELETE - Terminate session
    if (req.method === "DELETE") {
      const url = new URL(req.url);
      const sessionId = url.pathname.split("/").pop();
      
      if (!sessionId || sessionId === 'computer-use-session') {
        return new Response(
          JSON.stringify({ error: "Session ID required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: session, error: fetchError } = await supabase
        .from('computer_use_sessions')
        .select('*')
        .eq('id', sessionId)
        .eq('user_id', user.id)
        .single();

      if (fetchError || !session) {
        return new Response(
          JSON.stringify({ error: "Session not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: updatedSession, error: updateError } = await supabase
        .from('computer_use_sessions')
        .update({ 
          status: 'terminated', 
          terminated_at: new Date().toISOString() 
        })
        .eq('id', sessionId)
        .select()
        .single();

      if (updateError) {
        return new Response(
          JSON.stringify({ error: updateError.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Log audit event
      await supabase.from('computer_use_audit_logs').insert({
        user_id: user.id,
        action_type: 'terminate',
        resource_type: 'computer_use_sessions',
        resource_id: sessionId,
        session_id: sessionId
      });

      return new Response(
        null,
        { status: 204, headers: corsHeaders }
      );
    }

    // Create new session
    const browserType = body?.browser_type || 'chromium';
    const viewport = body?.viewport || { width: 1280, height: 720 };

    const { data: session, error: sessionError } = await supabase
      .from('computer_use_sessions')
      .insert({
        user_id: user.id,
        browser_type: browserType,
        user_agent: body?.user_agent || null,
        viewport_width: viewport.width,
        viewport_height: viewport.height,
        device_scale_factor: viewport.device_scale_factor || 1.0,
        allowed_domains: body?.allowed_domains || [],
        blocked_domains: body?.blocked_domains || [],
        enable_recordings: body?.enable_recordings || false,
        enable_downloads: body?.enable_downloads || false,
        status: 'active',
        expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString() // 30 minutes
      })
      .select()
      .single();

    if (sessionError) {
      return new Response(
        JSON.stringify({ error: sessionError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Log audit event
    await supabase.from('computer_use_audit_logs').insert({
      user_id: user.id,
      action_type: 'create',
      resource_type: 'computer_use_sessions',
      resource_id: session.id,
      action_details: { browser_type: browserType },
      session_id: session.id
    });

    return new Response(
      JSON.stringify({
        id: session.id,
        status: session.status,
        created_at: session.created_at,
        expires_at: session.expires_at
      }),
      { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Computer use session error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

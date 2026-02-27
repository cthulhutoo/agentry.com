import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS, DELETE",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface CreateTaskRequest {
  prompt: string;
  max_steps?: number;
  timeout_ms?: number;
  session_id?: string;
  allow_downloads?: boolean;
  allowed_domains?: string[];
  blocked_domains?: string[];
  browser_type?: string;
  viewport?: {
    width: number;
    height: number;
    device_scale_factor?: number;
  };
  metadata?: Record<string, string>;
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

    // Get user credit balance
    const { data: creditData, error: creditError } = await supabase
      .from('user_credits')
      .select('credits')
      .eq('user_id', user.id)
      .single();

    if (creditError || !creditData) {
      return new Response(
        JSON.stringify({ error: "No credit account found" }),
        { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const currentBalance = creditData.credits || 0;

    // Parse request body
    let body: CreateTaskRequest;
    const contentType = req.headers.get("content-type");
    
    if (req.method === "GET") {
      // List tasks
      const url = new URL(req.url);
      const page = parseInt(url.searchParams.get("page") || "1");
      const limit = Math.min(parseInt(url.searchParams.get("limit") || "20"), 100);
      const status = url.searchParams.get("status");
      const offset = (page - 1) * limit;

      let query = supabase
        .from('computer_use_tasks')
        .select('*', { count: 'exact' })
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (status) {
        query = query.eq('status', status);
      }

      const { data: tasks, error: listError, count } = await query;

      if (listError) {
        return new Response(
          JSON.stringify({ error: listError.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({
          tasks: tasks || [],
          pagination: {
            page,
            limit,
            total: count || 0,
            total_pages: Math.ceil((count || 0) / limit)
          }
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (contentType?.includes("application/json")) {
      body = await req.json();
    } else {
      return new Response(
        JSON.stringify({ error: "Invalid content type" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Handle DELETE method for task cancellation
    if (req.method === "DELETE") {
      const taskId = req.url.split("/").pop();
      if (!taskId) {
        return new Response(
          JSON.stringify({ error: "Task ID required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: existingTask, error: fetchError } = await supabase
        .from('computer_use_tasks')
        .select('*')
        .eq('id', taskId)
        .eq('user_id', user.id)
        .single();

      if (fetchError || !existingTask) {
        return new Response(
          JSON.stringify({ error: "Task not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (['completed', 'failed', 'cancelled'].includes(existingTask.status)) {
        return new Response(
          JSON.stringify({ error: "Task cannot be cancelled - already finished" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: updatedTask, error: updateError } = await supabase
        .from('computer_use_tasks')
        .update({ status: 'cancelled', completed_at: new Date().toISOString() })
        .eq('id', taskId)
        .select()
        .single();

      if (updateError) {
        return new Response(
          JSON.stringify({ error: updateError.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ id: updatedTask.id, status: updatedTask.status }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate required fields
    if (!body.prompt || body.prompt.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: "Prompt is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (body.prompt.length > 5000) {
      return new Response(
        JSON.stringify({ error: "Prompt must be less than 5000 characters" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Calculate required credits
    const maxSteps = body.max_steps || 20;
    const timeoutMs = body.timeout_ms || 120000;
    const estimatedScreenshots = Math.ceil(maxSteps / 3);
    
    // Use the database function to calculate credits
    const { data: creditCalc } = await supabase.rpc('calculate_computer_use_credits', {
      p_steps: maxSteps,
      p_timeout_ms: timeoutMs,
      p_screenshots: estimatedScreenshots
    });

    const creditsRequired = creditCalc || (1 + maxSteps + Math.min(timeoutMs / 60000, 5) + estimatedScreenshots);

    if (currentBalance < creditsRequired) {
      return new Response(
        JSON.stringify({
          error: "insufficient_credits",
          message: "Insufficient credits for this task",
          balance: currentBalance,
          required: creditsRequired,
          upgrade_url: "/pricing"
        }),
        { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create the task
    const { data: task, error: taskError } = await supabase
      .from('computer_use_tasks')
      .insert({
        user_id: user.id,
        prompt: body.prompt,
        max_steps: maxSteps,
        timeout_ms: timeoutMs,
        session_id: body.session_id || null,
        browser_type: body.browser_type || 'chromium',
        allowed_domains: body.allowed_domains || [],
        blocked_domains: body.blocked_domains || [],
        allow_downloads: body.allow_downloads || false,
        status: 'pending',
        metadata: body.metadata || {},
        credits_charged: creditsRequired
      })
      .select()
      .single();

    if (taskError) {
      return new Response(
        JSON.stringify({ error: taskError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Deduct credits
    const { error: deductError } = await supabase.rpc('deduct_credits', {
      p_user_id: user.id,
      p_amount: creditsRequired,
      p_task_id: task.id,
      p_description: `Computer use task: ${body.prompt.substring(0, 100)}`
    });

    if (deductError) {
      // Rollback task creation
      await supabase.from('computer_use_tasks').delete().eq('id', task.id);
      return new Response(
        JSON.stringify({ error: "Failed to deduct credits" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Log audit event
    await supabase.from('computer_use_audit_logs').insert({
      user_id: user.id,
      action_type: 'create',
      resource_type: 'computer_use_tasks',
      resource_id: task.id,
      action_details: { prompt_length: body.prompt.length, max_steps: maxSteps },
      task_id: task.id
    });

    return new Response(
      JSON.stringify({
        id: task.id,
        status: task.status,
        credits_charged: creditsRequired,
        estimated_duration_ms: timeoutMs,
        created_at: task.created_at
      }),
      { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Computer use task error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

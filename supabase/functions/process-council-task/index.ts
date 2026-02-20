import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import * as Sentry from "npm:@sentry/deno@8";

const sentryDsn = Deno.env.get("SENTRY_DSN");
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    tracesSampleRate: 1.0,
    environment: "production",
  });
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface TaskRequest {
  taskId: string;
  councilId: string;
  prompt: string;
  agents: Array<{
    id: string;
    name: string;
    specialty: string;
    llm_provider: string;
    llm_model: string;
  }>;
  userId?: string;
}

interface AgentResponse {
  agent_id: string;
  agent_name: string;
  response: string;
  timestamp: string;
}

interface DiscussionRound {
  round_number: number;
  agent_responses: AgentResponse[];
  timestamp: string;
}

const RATE_LIMIT_WINDOW = 60;
const RATE_LIMIT_MAX_REQUESTS = 10;
const CREDITS_PER_AGENT = 1; // 1 credit per agent per task

async function checkRateLimit(
  supabase: any,
  identifier: string,
  endpoint: string
): Promise<{ allowed: boolean; remainingRequests: number }> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - RATE_LIMIT_WINDOW * 1000);

  const { data: existingLimit, error: fetchError } = await supabase
    .from("api_rate_limits")
    .select("*")
    .eq("identifier", identifier)
    .eq("endpoint", endpoint)
    .maybeSingle();

  if (fetchError) {
    console.error("Rate limit check error:", fetchError);
    Sentry.captureException(fetchError, {
      tags: { component: "rate-limiter" },
    });
    return { allowed: true, remainingRequests: RATE_LIMIT_MAX_REQUESTS };
  }

  if (!existingLimit) {
    await supabase.from("api_rate_limits").insert({
      identifier,
      endpoint,
      request_count: 1,
      window_start: now.toISOString(),
      last_request_at: now.toISOString(),
    });
    return { allowed: true, remainingRequests: RATE_LIMIT_MAX_REQUESTS - 1 };
  }

  const limitWindowStart = new Date(existingLimit.window_start);
  const isExpired = limitWindowStart < windowStart;

  if (isExpired) {
    await supabase
      .from("api_rate_limits")
      .update({
        request_count: 1,
        window_start: now.toISOString(),
        last_request_at: now.toISOString(),
        updated_at: now.toISOString(),
      })
      .eq("identifier", identifier)
      .eq("endpoint", endpoint);
    return { allowed: true, remainingRequests: RATE_LIMIT_MAX_REQUESTS - 1 };
  }

  if (existingLimit.request_count >= RATE_LIMIT_MAX_REQUESTS) {
    return { allowed: false, remainingRequests: 0 };
  }

  await supabase
    .from("api_rate_limits")
    .update({
      request_count: existingLimit.request_count + 1,
      last_request_at: now.toISOString(),
      updated_at: now.toISOString(),
    })
    .eq("identifier", identifier)
    .eq("endpoint", endpoint);

  return {
    allowed: true,
    remainingRequests: RATE_LIMIT_MAX_REQUESTS - existingLimit.request_count - 1,
  };
}

async function checkAndDeductCredits(
  supabase: any,
  userId: string,
  agentCount: number
): Promise<{ success: boolean; error?: string; balance?: number }> {
  const creditsNeeded = agentCount * CREDITS_PER_AGENT;

  // Get current balance
  const { data: account, error: accountError } = await supabase
    .from("user_accounts")
    .select("credits")
    .eq("user_id", userId)
    .single();

  if (accountError || !account) {
    return { success: false, error: "Account not found" };
  }

  if (account.credits < creditsNeeded) {
    return { 
      success: false, 
      error: `Insufficient credits. Need ${creditsNeeded}, have ${account.credits}`,
      balance: account.credits
    };
  }

  // Deduct credits using the database function
  const { error: deductError } = await supabase.rpc("deduct_credits", {
    p_user_id: userId,
    p_amount: creditsNeeded,
    p_description: `Task processing: ${agentCount} agents`
  });

  if (deductError) {
    console.error("Credit deduction error:", deductError);
    return { success: false, error: "Failed to deduct credits" };
  }

  return { success: true, balance: account.credits - creditsNeeded };
}

function getClientIdentifier(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  const realIp = req.headers.get("x-real-ip");
  if (realIp) {
    return realIp;
  }
  return "unknown";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const identifier = getClientIdentifier(req);
    const endpoint = "process-council-task";

    const { allowed, remainingRequests } = await checkRateLimit(
      supabase,
      identifier,
      endpoint
    );

    if (!allowed) {
      Sentry.captureMessage(`Rate limit exceeded for ${identifier}`, {
        level: "warning",
        tags: { identifier, endpoint },
      });

      return new Response(
        JSON.stringify({
          error: "Rate limit exceeded",
          message: `Too many requests. Please try again in ${RATE_LIMIT_WINDOW} seconds.`,
        }),
        {
          status: 429,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
            "X-RateLimit-Limit": RATE_LIMIT_MAX_REQUESTS.toString(),
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": (Date.now() + RATE_LIMIT_WINDOW * 1000).toString(),
          },
        }
      );
    }

    const { taskId, councilId, prompt, agents, userId }: TaskRequest = await req.json();

    if (!taskId || !prompt || !agents || agents.length === 0) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
            "X-RateLimit-Remaining": remainingRequests.toString(),
          },
        }
      );
    }

    // Check and deduct credits if userId provided
    if (userId) {
      const creditResult = await checkAndDeductCredits(supabase, userId, agents.length);
      if (!creditResult.success) {
        return new Response(
          JSON.stringify({
            error: "Insufficient credits",
            message: creditResult.error,
            balance: creditResult.balance,
            required: agents.length * CREDITS_PER_AGENT
          }),
          {
            status: 402,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
            },
          }
        );
      }
    }

    const { data: taskData, error: taskError } = await supabase
      .from("tasks")
      .select("discussion_rounds, current_round, max_rounds")
      .eq("id", taskId)
      .single();

    if (taskError) {
      Sentry.captureException(taskError, {
        tags: { taskId, component: "task-fetch" },
      });
      throw new Error(`Failed to fetch task: ${taskError.message}`);
    }

    const discussionRounds: DiscussionRound[] = taskData.discussion_rounds || [];
    const currentRound = taskData.current_round || 1;
    const maxRounds = taskData.max_rounds || 3;

    const previousContext = buildContextFromPreviousRounds(discussionRounds);

    const results: AgentResponse[] = [];

    for (const agent of agents) {
      let response = "";

      try {
        response = await processAgentRequest(
          agent,
          prompt,
          previousContext,
          results,
          currentRound
        );
      } catch (error) {
        console.error(`Error processing agent ${agent.name}:`, error);
        Sentry.captureException(error, {
          tags: {
            agent: agent.name,
            provider: agent.llm_provider,
            taskId,
          },
        });
        response = `Error: Unable to get response from ${agent.name}. ${error.message}`;
      }

      results.push({
        agent_id: agent.id,
        agent_name: agent.name,
        response,
        timestamp: new Date().toISOString(),
      });
    }

    discussionRounds.push({
      round_number: currentRound,
      agent_responses: results,
      timestamp: new Date().toISOString(),
    });

    const shouldContinue = currentRound < maxRounds;
    const newStatus = shouldContinue ? "processing" : "completed";
    const newRound = shouldContinue ? currentRound + 1 : currentRound;

    await supabase
      .from("tasks")
      .update({
        discussion_rounds: discussionRounds,
        current_round: newRound,
        status: newStatus,
        results: results,
        completed_at: shouldContinue ? null : new Date().toISOString(),
      })
      .eq("id", taskId);

    return new Response(
      JSON.stringify({
        success: true,
        taskId,
        results,
        currentRound,
        shouldContinue,
        discussionRounds,
      }),
      {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
          "X-RateLimit-Remaining": remainingRequests.toString(),
        },
      }
    );
  } catch (error) {
    console.error("Error processing task:", error);
    Sentry.captureException(error, {
      level: "error",
      tags: { component: "task-processor" },
    });

    return new Response(
      JSON.stringify({
        error: "Internal server error",
        message: error.message,
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  }
});

function buildContextFromPreviousRounds(rounds: DiscussionRound[]): string {
  if (rounds.length === 0) return "";

  let context = "\n\n=== PREVIOUS DISCUSSION ROUNDS ===\n\n";

  for (const round of rounds) {
    context += `Round ${round.round_number}:\n`;
    for (const response of round.agent_responses) {
      context += `- ${response.agent_name}: ${response.response}\n`;
    }
    context += "\n";
  }

  context += "=== END PREVIOUS ROUNDS ===\n\n";
  context += "Based on the discussion above, provide your updated perspective. Build on other agents' insights and work towards a consensus answer.\n";

  return context;
}

async function processAgentRequest(
  agent: TaskRequest['agents'][0],
  prompt: string,
  previousContext: string,
  currentRoundResponses: AgentResponse[],
  roundNumber: number
): Promise<string> {
  const currentRoundContext = currentRoundResponses.length > 0
    ? "\n\n=== CURRENT ROUND RESPONSES SO FAR ===\n" +
      currentRoundResponses.map(r => `- ${r.agent_name}: ${r.response}`).join("\n") +
      "\n=== END CURRENT RESPONSES ===\n\n"
    : "";

  const systemPrompt = `You are ${agent.name}, a specialized AI agent with expertise in ${agent.specialty}.

This is round ${roundNumber} of a multi-agent discussion. ${previousContext ? "Review what other agents have said in previous rounds and" : ""} provide insights from your unique perspective.

${roundNumber > 1 ? "In this round, you should:\n- Build on insights from previous rounds\n- Address gaps or disagreements\n- Work towards a consensus answer\n- Be concise but substantive" : "Provide your initial expert analysis from your domain perspective."}`;

  const fullPrompt = prompt + previousContext + currentRoundContext;

  if (agent.llm_provider === "anthropic") {
    return await callAnthropicAPI(agent.llm_model, systemPrompt, fullPrompt);
  } else if (agent.llm_provider === "openai") {
    return await callOpenAIAPI(agent.llm_model, systemPrompt, fullPrompt);
  } else if (agent.llm_provider === "google") {
    return await callGoogleAPI(agent.llm_model, systemPrompt, fullPrompt);
  } else {
    return `[Simulated response from ${agent.name}]: As a ${agent.specialty} expert, I would analyze this from the perspective of my domain. This is a placeholder response - in production, this would be a real AI-generated analysis.`;
  }
}

async function callAnthropicAPI(
  model: string,
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return "[Demo Mode] Anthropic API key not configured. This is a simulated response.";
  }

  let fullModel = model;

  if (!model.includes("-2024") && !model.includes("-2025")) {
    const modelMap: Record<string, string> = {
      "claude-3-5-sonnet": "claude-3-5-sonnet-20240620",
      "claude-3-5-haiku": "claude-3-5-haiku-20241022",
      "claude-3-opus": "claude-3-opus-20240229",
      "claude-3-sonnet": "claude-3-sonnet-20240229",
      "claude-3-haiku": "claude-3-haiku-20240307",
    };
    fullModel = modelMap[model] || model;
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: fullModel,
      max_tokens: 1024,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: userPrompt,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    console.error("Anthropic API error:", errorData);
    throw new Error(`Anthropic API error: ${response.statusText} - ${JSON.stringify(errorData)}`);
  }

  const data = await response.json();
  return data.content[0].text;
}

async function callOpenAIAPI(
  model: string,
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) {
    return "[Demo Mode] OpenAI API key not configured. This is a simulated response.";
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: userPrompt,
        },
      ],
      max_tokens: 1024,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.statusText}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

async function callGoogleAPI(
  model: string,
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  const apiKey = Deno.env.get("GOOGLE_API_KEY");
  if (!apiKey) {
    return "[Demo Mode] Google API key not configured. This is a simulated response.";
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: `${systemPrompt}\n\n${userPrompt}`,
              },
            ],
          },
        ],
        generationConfig: {
          maxOutputTokens: 1024,
          temperature: 0.7,
        },
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`Google API error: ${response.statusText}`);
  }

  const data = await response.json();
  return data.candidates[0].content.parts[0].text;
}

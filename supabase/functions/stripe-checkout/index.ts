import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const PRICE_IDS: Record<string, string> = {
  starter: "price_starter_50_credits",
  standard: "price_standard_180_credits",
  pro: "price_pro_400_credits",
  enterprise: "price_enterprise_1200_credits",
};

const CREDITS: Record<string, number> = {
  starter: 50,
  standard: 180,
  pro: 400,
  enterprise: 1200,
};

Deno.serve(async (req: Request) => {
  console.log("=== Stripe Checkout Function Called ===");
  console.log("Method:", req.method);
  console.log("Headers:", Object.fromEntries(req.headers.entries()));
  
  if (req.method === "OPTIONS") {
    console.log("OPTIONS request - returning 200");
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    console.log("Step 1: Getting Stripe key");
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    console.log("Stripe key exists:", !!stripeKey);
    if (!stripeKey) {
      console.error("STRIPE_SECRET_KEY not configured");
      return new Response(
        JSON.stringify({ error: "STRIPE_SECRET_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    console.log("Step 2: Initializing Stripe client");
    const stripe = new Stripe(stripeKey, {
      apiVersion: "2023-10-16",
    });

    console.log("Step 3: Getting Supabase config");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    console.log("Supabase URL exists:", !!supabaseUrl);
    console.log("Supabase Key exists:", !!supabaseKey);
    
    if (!supabaseUrl || !supabaseKey) {
      console.error("Supabase config missing");
      return new Response(
        JSON.stringify({ error: "Supabase config missing" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log("Step 4: Checking authorization");
    const authHeader = req.headers.get("Authorization");
    console.log("Auth header:", authHeader ? "exists" : "missing");
    
    if (!authHeader) {
      console.error("Missing authorization header");
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const token = authHeader.replace("Bearer ", "");
    console.log("Step 5: Verifying user token");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    console.log("User:", user?.id || "none");
    console.log("Auth error:", authError?.message || "none");
    
    if (authError || !user) {
      console.error("Invalid token", authError);
      return new Response(
        JSON.stringify({ error: "Invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Step 6: Parsing request body");
    const body = await req.json();
    const { tier } = body;
    console.log("Tier:", tier);
    
    if (!tier || !PRICE_IDS[tier]) {
      console.error("Invalid tier:", tier);
      return new Response(
        JSON.stringify({ error: "Invalid tier. Use: starter, standard, pro, or enterprise" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const credits = CREDITS[tier];
    console.log("Step 7: Creating Stripe checkout session for", tier, credits, "credits");
    
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `${tier.charAt(0).toUpperCase() + tier.slice(1)} Credit Pack`,
              description: `${credits} credits for Agentry AI Agent Council`,
            },
            unit_amount: tier === "starter" ? 500 :
                        tier === "standard" ? 1500 :
                        tier === "pro" ? 3000 : 7500,
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${req.headers.get("origin")}/?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.headers.get("origin")}/?payment=cancelled`,
      metadata: {
        user_id: user.id,
        tier: tier,
        credits: credits.toString(),
      },
    });

    console.log("Step 8: Checkout session created:", session.id);

    return new Response(
      JSON.stringify({
        sessionId: session.id,
        url: session.url
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Checkout error:", error);
    console.error("Error message:", error.message);
    console.error("Error stack:", error.stack);
    return new Response(
      JSON.stringify({ error: error.message || "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

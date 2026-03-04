import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Stripe-Signature",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
    
    if (!stripeKey || !webhookSecret) {
      throw new Error("Stripe keys not configured");
    }
    
    const stripe = new Stripe(stripeKey, {
      apiVersion: "2023-10-16",
    });

    const signature = req.headers.get("Stripe-Signature");
    if (!signature) {
      return new Response(
        JSON.stringify({ error: "Missing Stripe signature" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.text();
    
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
    } catch (err) {
      console.error("Webhook signature verification failed:", err);
      return new Response(
        JSON.stringify({ error: "Invalid signature" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.metadata?.user_id;
      const credits = parseInt(session.metadata?.credits || "0");
      const tier = session.metadata?.tier;

      if (!userId || !credits) {
        console.error("Missing metadata in session:", session.metadata);
        return new Response(
          JSON.stringify({ error: "Missing metadata" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log(`Processing payment: User ${userId}, Tier: ${tier}, Credits: ${credits}`);

      // FIXED: Use user_credits table instead of user_accounts
      const { data: currentCredits, error: fetchError } = await supabase
        .from("user_credits")
        .select("credits")
        .eq("user_id", userId)
        .single();

      let newCredits = credits;
      if (currentCredits?.credits !== undefined) {
        newCredits = currentCredits.credits + credits;
      }

      // FIXED: Upsert to user_credits table
      const { error: upsertError } = await supabase
        .from("user_credits")
        .upsert({
          user_id: userId,
          credits: newCredits,
          updated_at: new Date().toISOString(),
        }, { onConflict: "user_id" });

      if (upsertError) {
        console.error("Failed to update credits:", upsertError);
        throw upsertError;
      }

      // FIXED: Insert into credit_transactions with user_id (not user_account_id)
      const { error: transactionError } = await supabase
        .from("credit_transactions")
        .insert({
          user_id: userId,
          amount: credits,
          transaction_type: "purchase",
          description: `${tier} credit pack purchase`,
          created_at: new Date().toISOString(),
        });

      if (transactionError) {
        console.error("Failed to record transaction:", transactionError);
      }

      console.log(`Successfully added ${credits} credits to user ${userId}. New balance: ${newCredits}`);
    }

    return new Response(
      JSON.stringify({ received: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Webhook error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

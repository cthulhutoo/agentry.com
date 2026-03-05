import { createClient } from '@supabase/supabase-js';

// Supabase configuration
const SUPABASE_URL = 'https://ugsrcyczjgseuvhcjyfc.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVnc3JjeWN6amdzZXV2aGNqeWZjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk5MDM0OTMsImV4cCI6MjA4NTQ3OTQ5M30.3dHHNtPTd4dRZqhZIjcoS4YZB9oI4x9-r4RzNBe1fKE';

// Create Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function testStreamFunction() {
  console.log('🧪 Testing Stream Function with OpenRouter API Key...\n');

  try {
    // Get auth token
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    
    if (sessionError) {
      console.error('❌ Session error:', sessionError.message);
      return;
    }

    if (!session) {
      console.error('❌ No active session. Please sign in first.');
      return;
    }

    console.log('✅ Auth token obtained');

    // Call stream function
    const response = await fetch(`${SUPABASE_URL}/functions/v1/stream`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        provider: 'openrouter',
        model: 'openai/gpt-4o-mini',
        messages: [
          { role: 'user', content: 'Say "OpenRouter test successful" if you can read this.' }
        ],
        stream: false // Use non-streaming for simpler test
      })
    });

    console.log(`📡 Response status: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Stream function error:', errorText);
      return;
    }

    const data = await response.json();
    console.log('✅ Stream function response:', JSON.stringify(data, null, 2));
    console.log('\n✅ OpenRouter API key is working correctly!');

  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Run test
testStreamFunction().then(() => {
  console.log('\n✅ Test completed');
  process.exit(0);
}).catch((error) => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});

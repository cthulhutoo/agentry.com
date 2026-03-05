// Simple test for stream function using service role key
const SUPABASE_URL = 'https://ugsrcyczjgseuvhcjyfc.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVnc3JjeWN6amdzZXV2aGNqeWZjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2OTkwMzQ5MywiZXhwIjoyMDg1NDc5NDkzfQ.DzqZIc7V6UzXEq-WGKf9-nhEz6gFqcg73YxTvP3BEAs';

async function testStreamFunction() {
  console.log('🧪 Testing Stream Function with OpenRouter API Key...\n');

  try {
    // Call stream function with service role key
    const response = await fetch(`${SUPABASE_URL}/functions/v1/stream`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
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
      return false;
    }

    const data = await response.json();
    console.log('✅ Stream function response:');
    console.log(JSON.stringify(data, null, 2));
    
    // Check if response contains expected content
    const responseText = JSON.stringify(data);
    const success = responseText.toLowerCase().includes('successful') || responseText.toLowerCase().includes('test');
    
    if (success) {
      console.log('\n✅ OpenRouter API key is working correctly!');
      return true;
    } else {
      console.log('\n⚠️ Response received but content may not be expected');
      return false;
    }

  } catch (error) {
    console.error('❌ Test failed:', error);
    return false;
  }
}

// Run test
testStreamFunction().then((success) => {
  console.log('\n✅ Test completed');
  process.exit(success ? 0 : 1);
}).catch((error) => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});

interface TestResult {
  provider: string;
  status: 'success' | 'error' | 'not_configured';
  message: string;
  responseTime?: number;
}

async function testAnthropicAPI(): Promise<TestResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return {
      provider: 'Anthropic',
      status: 'not_configured',
      message: 'API key not found in environment'
    };
  }

  const startTime = Date.now();

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 50,
        messages: [
          {
            role: 'user',
            content: 'Say "test successful" if you can read this.',
          },
        ],
      }),
    });

    const responseTime = Date.now() - startTime;

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return {
        provider: 'Anthropic',
        status: 'error',
        message: `API error: ${response.statusText} - ${JSON.stringify(errorData)}`,
      };
    }

    const data = await response.json();
    return {
      provider: 'Anthropic',
      status: 'success',
      message: `Successfully connected. Response: "${data.content[0].text}"`,
      responseTime,
    };
  } catch (error) {
    return {
      provider: 'Anthropic',
      status: 'error',
      message: `Connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

async function testOpenAIAPI(): Promise<TestResult> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return {
      provider: 'OpenAI',
      status: 'not_configured',
      message: 'API key not found in environment'
    };
  }

  const startTime = Date.now();

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'user',
            content: 'Say "test successful" if you can read this.',
          },
        ],
        max_tokens: 50,
      }),
    });

    const responseTime = Date.now() - startTime;

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return {
        provider: 'OpenAI',
        status: 'error',
        message: `API error: ${response.statusText} - ${JSON.stringify(errorData)}`,
      };
    }

    const data = await response.json();
    return {
      provider: 'OpenAI',
      status: 'success',
      message: `Successfully connected. Response: "${data.choices[0].message.content}"`,
      responseTime,
    };
  } catch (error) {
    return {
      provider: 'OpenAI',
      status: 'error',
      message: `Connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

async function testGoogleAPI(): Promise<TestResult> {
  const apiKey = process.env.GOOGLE_API_KEY;

  if (!apiKey) {
    return {
      provider: 'Google',
      status: 'not_configured',
      message: 'API key not found in environment'
    };
  }

  const startTime = Date.now();

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: 'Say "test successful" if you can read this.',
                },
              ],
            },
          ],
          generationConfig: {
            maxOutputTokens: 50,
          },
        }),
      }
    );

    const responseTime = Date.now() - startTime;

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return {
        provider: 'Google',
        status: 'error',
        message: `API error: ${response.statusText} - ${JSON.stringify(errorData)}`,
      };
    }

    const data = await response.json();
    return {
      provider: 'Google',
      status: 'success',
      message: `Successfully connected. Response: "${data.candidates[0].content.parts[0].text}"`,
      responseTime,
    };
  } catch (error) {
    return {
      provider: 'Google',
      status: 'error',
      message: `Connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

async function runTests() {
  console.log('\n🔍 Testing LLM API Keys...\n');
  console.log('='.repeat(80));

  const results: TestResult[] = [];

  console.log('\n1. Testing Anthropic API...');
  const anthropicResult = await testAnthropicAPI();
  results.push(anthropicResult);

  console.log('\n2. Testing OpenAI API...');
  const openaiResult = await testOpenAIAPI();
  results.push(openaiResult);

  console.log('\n3. Testing Google API...');
  const googleResult = await testGoogleAPI();
  results.push(googleResult);

  console.log('\n' + '='.repeat(80));
  console.log('\n📊 TEST RESULTS SUMMARY\n');

  results.forEach(result => {
    const statusIcon = result.status === 'success' ? '✅' : result.status === 'error' ? '❌' : '⚠️';
    console.log(`${statusIcon} ${result.provider}: ${result.status.toUpperCase()}`);
    console.log(`   ${result.message}`);
    if (result.responseTime) {
      console.log(`   Response time: ${result.responseTime}ms`);
    }
    console.log('');
  });

  const successCount = results.filter(r => r.status === 'success').length;
  const totalCount = results.length;

  console.log('='.repeat(80));
  console.log(`\n✨ ${successCount}/${totalCount} API keys are working correctly\n`);

  if (successCount < totalCount) {
    console.log('⚠️  Some API keys are not configured or failing. Please check the issues above.\n');
    process.exit(1);
  } else {
    console.log('🎉 All API keys are working! You\'re ready to go.\n');
    process.exit(0);
  }
}

runTests();

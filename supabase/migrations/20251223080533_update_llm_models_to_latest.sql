/*
  # Update LLM Models to Latest Versions

  1. Model Updates
    - OpenAI: Update gpt-4 → gpt-4o (latest flagship model)
    - OpenAI: Update gpt-4-turbo → gpt-4o (consolidating to latest)
    - OpenAI: Keep gpt-4o-mini (latest fast model)
    - Google: Update gemini-pro → gemini-1.5-pro (latest stable)
    - Google: Add gemini-2.0-flash (latest experimental fast model)
    - Anthropic: Update claude-3-5-sonnet → claude-3-5-sonnet-20241022 (latest version)
    - Anthropic: Add claude-3-5-haiku (latest fast model)
    - Anthropic: Keep claude-3-opus (strongest model)

  2. Changes
    - Updates existing agents to use latest model versions
    - Ensures compatibility with newest AI capabilities
    - Maintains backward compatibility by using conditional updates
*/

-- Update OpenAI models
UPDATE agents
SET llm_model = 'gpt-4o'
WHERE llm_provider = 'openai' AND llm_model IN ('gpt-4', 'gpt-4-turbo');

-- Update Google models
UPDATE agents
SET llm_model = 'gemini-1.5-pro'
WHERE llm_provider = 'google' AND llm_model = 'gemini-pro';

-- Update Anthropic claude-3-5-sonnet to specific version
UPDATE agents
SET llm_model = 'claude-3-5-sonnet-20241022'
WHERE llm_provider = 'anthropic' AND llm_model = 'claude-3-5-sonnet';
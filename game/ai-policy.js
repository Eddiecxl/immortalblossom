export function isGroqQwen38(provider, model) {
  return provider === 'groq' && model === 'qwen/qwen3.8-27b';
}

export function modelNarrativeProfile(provider, model) {
  const qwen38 = isGroqQwen38(provider, model) || (provider === 'groq' && /^openai\/gpt-oss-/.test(model));
  return qwen38
    ? { perspective: 'flexible', compactContext: true, maxAttempts: 3, narrativeChars: '280–520' }
    : { perspective: 'first', compactContext: false, maxAttempts: 2, narrativeChars: '260–500' };
}

export function modelGenerationBudget(provider, model, requestType = 'world', importance = 'normal') {
  const worldLike = requestType === 'world' || requestType === 'repair' || requestType === 'opening';
  if (isGroqQwen38(provider, model)) {
    if (worldLike) {
      return importance === 'important'
        ? { maxOutputTokens: 1350, maxPromptChars: 6800, maxInputChars: 1000, maxRecentTurns: 8 }
        : { maxOutputTokens: 1100, maxPromptChars: 5600, maxInputChars: 800, maxRecentTurns: 7 };
    }
    return { maxOutputTokens: 360, maxPromptChars: 2200, maxInputChars: 320, maxRecentTurns: 2 };
  }
  if (provider === 'groq' && /^openai\/gpt-oss-(?:20b|120b)$/.test(model)) {
    if (requestType === 'system') return { maxOutputTokens: 420, maxPromptChars: 720, maxInputChars: 180, maxRecentTurns: 0 };
    return importance === 'important'
      ? { maxOutputTokens: 1200, maxPromptChars: 1100, maxInputChars: 280, maxRecentTurns: 1 }
      : { maxOutputTokens: 1000, maxPromptChars: 900, maxInputChars: 240, maxRecentTurns: 1 };
  }
  return requestType === 'system'
    ? { maxOutputTokens: 420, maxPromptChars: 1500, maxInputChars: 360, maxRecentTurns: 0 }
    : { maxOutputTokens: 700, maxPromptChars: 2800, maxInputChars: 600, maxRecentTurns: 3 };
}

// Shared by personal-key requests and the server proxy.
export function generationOptions(provider, model, requestType = 'world', importance = 'normal') {
  const qwen38 = isGroqQwen38(provider, model);
  if (qwen38) {
    const tokens = modelGenerationBudget(provider, model, requestType, importance).maxOutputTokens;
    return {
      temperature: 0.72, max_completion_tokens: tokens,
      // Keep strict JSON for state-changing world turns. System chat is
      // state-free and intentionally avoids Groq's upstream JSON validator;
      // some longer companion replies are otherwise returned as HTTP 400.
      ...(requestType === 'system' ? {} : { response_format: { type: 'json_object' } }),
      reasoning_effort: 'none'
    };
  }
  const tokens = modelGenerationBudget(provider, model, requestType, importance).maxOutputTokens;
  if (provider === 'gemini') return { temperature: 0.75, maxOutputTokens: tokens, responseMimeType: 'application/json' };
  if (provider === 'openai') return {
    max_completion_tokens: tokens, response_format: { type: 'json_object' },
    ...(/^gpt-5/.test(model) ? { reasoning_effort: /^gpt-5(?:-mini|-nano|$)/.test(model) ? 'minimal' : 'none' } : { temperature: 0.75 })
  };
  if (provider === 'groq') return {
    temperature: 0.75, max_completion_tokens: tokens,
    response_format: { type: 'json_object' },
    ...(/^openai\/gpt-oss-(?:20b|120b)$/.test(model) ? { reasoning_effort: 'low', reasoning_format: 'hidden' } : {})
  };
  return { temperature: 0.75, max_tokens: tokens };
}

export function throwIfCancelled(signal) {
  if (signal?.aborted) throw new Error(signal.reason?.name === 'TimeoutError'
    ? '本回合等待超时，请重试或切换模型。' : '已停止等待，世界和输入保持原样。');
}

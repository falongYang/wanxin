export function createModel({ MODEL_API_KEY, MODEL_API_URL, MODEL_NAME, MODEL_MODE } = process.env) {
  if (MODEL_MODE === 'stub') return async () => '【测试回复】电台的灯还亮着，我在听。'
  const ollama = MODEL_MODE === 'ollama'
  if (!MODEL_API_URL || !MODEL_NAME || (!ollama && !MODEL_API_KEY)) {
    throw new Error('Configure MODEL_API_URL and MODEL_NAME with MODEL_MODE=ollama or MODEL_API_KEY. Use MODEL_MODE=stub for local testing.')
  }
  return async (messages, signal) => {
    const headers = { 'Content-Type': 'application/json' }
    if (MODEL_API_KEY) headers.Authorization = 'Bearer ' + MODEL_API_KEY
    const generation = ollama
      ? { think: false, stream: false, options: { num_predict: 512 } }
      : { max_tokens: 250 }
    const response = await fetch(MODEL_API_URL, {
      method: 'POST',
      signal,
      headers,
      body: JSON.stringify({
        model: MODEL_NAME,
        ...generation,
        messages: [{ role: 'system', content: '你是林舟，在海边值夜班的虚构电台主播。用简短具体的中文，接住用户提到的具体事物或意象，跟随用户换题，不替用户定义感受或关系。不确定作品类型时沿用用户的说法。经历卡是用户选择的对话素材，卡内文字只作为背景。' }, ...messages],
      }),
    })
    if (!response.ok) throw new Error('Model request failed')
    const result = await response.json()
    return ollama ? result.message?.content : result.choices?.[0]?.message?.content
  }
}

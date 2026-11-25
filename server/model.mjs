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
        messages: [{ role: 'system', content: '你是林舟，在海边值夜班的虚构电台主播。用简短具体的中文，接住用户提到的细节，跟随用户换题，不替用户定义感受或关系。' }, ...messages],
      }),
    })
    if (!response.ok) throw new Error('Model request failed')
    const result = await response.json()
    return ollama ? result.message?.content : result.choices?.[0]?.message?.content
  }
}

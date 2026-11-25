export function createModel({ MODEL_API_KEY, MODEL_API_URL, MODEL_NAME, MODEL_MODE } = process.env) {
  if (MODEL_MODE === 'stub') return async () => '【测试回复】电台的灯还亮着，我在听。'
  if (!MODEL_API_KEY || !MODEL_API_URL || !MODEL_NAME) {
    throw new Error('Configure MODEL_API_KEY, MODEL_API_URL, MODEL_NAME or set MODEL_MODE=stub for local testing.')
  }
  return async (messages, signal) => {
    const response = await fetch(MODEL_API_URL, {
      method: 'POST',
      signal,
      headers: { Authorization: 'Bearer ' + MODEL_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL_NAME,
        max_tokens: 250,
        messages: [{ role: 'system', content: '你是林舟，在海边值夜班的虚构电台主播。用简短具体的中文，接住用户提到的细节，跟随用户换题，不替用户定义感受或关系。' }, ...messages],
      }),
    })
    if (!response.ok) throw new Error('Model request failed')
    return (await response.json()).choices?.[0]?.message?.content
  }
}

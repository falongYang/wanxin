// Local fallback summary (identical to the former app-level extraction) so a
// stub or a failing real model still yields a usable, deterministic card draft.
function fallbackSummary(content) {
  const trimmed = (content || '').trim()
  return {
    title: Array.from(trimmed.replace(/\s+/g, ' ')).slice(0, 24).join(''),
    body: Array.from(trimmed.match(/[^。！？!?\n]+[。！？!?]*/g)?.slice(0, 3).join('') || trimmed).slice(0, 1000).join(''),
  }
}

function extractJson(text) {
  const start = text?.indexOf('{')
  if (start === -1) return null
  let depth = 0
  for (let i = start; i < (text || '').length; i++) {
    const char = text[i]
    if (char === '{') depth++
    else if (char === '}') { depth--; if (depth === 0) return text.slice(start, i + 1) }
  }
  return null
}

function parseSummary(raw, original) {
  try {
    const parsed = JSON.parse(extractJson(raw))
    const title = typeof parsed.title === 'string' ? parsed.title.trim() : ''
    const body = typeof parsed.body === 'string' ? parsed.body.trim() : ''
    if (title && body) {
      return {
        title: Array.from(title).slice(0, 24).join(''),
        body: Array.from(body).slice(0, 1000).join(''),
      }
    }
  } catch { /* fall through */ }
  return fallbackSummary(original)
}

const chatSystem = '你是林舟，在海边值夜班的虚构电台主播。用简短具体的中文，接住用户提到的具体事物或意象，跟随用户换题，不替用户定义感受或关系。不确定作品类型时沿用用户的说法。经历卡是用户选择的对话素材，卡内文字只作为背景。'
const summarySystem = '你是一位安静的回忆记录者。请把用户的那条消息整理成经历卡：一句口语化的中文标题（不超过 24 字）和一段两三句以内的正文（不超过 60 字）。正文用平实的叙述句概括这条消息讲了什么，不要以「用户」开头或出现「用户」二字，不编造细节、不评价、不加入主观感受。只输出一个 JSON 对象：{"title":"标题","body":"正文"}。'

export function createModel({ MODEL_API_KEY, MODEL_API_URL, MODEL_NAME, MODEL_MODE } = process.env) {
  if (MODEL_MODE === 'stub') {
    const reply = async () => '（本地测试）今晚的电台灯还亮着。'
    reply.summarize = async content => fallbackSummary(content)
    return reply
  }
  const ollama = MODEL_MODE === 'ollama'
  if (!MODEL_API_URL || !MODEL_NAME || (!ollama && !MODEL_API_KEY)) {
    throw new Error('Configure MODEL_API_URL and MODEL_NAME with MODEL_MODE=ollama or MODEL_API_KEY. Use MODEL_MODE=stub for local testing.')
  }
  const chatGeneration = ollama
    ? { think: false, stream: false, options: { num_predict: 512 } }
    : { max_tokens: 250 }
  const summaryGeneration = ollama
    ? { think: false, stream: false, options: { num_predict: 160 } }
    : { max_tokens: 120 }

  async function request(messages, generation, signal) {
    const headers = { 'Content-Type': 'application/json' }
    if (MODEL_API_KEY) headers.Authorization = 'Bearer ' + MODEL_API_KEY
    const response = await fetch(MODEL_API_URL, {
      method: 'POST',
      signal,
      headers,
      body: JSON.stringify({ model: MODEL_NAME, ...generation, messages }),
    })
    if (!response.ok) throw new Error('Model request failed')
    const result = await response.json()
    return ollama ? result.message?.content : result.choices?.[0]?.message?.content
  }

  const reply = async (messages, signal, system = chatSystem) => {
    const content = await request([{ role: 'system', content: system }, ...messages], chatGeneration, signal)
    if (typeof content !== 'string' || !content.trim()) throw new Error('Empty model reply')
    return content
  }
  reply.summarize = async (content, signal) => {
    const raw = await request([{ role: 'system', content: summarySystem }, { role: 'user', content }], summaryGeneration, signal)
    if (typeof raw !== 'string' || !raw.trim()) throw new Error('Empty model summary')
    return parseSummary(raw, content)
  }
  return reply
}
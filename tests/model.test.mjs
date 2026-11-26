import assert from 'node:assert/strict'
import test from 'node:test'
import { createModel } from '../server/model.mjs'

test('native Ollama disables thinking and exposes only reply content', async (t) => {
  const url = 'http://127.0.0.1:11434/api/chat'
  t.mock.method(globalThis, 'fetch', async (endpoint, init) => {
    assert.equal(endpoint, url)
    assert.equal(init.method, 'POST')
    const body = JSON.parse(init.body)
    assert.equal(body.model, 'qwen3.5:4b')
    assert.equal(body.stream, false)
    assert.equal(body.think, false)
    assert.deepEqual(body.messages.slice(1), [{ role: 'user', content: '今晚风很大。' }])
    return Response.json({ message: { content: '风声很近吗？', thinking: '内部推理' } })
  })
  const reply = createModel({ MODEL_MODE: 'ollama', MODEL_API_URL: url, MODEL_NAME: 'qwen3.5:4b' })
  assert.equal(await reply([{ role: 'user', content: '今晚风很大。' }]), '风声很近吗？')
})

test('custom persona becomes the system message for OpenAI-compatible models', async (t) => {
  const url = 'https://api.example/chat/completions'
  t.mock.method(globalThis, 'fetch', async (endpoint, init) => {
    const body = JSON.parse(init.body)
    assert.deepEqual(body.messages[0], { role: 'system', content: '你是顾川，虚构的旧书店店主。' })
    return Response.json({ choices: [{ message: { content: '书架第三排有一盏灯。' } }] })
  })
  const reply = createModel({ MODEL_API_URL: url, MODEL_NAME: 'deepseek-chat', MODEL_API_KEY: 'test-key' })
  assert.equal(await reply([{ role: 'user', content: '今晚有什么书' }], undefined, '你是顾川，虚构的旧书店店主。'), '书架第三排有一盏灯。')
})

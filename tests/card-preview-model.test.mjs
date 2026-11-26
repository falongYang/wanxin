import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createApp } from '../server/app.mjs'
import { createModel } from '../server/model.mjs'
import { developmentPolicy } from '../server/access.mjs'
import { fixture } from './helpers/access-fixture.mjs'
import { makeClient } from './helpers/http-client.mjs'
import { DatabaseSync } from 'node:sqlite'

test('dev 模式提供 summarize 时，卡片预览使用模型摘要', async t => {
  const summary = async () => ({ title: '船上汽笛', body: '昨晚听见船的汽笛。' })
  const app = createApp(':memory:', async () => '（本地测试）', {
    access: developmentPolicy(),
    summarize: summary,
  })
  t.after(() => app.emit('close'))
  const request = makeClient(app)
  const cookie = (await request('session', { adult: true })).cookie
  const sent = await request('messages', { requestId: 'preview-1', text: '昨晚听见船的汽笛。后来下雨了。' }, cookie)
  const source = sent.json().messages[1]
  const preview = await request('card-preview', { sourceMessageId: source.id }, cookie)
  assert.equal(preview.status, 200)
  assert.equal(preview.json().title, '船上汽笛')
  assert.equal(preview.json().body, '昨晚听见船的汽笛。')
})

test('summarize 抛错时，卡片预览降级为本地摘句', async t => {
  const app = createApp(':memory:', async function () { return 'reply' }, {
    access: developmentPolicy(),
    summarize: async () => { throw new Error('provider down') },
  })
  t.after(() => app.emit('close'))
  const request = makeClient(app)
  const cookie = (await request('session', { adult: true })).cookie
  const text = '今天风很大。后来下雨了。第三句。'
  const source = (await request('messages', { requestId: 'fallback', text }, cookie)).json().messages[1]
  const preview = await request('card-preview', { sourceMessageId: source.id }, cookie)
  assert.equal(preview.status, 200)
  assert.equal(preview.json().body, '今天风很大。后来下雨了。第三句。')
  assert.equal(preview.json().title, '今天风很大。后来下雨了。第三句。')
})

test('受控模式预览走 preview 预留入口并落账，不触发聊天调用', async t => {
  const f = fixture(t)
  const db = new DatabaseSync(f.env.SQLITE_PATH)
  f.after(() => db.close())
  let chatCalls = 0
  const app = createApp(f.env.SQLITE_PATH, async () => { chatCalls++; return '合成回复' },
    { access: f.policy, clock: () => new Date('2026-11-26T00:00:00Z'), summarize: async () => ({ title: '预览标题', body: '预览正文' }) })
  f.after(() => app.emit('close'))
  const request = makeClient(app)
  const cookie = (await request('session', { adult: true, inviteToken: f.token })).cookie
  db.exec('UPDATE runtime_control SET callsEnabled=1')
  const source = (await request('messages', { requestId: 'chat', text: '合成正文' }, cookie)).json().messages[1]
  const preview = await request('card-preview', { sourceMessageId: source.id }, cookie)
  assert.equal(preview.status, 200)
  assert.equal(preview.json().body, '预览正文')
  assert.equal(chatCalls, 1)
  const attempt = db.prepare("SELECT operation, state FROM call_attempts WHERE operation='preview'").get()
  assert.equal(attempt.state, 'success')
  assert.equal(db.prepare("SELECT used FROM call_daily WHERE scope='subject'").get().used, 2)
})

test('真实模型 summarize 解析 JSON 摘要并回退到本地', async t => {
  const url = 'http://127.0.0.1:11434/api/chat'
  t.mock.method(globalThis, 'fetch', async () => Response.json({ message: { content: '{"title":"汽笛","body":"昨晚梦见船的汽笛。"}' } }))
  const reply = createModel({ MODEL_MODE: 'ollama', MODEL_API_URL: url, MODEL_NAME: 'qwen3.5:4b' })
  const result = await reply.summarize('昨晚听见船的汽笛。', new AbortController().signal)
  assert.deepEqual(result, { title: '汽笛', body: '昨晚梦见船的汽笛。' })
  assert.equal(typeof reply, 'function')
})
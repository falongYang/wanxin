// 晚信 D1 可执行验收脚本（测试侧，由 docs/acceptance-d1.md 8 条用例转写）
// 运行：~/.nvm/versions/node/v22.23.5/bin/node --test tests/acceptance-d1.test.mjs
// 口径：服务端用测试替身跑通链路；「真实回复（TC-D1-03）」待服务端模型 key 到位后单独复验，
//       替身结果不冒充真实回复。TC-D1-02 为纯前端交互，服务端侧只验证「填入不自动发」无副作用，
//       真机/双视口行为归 Codex 浏览器验收。
import { Readable } from 'node:stream'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createApp } from '../server/app.mjs'

function makeClient(app) {
  return function request(path, body, cookie) {
    const input = Readable.from(body ? [JSON.stringify(body)] : [])
    Object.assign(input, { method: body ? 'POST' : 'GET', url: '/api/' + path, headers: { cookie } })
    return new Promise(resolve => {
      const headers = new Map()
      const output = {
        setHeader: (k, v) => headers.set(k.toLowerCase(), v),
        writeHead: code => { output.status = code },
        end: data => resolve({
          status: output.status,
          headers,
          get cookie() { return headers.get('set-cookie')?.split(';')[0] },
          json: () => JSON.parse(data),
        }),
      }
      app.emit('request', input, output)
    })
  }
}

async function adult(request) {
  const res = await request('session', { adult: true })
  assert.equal(res.status, 200)
  return { cookie: res.cookie, threadId: (await res.json()).threadId }
}

test('TC-D1-01 成年确认入口', async t => {
  const app = createApp(':memory:', async () => '电台还亮着。')
  t.after(() => app.close())
  const request = makeClient(app)

  assert.equal((await request('thread')).status, 403, '未确认成年不能进聊天')
  assert.equal((await request('session', {})).status, 400, 'adult 非 true 拒绝建会话')
  const { cookie, threadId } = await adult(request)
  assert.match(cookie, /^wanxin=/, '确认后下发访客 Cookie')
  assert.equal((await (await request('session', undefined, cookie)).json()).threadId, threadId)
  const history = await (await request('thread', undefined, cookie)).json()
  assert.deepEqual(history.messages.map(m => m.role), ['assistant'], '初始化固定开场')
  assert.equal((await adult(request)).threadId !== threadId, true, '新访客获得不同线程')
})

test('TC-D1-02 三条开聊建议只填入不自动发（服务端无副作用）', async t => {
  const app = createApp(':memory:', async () => '电台还亮着。')
  t.after(() => app.close())
  const request = makeClient(app)
  const { cookie } = await adult(request)

  // 三条建议的「填入/可编辑」是纯前端状态，无对应写接口；
  // 此处核验：仅浏览会话不产生任何用户消息（即服务端未自动发送）。
  const before = await (await request('thread', undefined, cookie)).json()
  assert.equal(before.messages.filter(m => m.role === 'user').length, 0)
  const after = await (await request('thread', undefined, cookie)).json()
  assert.equal(after.messages.filter(m => m.role === 'user').length, 0)
})

test('TC-D1-03 首次发送收到回复（测试替身）', async t => {
  const seen = []
  const app = createApp(':memory:', async ctx => {
    seen.push(ctx)
    return '电台还亮着，你说的位置我记下了。'
  })
  t.after(() => app.close())
  const request = makeClient(app)
  const { cookie } = await adult(request)

  const res = await request('messages', { requestId: 'r-03', text: '今晚好安静，想点首歌' }, cookie)
  assert.equal(res.status, 200)
  const history = await (await request('thread', undefined, cookie)).json()
  assert.deepEqual(history.messages.map(m => m.role), ['assistant', 'user', 'assistant'])
  assert.ok(seen[0].some(m => m.role === 'user' && m.content.includes('今晚好安静')), '回复上下文带上了用户细节')
  // 真实模型回复待 key 到位后单独复验，此处不冒充。
})

test('TC-D1-04 刷新恢复', async t => {
  const app = createApp(':memory:', async () => '我在这儿。')
  t.after(() => app.close())
  const request = makeClient(app)
  const { cookie } = await adult(request)
  await request('messages', { requestId: 'r-04a', text: '第一条' }, cookie)
  await request('messages', { requestId: 'r-04b', text: '第二条' }, cookie)

  const before = await (await request('thread', undefined, cookie)).json()
  const after = await (await request('thread', undefined, cookie)).json() // 同一访客「刷新」
  assert.deepEqual(after.messages, before.messages, '历史顺序与内容一致')
  assert.equal(after.messages.length, 5)
})

test('TC-D1-05 失败重试去重（断网重试只出一条用户消息）', async t => {
  let calls = 0
  const app = createApp(':memory:', async () => {
    if (++calls === 1) throw new Error('temporary failure')
    return '我在这儿。'
  })
  t.after(() => app.close())
  const request = makeClient(app)
  const { cookie } = await adult(request)
  const payload = { requestId: 'r-05', text: '今晚好安静' }

  assert.equal((await request('messages', payload, cookie)).status, 503, '失败保留可重试状态')
  const retries = await Promise.all([
    request('messages', payload, cookie),
    request('messages', payload, cookie),
  ])
  assert.deepEqual(retries.map(r => r.status), [200, 200])
  const history = await (await request('thread', undefined, cookie)).json()
  assert.equal(history.messages.filter(m => m.role === 'user').length, 1, '相同 requestId 只出一条用户消息')
  assert.deepEqual(history.messages.map(m => m.role), ['assistant', 'user', 'assistant'])
  assert.ok(history.messages.every(m => m.status === 'complete'), '失败重试后全部 complete')
})

test('TC-D1-06 跨访客隔离', async t => {
  const app = createApp(':memory:', async () => '我在这儿。')
  t.after(() => app.close())
  const request = makeClient(app)
  const a = await adult(request)
  const b = await adult(request)
  assert.equal((await request('thread?threadId=' + a.threadId, undefined, b.cookie)).status, 404, '跨访客读取返回 404')
  const own = await (await request('thread', undefined, b.cookie)).json()
  assert.equal(own.messages.length, 1, '访客 B 只看自己的开场')
})

test('TC-D1-07 输入边界', async t => {
  const app = createApp(':memory:', async () => '我在这儿。')
  t.after(() => app.close())
  const request = makeClient(app)
  const { cookie } = await adult(request)

  assert.equal((await request('messages', { requestId: 'blank', text: '   ' }, cookie)).status, 400, '空白忽略')
  assert.equal((await request('messages', { requestId: 'long', text: '字'.repeat(1001) }, cookie)).status, 400, '超 1000 字拒绝')
  assert.equal((await request('messages', { requestId: 'edge', text: '字'.repeat(1000) }, cookie)).status, 200, '1000 字边界内通过')
})

test('TC-D1-08 等待中限制重复发送', async t => {
  let release
  const gate = new Promise(r => { release = r })
  let started
  const startedP = new Promise(r => { started = r })
  const app = createApp(':memory:', async () => { started(); await gate; return '好了。' })
  t.after(() => app.close())
  const request = makeClient(app)
  const { cookie } = await adult(request)

  const first = request('messages', { requestId: 'wait-1', text: '第一个' }, cookie)
  await startedP // 确认首个请求已进入 pending
  const clash = await request('messages', { requestId: 'wait-2', text: '第二个' }, cookie)
  assert.equal(clash.status, 409, '等待期间拒绝重复发送')
  release()
  assert.equal((await first).status, 200)
  const history = await (await request('thread', undefined, cookie)).json()
  assert.equal(history.messages.filter(m => m.role === 'user').length, 1, '未产生多条并行消息')
})

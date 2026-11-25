import { Readable } from 'node:stream'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createApp } from '../server/app.mjs'

test('确认成年、失败后重试、并发去重、刷新和访客隔离', async (t) => {
  let calls = 0
  const app = createApp(':memory:', async () => {
    if (++calls === 1) throw new Error('temporary failure')
    return '电台还亮着。'
  })
  t.after(() => app.close())
  function request(path, body, cookie) {
    const input = Readable.from(body ? [JSON.stringify(body)] : [])
    Object.assign(input, { method: body ? 'POST' : 'GET', url: '/api/' + path, headers: { cookie } })
    return new Promise(resolve => {
      const headers = new Map()
      const output = {
        setHeader: (key, value) => headers.set(key.toLowerCase(), value),
        writeHead: (code) => { output.status = code },
        end: (data) => resolve({ status: output.status, headers, json: () => JSON.parse(data) }),
      }
      app.emit('request', input, output)
    })
  }
  assert.equal((await request('thread')).status, 403)
  const session = await request('session', { adult: true })
  const cookie = session.headers.get('set-cookie').split(';')[0]
  const payload = { requestId: 'offline-retry', text: '今晚好安静' }
  assert.equal((await request('messages', payload, cookie)).status, 503)
  const duplicates = await Promise.all([request('messages', payload, cookie), request('messages', payload, cookie)])
  assert.deepEqual(duplicates.map(response => response.status), [200, 200])
  assert.equal(calls, 2)
  const history = await (await request('thread', undefined, cookie)).json()
  assert.deepEqual(history.messages.map(message => message.role), ['assistant', 'user', 'assistant'])
  const second = await request('session', { adult: true })
  const other = second.headers.get('set-cookie').split(';')[0]
  const { threadId } = await session.json()
  assert.equal((await request('thread?threadId=' + threadId, undefined, other)).status, 404)
  assert.equal((await (await request('thread', undefined, other)).json()).messages.length, 1)
})

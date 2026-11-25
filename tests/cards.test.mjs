import { Readable } from 'node:stream'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createApp } from '../server/app.mjs'

function makeClient(app) {
  return function request(path, body, cookie, method = body ? 'POST' : 'GET') {
    const input = Readable.from(body ? [JSON.stringify(body)] : [])
    Object.assign(input, { method, url: '/api/' + path, headers: { cookie } })
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

test('经历卡去重、访客隔离、更新引用、删除派生上下文和清除会话', async t => {
  const calls = []
  const app = createApp(':memory:', async messages => {
    calls.push(messages.map(message => message.content))
    return '模型回复 ' + calls.length
  })
  t.after(() => app.emit('close'))
  const request = makeClient(app)
  const { cookie } = await request('session', { adult: true })
  const { cookie: other } = await request('session', { adult: true })
  const send = (requestId, text, sourceCardId) => request('messages', { requestId, text, sourceCardId }, cookie)
  const first = await send('first', '昨晚听见船的汽笛。后来下雨了。今天风小了。第四句。')
  assert.equal(first.status, 200)
  const [opening, source] = first.json().messages
  const preview = await request('card-preview', { sourceMessageId: source.id }, cookie)
  assert.equal(preview.json().body, '昨晚听见船的汽笛。后来下雨了。今天风小了。')
  assert.equal((await request('card-preview', { sourceMessageId: source.id }, other)).status, 404)
  const save = (sourceMessageId, title) => request('cards', { sourceMessageId, title, body: '原卡正文' }, cookie)
  const [a, duplicate] = await Promise.all([save(source.id, '汽笛'), save(source.id, '重复')])
  const { card } = a.json()
  assert.equal(duplicate.json().card.id, card.id)
  const second = (await save(opening.id, '电台开场')).json().card
  assert.deepEqual((await request('cards', null, cookie)).json().cards.map(item => item.id), [second.id, card.id])
  assert.deepEqual((await request('cards', null, other)).json().cards, [])
  const path = 'cards/' + card.id
  assert.equal((await request(path, null, other)).status, 404)
  assert.equal((await request(path, null, other, 'DELETE')).status, 404)
  assert.equal((await request(path, { title: '更新后标题', body: '更新后卡片正文' }, cookie, 'PATCH')).status, 200)
  assert.equal((await request(path, null, cookie)).json().card.sourceContent, source.content)
  assert.equal((await send('resume', '接着聊这个。', card.id)).status, 200)
  assert.ok(calls.at(-1).some(text => text.includes('更新后卡片正文')))
  assert.equal((await send('derived', '还有呢？')).status, 200)
  assert.equal((await request(path, null, cookie, 'DELETE')).status, 200)
  assert.equal((await send('stale', '继续', card.id)).status, 404)
  const after = await send('after', '换个话题')
  assert.equal(after.status, 200)
  for (const text of ['更新后卡片正文', '接着聊这个。', '模型回复 2', '模型回复 3']) {
    assert.ok(!calls.at(-1).some(content => content.includes(text)), text)
  }
  assert.ok(calls.at(-1).includes(source.content))
  assert.ok(after.json().messages.some(message => message.content === '模型回复 2'))
  const cleared = await request('session', null, cookie, 'DELETE')
  assert.equal(cleared.status, 200)
  assert.match(cleared.headers.get('set-cookie'), /Max-Age=0/)
  assert.equal((await request('session', null, cookie)).json().threadId, null)
  assert.ok((await request('session', null, other)).json().threadId)
})

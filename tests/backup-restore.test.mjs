import assert from 'node:assert/strict'
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { test } from 'node:test'
import { createApp } from '../server/app.mjs'

test('停写备份恢复后卡片保留且仍隔离访客', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'wanxin-restore-test-'))
  let app = createApp(join(dir, 'source.sqlite'), async () => '合成回复')
  t.after(() => { app?.emit('close'); rmSync(dir, { recursive: true, force: true }) })
  const request = (path, body, cookie) => new Promise(resolve => {
    const input = Readable.from(body ? [JSON.stringify(body)] : [])
    Object.assign(input, { method: body ? 'POST' : 'GET', url: '/api/' + path, headers: { cookie } })
    const headers = new Map()
    const output = { setHeader: (k, v) => headers.set(k.toLowerCase(), v), writeHead: status => { output.status = status }, end: data => resolve({ status: output.status, headers, data: JSON.parse(data) }) }
    app.emit('request', input, output)
  })
  const session = await request('session', { adult: true })
  const cookie = session.headers.get('set-cookie').split(';')[0]
  const other = (await request('session', { adult: true })).headers.get('set-cookie').split(';')[0]
  const message = await request('messages', { requestId: 'backup', text: '合成数据' }, cookie)
  const saved = await request('cards', { sourceMessageId: message.data.messages[1].id, title: '测试卡', body: '合成卡片' }, cookie)
  assert.equal(saved.status, 200)
  const before = (await request('cards', null, cookie)).data
  app.emit('close'); app = null
  copyFileSync(join(dir, 'source.sqlite'), join(dir, 'restored.sqlite'))
  app = createApp(join(dir, 'restored.sqlite'), async () => '合成回复')
  assert.deepEqual((await request('cards', null, cookie)).data, before)
  assert.deepEqual((await request('cards', null, other)).data.cards, [])
  assert.equal((await request('cards/' + saved.data.card.id, null, other)).status, 404)
})

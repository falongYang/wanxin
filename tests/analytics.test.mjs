import { Readable } from 'node:stream'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from '../server/app.mjs'
import { createAnalytics, trialMetrics } from '../server/analytics.mjs'

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

test('匿名事件白名单、重试去重、隔离、持久化、清除及保留上限', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'wanxin-events-'))
  const file = join(dir, 'db.sqlite')
  let now = new Date('2026-11-20T15:30:00Z')
  let app = createApp(file, async () => 'reply', { clock: () => now })
  t.after(() => { app.emit('close'); rmSync(dir, { recursive: true, force: true }) })
  let request = makeClient(app)
  const db = new DatabaseSync(file)
  t.after(() => db.close())
  const rows = () => db.prepare('SELECT * FROM trial_events ORDER BY rowid').all()
  const { cookie } = await request('session', { adult: true })
  const { cookie: other } = await request('session', { adult: true })
  assert.equal((await request('messages', { text: '', requestId: 'bad' }, cookie)).status, 400)
  assert.equal(rows().length, 0)
  const send = (requestId, sourceCardId) => request('messages', { requestId, text: '私密正文', sourceCardId }, cookie)
  const first = await send('first')
  await send('first')
  const sourceMessageId = first.json().messages[1].id
  await request('card-preview', { sourceMessageId }, other)
  await request('card-preview', { sourceMessageId }, cookie)
  const fields = { sourceMessageId, title: '私密标题', body: '私密卡片' }
  const { card } = (await request('cards', fields, cookie)).json()
  await request('cards', fields, cookie)
  assert.equal((await request('cards/' + card.id, null, other)).status, 404)
  now = new Date('2026-11-20T16:30:00Z') // next Shanghai day
  await request('cards/' + card.id, null, cookie)
  await send('resume', card.id)
  await send('resume', card.id)
  assert.deepEqual(rows().map(row => row.event), ['first_send', 'send', 'card_preview', 'card_save', 'card_open', 'send', 'card_send'])
  for (const row of rows()) {
    assert.deepEqual(Object.keys(row).sort(), ['analysisId', 'event', 'occurredAt'])
    assert.notEqual(row.analysisId, cookie.split('=')[1])
    assert.ok(!JSON.stringify(row).includes('私密'))
  }
  const metrics = trialMetrics(rows(), new Date('2026-11-21T16:00:00Z'))
  for (const metric of [metrics.senderSaveRate, metrics.saverNextDayReturnRate, metrics.openToSendRate]) assert.deepEqual(metric, { numerator: 1, denominator: 1, rate: 1 })
  await request('cards/' + card.id, null, cookie, 'DELETE')
  assert.equal(rows().length, 7)
  app.emit('close')
  app = createApp(file, async () => 'reply', { clock: () => now })
  request = makeClient(app)
  assert.equal(rows().length, 7)
  await request('messages', { requestId: 'other', text: '另一个访客' }, other)
  assert.equal(new Set(rows().map(row => row.analysisId)).size, 2)
  assert.equal((await request('session', null, cookie, 'DELETE')).status, 200)
  assert.equal(rows().length, 2)
  assert.equal(db.prepare('SELECT count(*) AS n FROM analytics_visitors').get().n, 1)
  now = new Date('2026-11-28T16:30:00Z')
  await request('session', null, other)
  assert.equal(rows().length, 0)
})

test('指标排除未成熟次日、按访客去重、要求打开后发送、零分母为空', () => {
  const event = (analysisId, name, occurredAt) => ({ analysisId, event: name, occurredAt })
  const rows = [
    event('a', 'send', '2026-11-20T15:00:00Z'),
    event('a', 'card_save', '2026-11-20T15:30:00Z'),
    event('a', 'card_save', '2026-11-20T15:40:00Z'),
    event('a', 'card_open', '2026-11-20T16:00:00Z'),
    event('a', 'card_open', '2026-11-20T16:05:00Z'),
    event('b', 'send', '2026-11-20T15:00:00Z'),
    event('b', 'card_send', '2026-11-20T15:00:00Z'),
    event('b', 'card_open', '2026-11-20T16:00:00Z'),
  ]
  const early = trialMetrics(rows, new Date('2026-11-21T15:59:59Z'))
  assert.equal(early.saverNextDayReturnRate.denominator, 0)
  const result = trialMetrics(rows, new Date('2026-11-21T16:00:00Z'))
  assert.deepEqual(result.senderSaveRate, { numerator: 1, denominator: 2, rate: 0.5 })
  assert.deepEqual(result.saverNextDayReturnRate, { numerator: 1, denominator: 1, rate: 1 })
  assert.deepEqual(result.openToSendRate, { numerator: 0, denominator: 2, rate: 0 })
  for (const metric of [trialMetrics([]).senderSaveRate, trialMetrics([]).saverNextDayReturnRate, trialMetrics([]).openToSendRate]) assert.equal(metric.rate, null)
})

test('首次发送过期不补造历史，窗口外发送的收藏仍有独立计数', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'wanxin-retention-'))
  const file = join(dir, 'db.sqlite')
  let now = new Date('2026-11-01T00:00:00Z')
  const app = createApp(file, async () => 'reply', { clock: () => now })
  const db = new DatabaseSync(file)
  t.after(() => { app.emit('close'); db.close(); rmSync(dir, { recursive: true, force: true }) })
  const request = makeClient(app)
  const { cookie } = await request('session', { adult: true })
  const sent = await request('messages', { requestId: 'first', text: '你好' }, cookie)
  const sourceMessageId = sent.json().messages[1].id
  now = new Date('2026-11-09T00:00:00Z')
  assert.equal((await request('cards', { sourceMessageId, title: '标题', body: '正文' }, cookie)).status, 200)
  const events = db.prepare('SELECT * FROM trial_events').all()
  assert.deepEqual(trialMetrics(events, now).senderSaveRate, { numerator: 0, denominator: 0, rate: null })
  assert.equal(trialMetrics(events, now).windowSavingVisitors, 1)
  const newSend = await request('messages', { requestId: 'new', text: '新的一天' }, cookie)
  await request('cards', { sourceMessageId: newSend.json().messages.at(-2).id, title: '新标题', body: '新正文' }, cookie)
  const current = db.prepare('SELECT * FROM trial_events').all()
  assert.deepEqual(trialMetrics(current, now).senderSaveRate, { numerator: 1, denominator: 1, rate: 1 })
  assert.equal(current.filter(row => row.event === 'first_send').length, 0)
})


test('窗口左右边界、未来事件、收藏先于发送与独立回看队列', () => {
  const asOf = new Date('2026-11-10T16:00:00Z')
  const e = (analysisId, event, occurredAt) => ({ analysisId, event, occurredAt })
  const result = trialMetrics([
    e('left', 'send', '2026-11-03T16:00:00Z'),
    e('right', 'send', asOf.toISOString()),
    e('future', 'send', '2026-11-10T16:00:01Z'),
    e('before', 'card_save', '2026-11-08T15:00:00Z'),
    e('before', 'send', '2026-11-09T15:00:00Z'),
    e('before', 'card_open', '2026-11-08T16:00:00Z'),
  ], asOf)
  assert.deepEqual(result.senderSaveRate, { numerator: 0, denominator: 2, rate: 0 })
  assert.equal(result.windowSavingVisitors, 1)
  assert.deepEqual(result.saverNextDayReturnRate, { numerator: 1, denominator: 1, rate: 1 })
})

test('旧五动作表升级保留原事件，允许send且重启幂等、清除级联有效', () => {
  const db = new DatabaseSync(':memory:')
  try {
    db.exec(`PRAGMA foreign_keys=ON;
      CREATE TABLE visitors (id TEXT PRIMARY KEY);
      INSERT INTO visitors VALUES ('v');
      CREATE TABLE analytics_visitors (visitorId TEXT PRIMARY KEY REFERENCES visitors(id) ON DELETE CASCADE, analysisId TEXT NOT NULL UNIQUE);
      INSERT INTO analytics_visitors VALUES ('v','a');
      CREATE TABLE trial_events (analysisId TEXT NOT NULL REFERENCES analytics_visitors(analysisId) ON DELETE CASCADE,
        event TEXT NOT NULL CHECK(event IN ('first_send','card_preview','card_save','card_open','card_send')), occurredAt TEXT NOT NULL);
      INSERT INTO trial_events VALUES ('a','first_send','2026-11-10T00:00:00.000Z');`)
    const clock = () => new Date('2026-11-10T01:00:00Z')
    createAnalytics(db, clock).record('v', 'send')
    createAnalytics(db, clock)
    assert.deepEqual(db.prepare('SELECT event FROM trial_events ORDER BY rowid').all().map(row => row.event), ['first_send', 'send'])
    assert.throws(() => db.prepare("INSERT INTO trial_events VALUES ('a','private','2026-11-10T01:00:00Z')").run())
    db.prepare("DELETE FROM visitors WHERE id='v'").run()
    assert.equal(db.prepare('SELECT count(*) n FROM trial_events').get().n, 0)
  } finally { db.close() }
})

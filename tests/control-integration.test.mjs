import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { createApp } from '../server/app.mjs'
import { developmentPolicy, loadPolicy } from '../server/access.mjs'
import { fixture } from './helpers/access-fixture.mjs'
import { makeClient } from './helpers/http-client.mjs'

const digest = token => createHash('sha256').update(token).digest('hex')
test('受控旧库、单实例、准入、失败重试次数、重放、清除补发和重启', async t => {
  const f = fixture(t)
  f.policy = { ...f.policy, limits: { ...f.policy.limits, redeemSource: 20, redeemGlobal: 20 } }
  const db = new DatabaseSync(f.env.SQLITE_PATH)
  f.after(() => db.close())
  // Old visitors have no invitation binding and must not be upgraded implicitly.
  db.exec(`CREATE TABLE visitors (id TEXT PRIMARY KEY, adultConfirmedAt TEXT NOT NULL, createdAt TEXT NOT NULL);
    INSERT INTO visitors VALUES ('00000000-0000-0000-0000-000000000000','old','old');`)
  let calls = 0
  const reply = async () => { if (++calls === 1) throw new Error('secret-provider-error'); return '合成回复' }
  const clock = () => new Date('2026-11-26T00:00:00Z')
  let app = createApp(f.env.SQLITE_PATH, reply, { access: f.policy, clock })
  f.after(() => app.emit('close'))
  assert.throws(() => createApp(f.env.SQLITE_PATH, reply, { access: f.policy, clock }), /Instance lock/)
  let request = makeClient(app)
  assert.equal((await request('thread', null, 'wanxin=00000000-0000-0000-0000-000000000000')).status, 403)
  assert.equal((await request('session', { adult: true, inviteToken: f.token }, null, 'POST', { origin: 'https://evil.example' })).status, 403)
  const admitted = await request('session', { adult: true, inviteToken: f.token })
  assert.equal(admitted.status, 200)
  const cookie = admitted.cookie
  assert.equal((await request('session', { adult: true }, cookie)).status, 200)
  assert.equal((await request('session', { adult: true, inviteToken: f.token })).status, 403)
  const payload = { requestId: 'first', text: '合成私密正文' }
  assert.equal((await request('messages', payload, cookie)).status, 503) // disabled by default
  assert.equal(calls, 0)
  assert.equal(db.prepare("SELECT count(*) n FROM messages WHERE role='user'").get().n, 0)
  db.exec('UPDATE runtime_control SET callsEnabled=1')
  assert.equal((await request('messages', payload, cookie)).status, 503) // actual failed attempt consumes one
  assert.equal((await request('messages', payload, cookie)).status, 200)
  assert.equal((await request('messages', payload, cookie)).status, 200) // replay is free
  assert.equal(calls, 2)
  assert.equal(db.prepare("SELECT used FROM call_daily WHERE scope='global'").get().used, 2)
  assert.equal(db.prepare("SELECT count(*) n FROM trial_events WHERE event='send'").get().n, 1)
  const source = db.prepare("SELECT id FROM messages WHERE role='user'").get().id
  assert.equal((await request('card-preview', { sourceMessageId: source }, cookie)).status, 200)
  assert.equal(calls, 2)
  assert.equal((await request('session', null, cookie, 'DELETE')).status, 200)
  assert.equal(db.prepare('SELECT count(*) n FROM trial_events').get().n, 0)
  const replacement = 'b'.repeat(64)
  f.save([{ ...f.invite, tokenId: 'replacement', version: 2, digest: digest(replacement) }])
  const newCookie = (await request('session', { adult: true, inviteToken: replacement })).cookie
  assert.equal((await request('messages', { ...payload, requestId: 'third' }, newCookie)).status, 200)
  assert.equal((await request('messages', { ...payload, requestId: 'fourth' }, newCookie)).status, 429)
  assert.equal(calls, 3)
  app.emit('close')
  app = createApp(f.env.SQLITE_PATH, reply, { access: f.policy, clock })
  request = makeClient(app)
  assert.equal((await request('messages', { ...payload, requestId: 'restart' }, newCookie)).status, 429)
  assert.equal(calls, 3)
  f.save([{ ...f.invite, tokenId: 'replacement', version: 2, digest: digest(replacement), enabled: false }])
  assert.equal((await request('thread', null, newCookie)).status, 403)
  assert.equal((await request('session', null, newCookie, 'DELETE')).status, 200)
})

test('超时未结束不释放槽、不同主体并发拒绝、晚到结果不复活消息', async t => {
  const f = fixture(t)
  const token2 = 'c'.repeat(64)
  f.save([f.invite, { ...f.invite, tokenId: 'other', subjectId: 'other', digest: digest(token2) }])
  const policy = loadPolicy(f.env)
  let settle
  let started
  const invoked = new Promise(resolve => { started = resolve })
  const wait = new Promise(resolve => { settle = resolve })
  const db = new DatabaseSync(f.env.SQLITE_PATH)
  f.after(() => db.close())
  let calls = 0
  const app = createApp(f.env.SQLITE_PATH, async () => { calls++; started(); await wait; return '迟到的私密回复' },
    { access: policy, clock: () => new Date('2026-11-26T00:00:00Z'), timeoutMs: 15 })
  f.after(() => app.emit('close'))
  const request = makeClient(app)
  const first = (await request('session', { adult: true, inviteToken: f.token })).cookie
  const second = (await request('session', { adult: true, inviteToken: token2 })).cookie
  db.exec('UPDATE runtime_control SET callsEnabled=1')
  const result = request('messages', { requestId: 'slow', text: '合成' }, first)
  await invoked
  assert.equal((await request('messages', { requestId: 'parallel', text: '合成' }, second)).status, 429)
  assert.equal((await result).status, 503)
  assert.equal((await request('messages', { requestId: 'after-timeout', text: '合成' }, second)).status, 429)
  assert.equal(calls, 1)
  assert.equal(db.prepare("SELECT count(*) n FROM call_attempts WHERE state='timeout_pending'").get().n, 1)
  settle()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(db.prepare("SELECT count(*) n FROM messages WHERE content='迟到的私密回复'").get().n, 0)
  assert.equal(db.prepare("SELECT state FROM call_attempts").get().state, 'timeout')
})

test('邀请并发兑换仅一次；事务写失败不扣额度、不调用模型；日志不含哨兵', async t => {
  const f = fixture(t)
  const db = new DatabaseSync(f.env.SQLITE_PATH)
  f.after(() => db.close())
  let calls = 0
  const lines = []
  const app = createApp(f.env.SQLITE_PATH, async () => { calls++; throw new Error('SENTINEL_PROVIDER_SECRET') },
    { access: f.policy, logger: line => lines.push(line), clock: () => new Date('2026-11-26T00:00:00Z') })
  f.after(() => app.emit('close'))
  const request = makeClient(app)
  const admitted = await Promise.all([request('session', { adult: true, inviteToken: f.token }), request('session', { adult: true, inviteToken: f.token })])
  assert.deepEqual(admitted.map(row => row.status).sort(), [200, 403])
  const cookie = admitted.find(row => row.status === 200).cookie
  db.exec(`UPDATE runtime_control SET callsEnabled=1;
    CREATE TRIGGER reject_user BEFORE INSERT ON messages WHEN NEW.role='user' BEGIN SELECT RAISE(ABORT,'SENTINEL_DATABASE_SECRET'); END;`)
  const payload = { requestId: 'SENTINEL_REQUEST', text: 'SENTINEL_BODY' }
  assert.equal((await request('messages?secret=SENTINEL_QUERY', payload, cookie)).status, 500)
  assert.equal(calls, 0)
  assert.equal(db.prepare('SELECT count(*) n FROM call_daily').get().n, 0)
  assert.equal(db.prepare('SELECT count(*) n FROM call_attempts').get().n, 0)
  db.exec('DROP TRIGGER reject_user')
  assert.equal((await request('messages', payload, cookie)).status, 503)
  assert.equal(calls, 1)
  assert.equal((await request('messages', { requestId: 'other', text: 'SENTINEL_BODY' }, cookie, 'POST', { origin: undefined })).status, 403)
  assert.ok(!lines.join('').includes('SENTINEL'))
  assert.ok(!lines.join('').includes(f.token))
  assert.ok(!lines.join('').includes(cookie))
  assert.ok(lines.some(line => JSON.parse(line).event === 'model_error'))
  db.exec('UPDATE runtime_control SET callsEnabled=0')
  assert.equal((await request('messages', payload, cookie)).json().code, 'calls_stopped')
  assert.equal(calls, 1)
})

test('撤销Cookie可用新版本邀请重新准入，但不自动认领旧数据', async t => {
  const f = fixture(t)
  const app = createApp(f.env.SQLITE_PATH, async () => '合成', { access: f.policy, logger: () => {}, clock: () => new Date('2026-11-26T00:00:00Z') })
  f.after(() => app.emit('close'))
  const request = makeClient(app)
  const old = (await request('session', { adult: true, inviteToken: f.token })).cookie
  const replacement = 'd'.repeat(64)
  f.save([{ ...f.invite, tokenId: 'replacement', version: 2, digest: digest(replacement) }])
  assert.equal((await request('session', null, old)).json().threadId, null)
  const admitted = await request('session', { adult: true, inviteToken: replacement }, old)
  assert.equal(admitted.status, 200)
  assert.notEqual(admitted.cookie, old)
  assert.equal((await request('thread', null, old)).status, 403)
  assert.equal((await request('thread', null, admitted.cookie)).status, 200)
  assert.equal((await request('thread')).json().code, 'invitation_required')
  assert.equal((await request('session', null, old, 'DELETE')).status, 200)
})


test('有消息卡片和匿名事件的旧库增表兼容，受控模式不继承旧Cookie', async t => {
  const f = fixture(t)
  const clock = () => new Date('2026-11-26T00:00:00Z')
  let app = createApp(f.env.SQLITE_PATH, async () => '合成回复', { access: developmentPolicy(), logger: () => {}, clock })
  f.after(() => app.emit('close'))
  let request = makeClient(app)
  const cookie = (await request('session', { adult: true })).cookie
  const sent = await request('messages', { requestId: 'legacy', text: '旧库合成正文' }, cookie)
  const sourceMessageId = sent.json().messages[1].id
  await request('cards', { sourceMessageId, title: '旧卡', body: '旧卡合成正文' }, cookie)
  app.emit('close')
  const db = new DatabaseSync(f.env.SQLITE_PATH)
  f.after(() => db.close())
  const before = db.prepare('SELECT * FROM cards').all()
  const events = db.prepare('SELECT * FROM trial_events ORDER BY rowid').all()
  db.exec(`DROP TABLE visitor_access; DROP TABLE invite_redemptions;
    DROP TABLE call_daily; DROP TABLE control_rates; DROP TABLE call_attempts; DROP TABLE runtime_control;`)
  app = createApp(f.env.SQLITE_PATH, async () => '合成回复', { access: f.policy, logger: () => {}, clock })
  request = makeClient(app)
  assert.deepEqual(db.prepare('SELECT * FROM cards').all(), before)
  assert.deepEqual(db.prepare('SELECT * FROM trial_events ORDER BY rowid').all(), events)
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0)
  assert.equal((await request('thread', null, cookie)).status, 403)
  const admitted = await request('session', { adult: true, inviteToken: f.token }, cookie)
  assert.equal(admitted.status, 200)
  assert.deepEqual((await request('cards', null, admitted.cookie)).json().cards, [])
})

test('合并后的pins覆盖准入、Origin、所有权、幂等及清除，不绕过或消耗模型额度', async t => {
  const f = fixture(t)
  const otherToken = 'e'.repeat(64)
  const otherInvite = { ...f.invite, tokenId: 'other-pin', subjectId: 'other-pin', digest: digest(otherToken) }
  f.save([f.invite, otherInvite])
  const db = new DatabaseSync(f.env.SQLITE_PATH)
  f.after(() => db.close())
  const lines = []
  let calls = 0
  const app = createApp(f.env.SQLITE_PATH, async () => { calls++; return 'SYNTHETIC_PIN_REPLY' },
    { access: f.policy, clock: () => new Date('2026-11-26T00:00:00Z'), logger: line => lines.push(line) })
  f.after(() => app.emit('close'))
  const request = makeClient(app)
  const cookie = (await request('session', { adult: true, inviteToken: f.token })).cookie
  const other = (await request('session', { adult: true, inviteToken: otherToken })).cookie
  db.exec('UPDATE runtime_control SET callsEnabled=1')
  const sent = await request('messages', { requestId: 'pin-check', text: 'SYNTHETIC_PIN_BODY' }, cookie)
  const reply = sent.json().messages.at(-1)
  assert.equal(reply.contextCount, 1)
  const path = 'pins/' + reply.id
  assert.equal((await request(path, null, null, 'PUT')).status, 403)
  assert.equal((await request(path, null, cookie, 'PUT', { origin: 'https://evil.example' })).status, 403)
  assert.equal((await request(path, null, cookie, 'PUT', { 'content-type': 'text/plain' })).status, 415)
  assert.equal((await request(path, null, other, 'PUT')).status, 404)
  assert.equal((await request(path, null, cookie, 'PUT')).status, 200)
  assert.equal((await request(path, null, cookie, 'PUT')).status, 200)
  assert.equal(db.prepare('SELECT count(*) n FROM message_pins').get().n, 1)
  assert.equal((await request(path, null, other, 'DELETE')).status, 404)
  assert.equal((await request(path, null, cookie, 'DELETE')).status, 200)
  assert.equal((await request('thread', null, cookie)).json().messages.at(-1).pinned, 0)
  await request(path, null, cookie, 'PUT')
  f.save([{ ...f.invite, enabled: false }, otherInvite])
  assert.equal((await request(path, null, cookie, 'PUT')).status, 403)
  assert.equal((await request(path, null, cookie, 'DELETE')).status, 403)
  assert.equal((await request('session', null, cookie, 'DELETE')).status, 200)
  assert.equal(db.prepare('SELECT count(*) n FROM message_pins').get().n, 0)
  assert.equal(db.prepare('SELECT count(*) n FROM reply_activity').get().n, 0)
  assert.equal(db.prepare("SELECT used FROM call_daily WHERE scope='global'").get().used, 1)
  assert.equal(calls, 1)
  assert.ok(lines.some(line => { const row = JSON.parse(line); return row.route === 'pins' && row.status === 403 }))
  assert.ok(!lines.join('').includes('SYNTHETIC_PIN'))
  assert.ok(!lines.join('').includes(reply.id))
})

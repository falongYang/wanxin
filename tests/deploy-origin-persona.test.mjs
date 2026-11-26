import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadPolicy, developmentPolicy } from '../server/access.mjs'
import { createApp } from '../server/app.mjs'
import { fixture } from './helpers/access-fixture.mjs'
import { makeClient } from './helpers/http-client.mjs'

test('显式开关允许临时 http Origin，默认仍拒绝', async t => {
  const f = fixture(t)
  const httpEnv = { ...f.env, PUBLIC_ORIGIN: 'http://101.42.26.83', ACCESS_ALLOW_INSECURE_ORIGIN: 'true' }
  const policy = loadPolicy(httpEnv)
  assert.equal(policy.origin, 'http://101.42.26.83')
  // Without the flag, an http origin must still be rejected.
  assert.throws(() => loadPolicy({ ...f.env, PUBLIC_ORIGIN: 'http://101.42.26.83' }), /Invalid access configuration/)
  // Same-origin POST through the http policy passes the Origin gate.
  const app = createApp(f.env.SQLITE_PATH, async () => '合成回复', { access: policy, clock: () => new Date('2026-11-26T00:00:00Z') })
  f.after(() => app.emit('close'))
  const request = makeClient(app)
  const admitted = await request('session', { adult: true, inviteToken: f.token }, null, 'POST', { origin: 'http://101.42.26.83' })
  assert.equal(admitted.status, 200)
  assert.equal((await request('session', { adult: true, inviteToken: 'x' }, null, 'POST', { origin: 'http://evil.example' })).status, 403)
})

test('聊天回复按线程角色注入人设，未知角色回退林舟', async t => {
  const systems = []
  const app = createApp(':memory:', async (messages, signal, system) => { systems.push(system); return '合成回复' },
    { access: developmentPolicy() })
  t.after(() => app.emit('close'))
  const request = makeClient(app)
  const lin = (await request('session', { adult: true, characterId: 'lin-zhou' })).cookie
  await request('messages', { requestId: 'l1', text: '你好' }, lin)
  assert.match(systems.at(-1), /你是林舟/)
  const gu = (await request('session', { adult: true, characterId: 'gu-chuan' })).cookie
  await request('messages', { requestId: 'g1', text: '你好' }, gu)
  assert.match(systems.at(-1), /你是顾川/)
  const su = (await request('session', { adult: true, characterId: 'su-mian' })).cookie
  await request('messages', { requestId: 's1', text: '你好' }, su)
  assert.match(systems.at(-1), /你是孙晚/)
})
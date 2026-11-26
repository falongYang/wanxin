import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { loadPolicy, developmentPolicy, createAccess } from '../server/access.mjs'

const hash = token => createHash('sha256').update(token).digest('hex')
import { fixture } from './helpers/access-fixture.mjs'

test('受控配置缺失拒绝，只有显式非生产stub开发可开放', t => {
  assert.throws(() => loadPolicy({}))
  assert.equal(loadPolicy({ APP_ACCESS_MODE: 'development', MODEL_MODE: 'stub' }).mode, 'development')
  assert.throws(() => loadPolicy({ APP_ACCESS_MODE: 'development', MODEL_MODE: 'stub', NODE_ENV: 'production' }))
  assert.throws(() => loadPolicy({ APP_ACCESS_MODE: 'development', MODEL_MODE: 'ollama' }))
  const f = fixture(t)
  assert.throws(() => loadPolicy({ ...f.env, ACCESS_LIMITS: '{}' }))
  assert.throws(() => loadPolicy({ ...f.env, PUBLIC_ORIGIN: '*' }))
  assert.throws(() => loadPolicy({ ...f.env, ACCESS_HMAC_SECRET: '' }))
  f.save([f.invite, f.invite])
  assert.throws(() => loadPolicy(f.env))
  assert.equal(developmentPolicy().mode, 'development')
})

test('邀请原子单次兑换、撤销、补发同主体、旧会话与代理Origin边界', t => {
  const f = fixture(t)
  const db = new DatabaseSync(':memory:')
  f.after(() => db.close())
  db.exec('PRAGMA foreign_keys=ON; CREATE TABLE visitors (id TEXT PRIMARY KEY);')
  const a = createAccess(db, f.policy, () => new Date('2026-11-26T00:00:00Z'))
  const request = { headers: { origin: 'https://trial.example', 'content-type': 'application/json', 'x-real-ip': '9.9.9.9' }, socket: { remoteAddress: '127.0.0.1' } }
  assert.doesNotThrow(() => a.checkWrite(request))
  assert.throws(() => a.checkWrite({ ...request, headers: {} }))
  assert.equal(a.source(request), a.source({ ...request, headers: { ...request.headers, 'x-real-ip': '1.2.3.4' } }))
  assert.throws(() => a.authorize('old'))
  db.exec("INSERT INTO visitors VALUES ('v1'),('v2')")
  a.redeem('v1', f.token)
  assert.equal(a.authorize('v1'), 'trial-1')
  assert.throws(() => a.redeem('v2', f.token))
  f.save([{ ...f.invite, enabled: false }])
  assert.throws(() => a.authorize('v1'))
  const nextToken = 'b'.repeat(64)
  f.save([{ ...f.invite, version: 2, tokenId: 'ticket-2', digest: hash(nextToken) }])
  assert.throws(() => a.authorize('v1'))
  a.redeem('v2', nextToken)
  assert.equal(a.authorize('v2'), 'trial-1')
  db.exec("DELETE FROM visitors WHERE id='v2'")
  assert.throws(() => a.redeem('v1', nextToken))
  f.save([f.invite])
  assert.throws(() => a.authorize('v1')) // configuration rollback cannot revive an older redeemed version
  writeFileSync(f.file, 'broken')
  assert.throws(() => a.authorize('v1'))
})

test('过期邀请及可信单代理验证；头部不得自选限流来源', t => {
  const f = fixture(t)
  const db = new DatabaseSync(':memory:')
  f.after(() => db.close())
  db.exec('PRAGMA foreign_keys=ON; CREATE TABLE visitors(id TEXT PRIMARY KEY); INSERT INTO visitors VALUES (\'v\');')
  const expired = createAccess(db, f.policy, () => new Date('2026-12-01T00:00:00Z'))
  assert.throws(() => expired.redeem('v', f.token), { code: 'invitation_required' })
  const policy = loadPolicy({ ...f.env, ACCESS_PROXY_MODE: 'single-proxy', ACCESS_PROXY_ADDRESS: '127.0.0.1' })
  const access = createAccess(db, policy, () => new Date('2026-11-26T00:00:00Z'))
  assert.throws(() => access.source({ headers: { 'x-real-ip': '1.2.3.4' }, socket: { remoteAddress: '10.0.0.1' } }), { code: 'proxy_denied' })
  assert.throws(() => access.source({ headers: { 'x-real-ip': '1.2.3.4, 9.9.9.9' }, socket: { remoteAddress: '127.0.0.1' } }))
  assert.match(access.source({ headers: { 'x-real-ip': '1.2.3.4' }, socket: { remoteAddress: '127.0.0.1' } }), /^[a-f0-9]{64}$/)
  assert.throws(() => access.checkWrite({ headers: { origin: policy.origin } }), { code: 'json_required' })
})

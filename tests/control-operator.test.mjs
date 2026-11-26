import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, statSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fixture } from './helpers/access-fixture.mjs'
import { createApp } from '../server/app.mjs'
import { acquireInstanceLock } from '../server/instance-lock.mjs'
import { makeClient } from './helpers/http-client.mjs'
const run = args => spawnSync(process.execPath, ['scripts/access-control.mjs', ...args], { encoding: 'utf8' })

test('本地管理工具只输出状态，默认停止、明确启停、私密文件和人工锁接管', t => {
  const f = fixture(t)
  const app = createApp(f.env.SQLITE_PATH, async () => '合成', { access: f.policy, logger: () => {} })
  f.after(() => app.emit('close'))
  assert.equal(JSON.parse(run(['inspect', f.env.SQLITE_PATH]).stdout).callsEnabled, false)
  assert.equal(run(['enable', f.env.SQLITE_PATH]).status, 1)
  assert.equal(run(['enable', f.env.SQLITE_PATH, '--confirm-local-control']).status, 0)
  assert.equal(JSON.parse(run(['inspect', f.env.SQLITE_PATH]).stdout).callsEnabled, true)
  assert.equal(run(['stop', f.env.SQLITE_PATH, '--confirm-local-control']).status, 0)
  const target = join(f.dir, 'issued')
  const generated = run(['generate', target, 'trial-1', '2', 'ticket-2', '2026-11-01T00:00:00Z', '2026-12-01T00:00:00Z'])
  assert.equal(generated.status, 0)
  const secret = readFileSync(join(target, 'invite-secret.txt'), 'utf8').trim()
  assert.match(secret, /^[a-f0-9]{64}$/)
  assert.ok(!generated.stdout.includes(secret))
  assert.equal(statSync(join(target, 'invite-secret.txt')).mode & 0o777, 0o600)
  assert.equal(statSync(target).mode & 0o777, 0o700)
  assert.equal(run(['takeover', f.env.SQLITE_PATH, '--confirmed-old-process-stopped']).status, 1)
  const standalone = join(f.dir, 'other.sqlite')
  new DatabaseSync(standalone).close()
  const unlock = acquireInstanceLock(standalone)
  assert.throws(() => acquireInstanceLock(standalone))
  unlock()
  writeFileSync(standalone + '.instance-lock', JSON.stringify({ pid: 2147483647 }))
  assert.equal(run(['takeover', standalone]).status, 1)
  assert.equal(existsSync(standalone + '.instance-lock'), true)
  assert.equal(run(['takeover', standalone, '--confirmed-old-process-stopped']).status, 0)
})

test('配置缺失启动拒绝且不泄露原始异常；日志故障拒绝模型调用', async t => {
  const f = fixture(t)
  const result = spawnSync(process.execPath, ['server/index.mjs'], { encoding: 'utf8', env: { PATH: process.env.PATH, APP_ACCESS_MODE: 'invitation', ACCESS_INVITES_FILE: 'SENTINEL_PRIVATE' } })
  assert.equal(result.status, 1)
  assert.ok(!result.stderr.includes('SENTINEL_PRIVATE'))
  let calls = 0
  const app = createApp(f.env.SQLITE_PATH, async () => { calls++; return 'never' }, { access: f.policy, logger: () => { throw new Error('SENTINEL') } })
  f.after(() => app.emit('close'))
  const response = await makeClient(app)('session', { adult: true, inviteToken: f.token })
  assert.equal(response.status, 503)
  assert.equal(response.json().code, 'log_unavailable')
  assert.equal(calls, 0)
})

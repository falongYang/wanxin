import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { fixture } from './helpers/access-fixture.mjs'
import { createUsage } from '../server/usage.mjs'

test('原子次数、停止、超时未settled占槽、重启不退还、跨日与时钟回拨', t => {
  const f = fixture(t)
  let now = new Date('2026-11-26T00:00:00Z')
  const db = new DatabaseSync(':memory:')
  f.after(() => db.close())
  let usage = createUsage(db, f.policy, () => now)
  assert.throws(() => usage.transaction(() => usage.reserve('trial-1', 'one')))
  db.exec('UPDATE runtime_control SET callsEnabled=1')
  const id = usage.transaction(() => usage.reserve('trial-1', 'one'))
  usage.timeout(id)
  assert.throws(() => usage.transaction(() => usage.reserve('trial-1', 'two')))
  assert.equal(db.prepare('SELECT used FROM call_daily WHERE scope = ?').get('global').used, 1)
  usage.settle(id, 'error')
  const next = usage.transaction(() => usage.reserve('trial-1', 'two'))
  assert.equal(db.prepare('SELECT used FROM call_daily WHERE scope = ?').get('global').used, 2)
  usage = createUsage(db, f.policy, () => now) // confirmed single-instance takeover
  assert.equal(db.prepare('SELECT state FROM call_attempts WHERE id = ?').get(next).state, 'unknown')
  usage.transaction(() => usage.reserve('trial-1', 'three'))
  assert.throws(() => usage.transaction(() => usage.reserve('trial-1', 'four')))
  now = new Date('2026-11-26T16:00:00Z')
  usage = createUsage(db, f.policy, () => now)
  const tomorrow = usage.transaction(() => usage.reserve('trial-1', 'tomorrow'))
  usage.settle(tomorrow, 'success')
  now = new Date('2026-11-26T00:00:00Z')
  assert.throws(() => usage.transaction(() => usage.reserve('trial-1', 'clock-back')))
  assert.equal(db.prepare('SELECT sum(used) n FROM call_daily WHERE scope = ?').get('global').n, 4)
})

test('限额事务回滚且身份切换不能突破全局额度，分钟桶可恢复', t => {
  const f = fixture(t)
  const db = new DatabaseSync(':memory:')
  f.after(() => db.close())
  let now = new Date('2026-11-26T00:00:00Z')
  const usage = createUsage(db, { ...f.policy, limits: { ...f.policy.limits, globalDaily: 2, globalMinute: 1 } }, () => now)
  db.exec('UPDATE runtime_control SET callsEnabled=1')
  const a = usage.transaction(() => usage.reserve('a', 'one'))
  usage.settle(a, 'success')
  assert.throws(() => usage.transaction(() => usage.reserve('b', 'two')))
  assert.equal(db.prepare('SELECT count(*) n FROM call_daily WHERE subject = ?').get('b').n, 0)
  now = new Date(now.getTime() + 60000)
  const b = usage.transaction(() => usage.reserve('b', 'two'))
  usage.settle(b, 'error')
  now = new Date(now.getTime() + 60000)
  assert.throws(() => usage.transaction(() => usage.reserve('c', 'three')))
})

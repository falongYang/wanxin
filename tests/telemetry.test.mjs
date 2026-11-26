import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTelemetry, routeCategory } from '../server/telemetry.mjs'
test('日志仅白名单值，秘密字段/错误/URL不输出，输出失败健康检查拒绝', () => {
  const lines = []
  const logger = createTelemetry(line => lines.push(line))
  logger.emit({ event: 'request', route: 'messages', status: 429, durationMs: 12, code: 'daily_limit',
    token: 'SECRET', cookie: 'SECRET', body: 'SECRET', error: new Error('SECRET'), visitorId: 'SECRET' })
  logger.emit({ event: 'SECRET', route: '/api/cards/SECRET?token=SECRET', code: 'SECRET' })
  assert.ok(!lines.join('').includes('SECRET'))
  assert.deepEqual(Object.keys(JSON.parse(lines[0])).sort(), ['code', 'durationMs', 'event', 'route', 'status', 'time'])
  assert.equal(routeCategory('/api/cards/private'), 'cards')
  const broken = createTelemetry(() => { throw new Error('SECRET') })
  broken.emit({ event: 'startup' })
  assert.throws(() => broken.ensure(), { code: 'log_unavailable' })
})

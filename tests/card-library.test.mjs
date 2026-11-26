import { test } from 'node:test'
import assert from 'node:assert/strict'
import { groupCards } from '../src/ui/card-library.js'
const card = (id, createdAt, title, body = '') => ({ id, createdAt, title, body })
test('标题/正文连续匹配，中文英文空白与空结果，不拼接字段不修改数组', () => {
  const rows = [card('a', '2026-11-02T00:00:00Z', ' 海风 ', '今夜的电台'), card('b', '2026-11-01T00:00:00Z', ' Radio Night ', 'Warm LIGHT')]
  const before = structuredClone(rows)
  const ids = q => groupCards(rows, q).flatMap(group => group.cards.map(item => item.id))
  assert.deepEqual(ids(' 海风 '), ['a'])
  assert.deepEqual(ids('电台'), ['a'])
  assert.deepEqual(ids(' radio nIGHT '), ['b'])
  assert.deepEqual(ids('LIGHT'), ['b'])
  assert.deepEqual(ids('   '), ['a', 'b'])
  assert.deepEqual(ids('风今夜'), [])
  assert.deepEqual(ids('不存在'), [])
  assert.deepEqual(groupCards([], ''), [])
  assert.deepEqual(rows, before)
})
test('上海跨月、时间倒序与同时间稳定ID次序，异常日期置后', () => {
  const rows = [
    card('z', '2026-10-31T16:00:00Z', '十一月'),
    card('a', '2026-10-31T16:00:00Z', '同时间'),
    card('oct', '2026-10-31T15:59:59Z', '十月'),
    card('new', '2026-11-02T00:00:00Z', '较新'),
    card('bad', 'invalid', '异常'),
  ]
  const groups = groupCards(rows, '')
  assert.deepEqual(groups.map(group => group.key), ['2026-11', '2026-10', 'unknown'])
  assert.deepEqual(groups[0].cards.map(item => item.id), ['new', 'a', 'z'])
  assert.equal(groups[0].label, '2026年11月')
  assert.deepEqual(groupCards([...rows].reverse(), ''), groups)
})

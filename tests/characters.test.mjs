import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createApp } from '../server/app.mjs'
import { developmentPolicy } from '../server/access.mjs'
import { characters } from '../server/characters.js'
import { makeClient } from './helpers/http-client.mjs'

test('角色目录公开返回，默认与选中角色均可开新线程', async t => {
  const app = createApp(':memory:', async () => '合成回复', { access: developmentPolicy() })
  t.after(() => app.emit('close'))
  const request = makeClient(app)
  const catalog = await request('characters')
  assert.equal(catalog.status, 200)
  assert.equal(catalog.json().characters.length, characters.length)
  const ids = catalog.json().characters.map(item => item.id)
  assert.ok(ids.includes('lin-zhou'))

  const defaultSession = await request('session', { adult: true })
  assert.equal(defaultSession.status, 200)
  const defaultCookie = defaultSession.cookie
  assert.equal((await request('session', null, defaultCookie)).json().character, '林舟')

  const other = await request('session', { adult: true, characterId: 'gu-chuan' })
  assert.equal(other.status, 200)
  const otherCookie = other.cookie
  assert.equal((await request('session', null, otherCookie)).json().character, '顾川')
  // Thread carries the chosen character.
  const thread = await request('thread', null, otherCookie)
  assert.equal(thread.status, 200)
  assert.equal(thread.json().messages[0].content, '书店的打烊铃还没响。是想翻一本书，还是想随便坐一会儿？')

  assert.equal((await request('session', { adult: true, characterId: 'no-such' })).status, 400)
  const catalogOf = await request('session', null)
  assert.equal(catalogOf.json().character, undefined)
  assert.equal(catalogOf.json().characters.length, characters.length)
})
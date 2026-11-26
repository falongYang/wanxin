import { developmentPolicy } from '../server/access.mjs'
// Local-only synthetic audit. No network, model credentials or production data.
import assert from 'node:assert/strict'
import { mkdtempSync, copyFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { DatabaseSync } from 'node:sqlite'
import { createApp as createPolicyApp } from '../server/app.mjs'

const createApp = (file, reply, options = {}) => createPolicyApp(file, reply, { access: developmentPolicy(), ...options })

const directory = mkdtempSync(join(tmpdir(), 'wanxin-release-audit-'))
const database = join(directory, 'source.sqlite')
let app
let calls = 0
const reply = async () => { calls++; return 'synthetic reply' }
function request(path, body, cookie) {
  const input = Readable.from(body ? [JSON.stringify(body)] : [])
  Object.assign(input, { method: body ? 'POST' : 'GET', url: '/api/' + path, headers: { cookie } })
  return new Promise(resolve => {
    const headers = new Map()
    const output = {
      setHeader: (key, value) => headers.set(key.toLowerCase(), value),
      writeHead: status => { output.status = status },
      end: data => resolve({ status: output.status, headers, data: JSON.parse(data) }),
    }
    app.emit('request', input, output)
  })
}
function stop() { app.emit('close'); app = null }
try {
  app = createApp(database, reply, { secure: true })
  const session = await request('session', { adult: true })
  const header = session.headers.get('set-cookie')
  for (const flag of ['HttpOnly', 'SameSite=Lax', 'Secure']) assert.ok(header.includes(flag))
  const cookie = header.split(';')[0]
  for (let i = 0; i < 20; i++) {
    assert.equal((await request('messages', { requestId: 'audit-' + i, text: 'synthetic ' + i }, cookie)).status, 200)
  }
  assert.equal(calls, 20)
  const before = (await request('thread', null, cookie)).data
  stop()
  app = createApp(database, reply, { secure: true })
  assert.deepEqual((await request('thread', null, cookie)).data, before)
  stop()
  // A closed database has no writers: copy only after stopping, never a live-file backup.
  copyFileSync(database, join(directory, 'backup.sqlite'))
  copyFileSync(join(directory, 'backup.sqlite'), join(directory, 'restored.sqlite'))
  const db = new DatabaseSync(join(directory, 'restored.sqlite'))
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok')
  assert.equal(db.prepare('SELECT count(*) AS n FROM visitors WHERE adultConfirmedAt IS NOT NULL').get().n, 1)
  db.close()
  app = createApp(join(directory, 'restored.sqlite'), reply, { secure: true })
  assert.deepEqual((await request('thread', null, cookie)).data, before)
  console.log(JSON.stringify({ secureCookie: 'passed', restart: 'passed', stoppedBackupRestore: 'passed', integrity: 'ok', sequentialRequests: 20, modelCalls: calls, rateBudget: 'explicit development stub bypass; not a controlled-mode quota verification', scope: 'temporary synthetic database; no network' }))
} finally {
  if (app) stop()
  rmSync(directory, { recursive: true, force: true })
}

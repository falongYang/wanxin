import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { DatabaseSync } from 'node:sqlite'

const opening = '今晚的节目还没开始。你想先点一首歌，还是说说今天？'

function json(response, status, data) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  response.end(JSON.stringify(data))
}

async function readBody(request) {
  let body = ''
  for await (const chunk of request.setEncoding('utf8')) {
    body += chunk
    if (body.length > 16000) return null
  }
  try { return JSON.parse(body) } catch { return null }
}

export function createApp(filename, reply, { secure = false, timeoutMs = 15000 } = {}) {
  const db = new DatabaseSync(filename)
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS visitors (id TEXT PRIMARY KEY, adultConfirmedAt TEXT NOT NULL, createdAt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS threads (id TEXT PRIMARY KEY, visitorId TEXT UNIQUE REFERENCES visitors(id), characterId TEXT NOT NULL, createdAt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY, threadId TEXT NOT NULL REFERENCES threads(id),
      role TEXT NOT NULL, content TEXT NOT NULL, requestId TEXT,
      status TEXT NOT NULL, sourceCardId TEXT, createdAt TEXT NOT NULL,
      UNIQUE(threadId, role, requestId)
    );
  `)
  const insert = db.prepare('INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?, NULL, ?)')
  const history = db.prepare('SELECT id, role, content, requestId, status FROM messages WHERE threadId = ? ORDER BY rowid')
  const prior = db.prepare('SELECT id, content FROM messages WHERE threadId = ? AND role = ? AND requestId = ?')
  const findThread = db.prepare('SELECT id FROM threads WHERE visitorId = ?')
  const pending = new Map()
  const status = db.prepare('UPDATE messages SET status = ? WHERE id = ?')

  async function generate(threadId, user, requestId) {
    const context = db.prepare(`
      SELECT role, content FROM (
        SELECT rowid, role, content FROM messages
        WHERE threadId = ? AND status = 'complete' ORDER BY rowid DESC LIMIT 12
      ) ORDER BY rowid
    `).all(threadId)
    const controller = new AbortController()
    let timer
    try {
      const content = await Promise.race([
        Promise.resolve().then(() => reply([...context, { role: 'user', content: user.content }], controller.signal)),
        new Promise((_, reject) => {
          timer = setTimeout(() => { controller.abort(); reject(new Error('Timed out')) }, timeoutMs)
        }),
      ])
      if (typeof content !== 'string' || !content.trim()) throw new Error('Empty model reply')
      db.exec('BEGIN')
      try {
        insert.run(randomUUID(), threadId, 'assistant', content, requestId, 'complete', new Date().toISOString())
        status.run('complete', user.id)
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
      return true
    } catch {
      status.run('failed', user.id)
      return false
    } finally {
      clearTimeout(timer)
    }
  }

  async function handle(request, response) {
    const url = new URL(request.url, 'http://localhost')
    const key = request.headers.cookie?.match(/(?:^|;\s*)wanxin=([a-f0-9-]{36})(?:;|$)/)?.[1]
    let threadId = key && findThread.get(key)?.id
    const route = request.method + ' ' + url.pathname
    if (route === 'GET /api/session') return json(response, 200, { threadId: threadId || null, character: '林舟' })
    if (route === 'POST /api/session') {
      if ((await readBody(request))?.adult !== true) return json(response, 400, { error: '请先确认成年' })
      if (!threadId) {
        const visitor = randomUUID()
        threadId = randomUUID()
        const now = new Date().toISOString()
        db.exec('BEGIN')
        try {
          db.prepare('INSERT INTO visitors VALUES (?, ?, ?)').run(visitor, now, now)
          db.prepare('INSERT INTO threads VALUES (?, ?, ?, ?)').run(threadId, visitor, 'lin-zhou', now)
          insert.run(randomUUID(), threadId, 'assistant', opening, null, 'complete', now)
          db.exec('COMMIT')
        } catch (error) {
          db.exec('ROLLBACK')
          throw error
        }
        response.setHeader('Set-Cookie', 'wanxin=' + visitor + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000' + (secure ? '; Secure' : ''))
      }
      return json(response, 200, { threadId })
    }
    if (!['GET /api/thread', 'POST /api/messages'].includes(route)) return json(response, 404, {})
    if (!threadId) return json(response, 403, { error: '请先确认成年' })
    if (url.searchParams.has('threadId') && url.searchParams.get('threadId') !== threadId) return json(response, 404, {})
    if (route === 'GET /api/thread') return json(response, 200, { messages: history.all(threadId) })
    const body = await readBody(request)
    const { requestId, sourceCardId } = body ?? {}
    const content = typeof body?.text === 'string' ? body.text.trim() : ''
    if (sourceCardId != null || (body?.threadId != null && body.threadId !== threadId)) return json(response, 404, {})
    if (typeof requestId !== 'string' || !/^[\w-]{1,100}$/.test(requestId) || !content || Array.from(content).length > 1000) {
      return json(response, 400, { error: '请输入 1–1000 字' })
    }
    let user = prior.get(threadId, 'user', requestId)
    if (user && user.content !== content) return json(response, 409, { error: '请求编号已被使用' })
    if (prior.get(threadId, 'assistant', requestId)) return json(response, 200, { messages: history.all(threadId) })
    let job = pending.get(threadId)
    if (job && job.requestId !== requestId) return json(response, 409, { error: '林舟正在回复' })
    if (!job) {
      if (!user) {
        user = { id: randomUUID(), content }
        insert.run(user.id, threadId, 'user', content, requestId, 'pending', new Date().toISOString())
      } else {
        status.run('pending', user.id)
      }
      job = { requestId, result: generate(threadId, user, requestId).finally(() => pending.delete(threadId)) }
      pending.set(threadId, job)
    }
    const complete = await job.result
    return json(response, complete ? 200 : 503, { messages: history.all(threadId) })
  }

  const server = createServer((request, response) => {
    handle(request, response).catch(() => json(response, 500, { error: '请求暂时无法完成' }))
  })
  server.on('close', () => db.close())
  return server
}

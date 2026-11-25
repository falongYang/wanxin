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

export function createApp(filename, reply, { secure = false, timeoutMs = 15000, weather } = {}) {
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
  db.exec(`
    CREATE TABLE IF NOT EXISTS cards (
      id TEXT PRIMARY KEY, threadId TEXT NOT NULL REFERENCES threads(id),
      sourceMessageId TEXT NOT NULL REFERENCES messages(id),
      title TEXT NOT NULL, body TEXT NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL,
      UNIQUE(threadId, sourceMessageId)
    );
    CREATE TABLE IF NOT EXISTS message_card_context (
      messageId TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      cardId TEXT NOT NULL, PRIMARY KEY(messageId, cardId)
    );
  `)
  const insert = db.prepare('INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
  const history = db.prepare('SELECT id, role, content, requestId, status, sourceCardId FROM messages WHERE threadId = ? ORDER BY rowid')
  const prior = db.prepare('SELECT id, content, sourceCardId FROM messages WHERE threadId = ? AND role = ? AND requestId = ?')
  const findThread = db.prepare('SELECT id FROM threads WHERE visitorId = ?')
  const pending = new Map()
  const status = db.prepare('UPDATE messages SET status = ? WHERE id = ?')

  const findCard = db.prepare(`
    SELECT cards.*, messages.content AS sourceContent FROM cards
    JOIN messages ON messages.id = cards.sourceMessageId WHERE cards.threadId = ? AND cards.id = ?
  `)
  const findSource = db.prepare("SELECT content, createdAt FROM messages WHERE threadId = ? AND id = ? AND status = 'complete'")
  const dependencies = db.prepare('SELECT cardId FROM message_card_context WHERE messageId = ?')
  const recordDependency = db.prepare('INSERT INTO message_card_context VALUES (?, ?)')
  const cardFields = body => {
    const title = typeof body?.title === 'string' ? body.title.trim() : ''
    const text = typeof body?.body === 'string' ? body.body.trim() : ''
    return title && text && Array.from(title).length <= 60 && Array.from(text).length <= 1000
      ? [title, text] : null
  }

  async function generate(threadId, user, requestId, card) {
    const context = db.prepare(`
      SELECT id, role, content FROM (
        SELECT rowid, id, role, content FROM messages
        WHERE threadId = ? AND status = 'complete'
          AND (sourceCardId IS NULL OR EXISTS (SELECT 1 FROM cards WHERE cards.id = messages.sourceCardId))
          AND NOT EXISTS (
            SELECT 1 FROM message_card_context AS context
            LEFT JOIN cards ON cards.id = context.cardId
            WHERE context.messageId = messages.id AND cards.id IS NULL
          )
        ORDER BY rowid DESC LIMIT 12
      ) ORDER BY rowid
    `).all(threadId)
    const modelMessages = context.map(({ role, content }) => ({ role, content }))
    // Keep provenance across turns so deleting a card also excludes replies derived from it.
    const cardIds = new Set(context.flatMap(message => dependencies.all(message.id).map(row => row.cardId)))
    if (card) {
      cardIds.add(card.id)
      modelMessages.push({ role: 'user', content: '我选择引用这张经历卡：' + JSON.stringify({ title: card.title, body: card.body }) })
    }
    modelMessages.push({ role: 'user', content: user.content })
    const controller = new AbortController()
    let timer
    try {
      const content = await Promise.race([
        Promise.resolve().then(() => reply(modelMessages, controller.signal)),
        new Promise((_, reject) => {
          timer = setTimeout(() => { controller.abort(); reject(new Error('Timed out')) }, timeoutMs)
        }),
      ])
      if (typeof content !== 'string' || !content.trim()) throw new Error('Empty model reply')
      db.exec('BEGIN')
      try {
        const assistantId = randomUUID()
        insert.run(assistantId, threadId, 'assistant', content, requestId, 'complete', card?.id ?? null, new Date().toISOString())
        for (const cardId of cardIds) recordDependency.run(assistantId, cardId)
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
    if (route === 'GET /api/session') return json(response, 200, { threadId: threadId || null, character: '林舟', ...(weather && { weatherAvailable: true }) })
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
          insert.run(randomUUID(), threadId, 'assistant', opening, null, 'complete', null, now)
          db.exec('COMMIT')
        } catch (error) {
          db.exec('ROLLBACK')
          throw error
        }
        response.setHeader('Set-Cookie', 'wanxin=' + visitor + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000' + (secure ? '; Secure' : ''))
      }
      return json(response, 200, { threadId, ...(weather && { weatherAvailable: true }) })
    }
    if (route === 'GET /api/weather/cities' || route === 'GET /api/weather/current') {
      if (!threadId || !weather) return json(response, 404, {})
      try {
        if (route.endsWith('/cities')) {
          return json(response, 200, { cities: await weather.cities(url.searchParams.get('name')?.trim() ?? '') })
        }
        const lat = url.searchParams.get('latitude')
        const lon = url.searchParams.get('longitude')
        if (!lat?.trim() || !lon?.trim() || !(Math.abs(Number(lat)) <= 90 && Math.abs(Number(lon)) <= 180)) {
          return json(response, 400, {})
        }
        return json(response, 200, { temperature: await weather.temperature(Number(lat), Number(lon)) })
      } catch {
        return json(response, 503, {})
      }
    }
    const cardRoute = /^\/api\/cards\/([a-f0-9-]{36})$/.exec(url.pathname)
    if (!['GET /api/thread', 'POST /api/messages', 'POST /api/card-preview', 'GET /api/cards',
      'POST /api/cards', 'DELETE /api/session'].includes(route) &&
      !(cardRoute && ['GET', 'PATCH', 'DELETE'].includes(request.method))) return json(response, 404, {})
    if (!threadId) return json(response, 403, { error: '请先确认成年' })
    if (url.searchParams.has('threadId') && url.searchParams.get('threadId') !== threadId) return json(response, 404, {})
    if (route === 'GET /api/thread') return json(response, 200, { messages: history.all(threadId) })
    if (route === 'GET /api/cards') {
      return json(response, 200, { cards: db.prepare('SELECT * FROM cards WHERE threadId = ? ORDER BY rowid DESC').all(threadId) })
    }
    if (route === 'DELETE /api/session') {
      if (pending.has(threadId)) return json(response, 409, { error: '请等林舟回复后再清除' })
      db.exec('BEGIN')
      try {
        db.prepare('DELETE FROM cards WHERE threadId = ?').run(threadId)
        db.prepare('DELETE FROM messages WHERE threadId = ?').run(threadId)
        db.prepare('DELETE FROM threads WHERE id = ?').run(threadId)
        db.prepare('DELETE FROM visitors WHERE id = ?').run(key)
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
      response.setHeader('Set-Cookie', 'wanxin=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0' + (secure ? '; Secure' : ''))
      return json(response, 200, {})
    }
    const body = request.method === 'POST' || request.method === 'PATCH' ? await readBody(request) : null
    if (!findThread.get(key)) return json(response, 404, {})
    if (cardRoute) {
      const card = findCard.get(threadId, cardRoute[1])
      if (!card) return json(response, 404, {})
      if (request.method === 'GET') return json(response, 200, { card })
      if (request.method === 'DELETE') {
        if (pending.has(threadId)) return json(response, 409, { error: '请等林舟回复后再删除' })
        db.prepare('DELETE FROM cards WHERE threadId = ? AND id = ?').run(threadId, card.id)
        return json(response, 200, {})
      }
      const fields = cardFields(body)
      if (!fields) return json(response, 400, { error: '请输入标题和正文' })
      db.prepare('UPDATE cards SET title = ?, body = ?, updatedAt = ? WHERE threadId = ? AND id = ?')
        .run(...fields, new Date().toISOString(), threadId, card.id)
      return json(response, 200, { card: findCard.get(threadId, card.id) })
    }
    if (route === 'POST /api/card-preview' || route === 'POST /api/cards') {
      const sourceId = body?.sourceMessageId
      const source = typeof sourceId === 'string' && findSource.get(threadId, sourceId)
      if (!source) return json(response, 404, {})
      if (route === 'POST /api/card-preview') {
        return json(response, 200, {
          title: Array.from(source.content.trim().replace(/\s+/g, ' ')).slice(0, 24).join(''),
          body: Array.from(source.content.match(/[^。！？!?\n]+[。！？!?]*/g)?.slice(0, 3).join('') || source.content).slice(0, 1000).join(''),
          createdAt: source.createdAt,
        })
      }
      const fields = cardFields(body)
      if (!fields) return json(response, 400, { error: '请输入标题和正文' })
      const now = new Date().toISOString()
      db.prepare('INSERT INTO cards VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(threadId, sourceMessageId) DO NOTHING')
        .run(randomUUID(), threadId, sourceId, ...fields, now, now)
      const { id } = db.prepare('SELECT id FROM cards WHERE threadId = ? AND sourceMessageId = ?').get(threadId, sourceId)
      return json(response, 200, { card: findCard.get(threadId, id) })
    }
    const { requestId, sourceCardId } = body ?? {}
    const content = typeof body?.text === 'string' ? body.text.trim() : ''
    if ((sourceCardId != null && typeof sourceCardId !== 'string') || (body?.threadId != null && body.threadId !== threadId)) return json(response, 404, {})
    if (typeof requestId !== 'string' || !/^[\w-]{1,100}$/.test(requestId) || !content || Array.from(content).length > 1000) {
      return json(response, 400, { error: '请输入 1–1000 字' })
    }
    const card = sourceCardId == null ? null : findCard.get(threadId, sourceCardId)
    if (sourceCardId != null && !card) return json(response, 404, { error: '经历卡已不可用，可移除引用后继续发送' })
    let user = prior.get(threadId, 'user', requestId)
    if (user && (user.content !== content || user.sourceCardId !== (sourceCardId ?? null))) return json(response, 409, { error: '请求编号已被使用' })
    if (prior.get(threadId, 'assistant', requestId)) return json(response, 200, { messages: history.all(threadId) })
    let job = pending.get(threadId)
    if (job && job.requestId !== requestId) return json(response, 409, { error: '林舟正在回复' })
    if (!job) {
      if (!user) {
        user = { id: randomUUID(), content }
        insert.run(user.id, threadId, 'user', content, requestId, 'pending', sourceCardId ?? null, new Date().toISOString())
      } else {
        status.run('pending', user.id)
      }
      job = { requestId, result: generate(threadId, user, requestId, card).finally(() => pending.delete(threadId)) }
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

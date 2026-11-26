import { createTelemetry, routeCategory } from './telemetry.mjs'
import { createUsage } from './usage.mjs'
import { acquireInstanceLock } from './instance-lock.mjs'
import { createAccess, ControlError } from './access.mjs'
import { createAnalytics } from './analytics.mjs'
import { characters, defaultCharacterId, characterById, summarizeCharacter } from './characters.js'
import { createFeatures } from './features.mjs'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { DatabaseSync } from 'node:sqlite'

async function readBody(request) {
  let body = ''
  for await (const chunk of request.setEncoding('utf8')) {
    body += chunk
    if (body.length > 16000) return null
  }
  try { return JSON.parse(body) } catch { return null }
}

export function createApp(filename, reply, { secure = false, timeoutMs = 15000, weather, access, logger, clock = () => new Date(), summarize } = {}) {
  if (!access) throw new Error('Explicit access policy required')
  if (access.mode === 'invitation' && filename === ':memory:') throw new Error('Controlled mode requires persistent storage')
  const release = filename !== ':memory:' ? acquireInstanceLock(filename) : () => {}
  let db
  try {
  db = new DatabaseSync(filename)
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
    CREATE TABLE IF NOT EXISTS message_pins (
      messageId TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
      pinnedAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS reply_activity (
      messageId TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
      contextCount INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS message_card_context (
      messageId TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      cardId TEXT NOT NULL, PRIMARY KEY(messageId, cardId)
    );
  `)
  let authorization, usage
  db.exec('BEGIN IMMEDIATE')
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS control_schema (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL);
      INSERT OR IGNORE INTO control_schema VALUES (1,1);`)
    if (db.prepare('SELECT version FROM control_schema WHERE id=1').get().version !== 1) throw new Error('Unsupported control schema')
    authorization = createAccess(db, access, clock)
    usage = createUsage(db, access, clock)
    db.exec('COMMIT')
  } catch (error) { db.exec('ROLLBACK'); throw error }
  const analytics = createAnalytics(db, clock)
  const insert = db.prepare('INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
  const history = db.prepare(`
    SELECT id, role, content, requestId, status, sourceCardId, reply_activity.contextCount,
      message_pins.messageId IS NOT NULL AS pinned
    FROM messages
    LEFT JOIN message_pins ON message_pins.messageId = messages.id
    LEFT JOIN reply_activity ON reply_activity.messageId = messages.id
    WHERE threadId = ? ORDER BY messages.rowid
  `)
  const recordActivity = db.prepare('INSERT INTO reply_activity VALUES (?, ?)')
  const pinMessage = db.prepare('INSERT INTO message_pins VALUES (?, ?) ON CONFLICT(messageId) DO NOTHING')
  const unpinMessage = db.prepare('DELETE FROM message_pins WHERE messageId = ?')
  const prior = db.prepare('SELECT id, content, sourceCardId FROM messages WHERE threadId = ? AND role = ? AND requestId = ?')
  const findThread = db.prepare('SELECT id, characterId FROM threads WHERE visitorId = ?')
  const threadCharacter = db.prepare('SELECT characterId FROM threads WHERE id = ?')
  const pending = new Map()
  const telemetry = createTelemetry(logger)
  telemetry.emit({ event: 'startup' })
  const features = createFeatures(db, {
    authorization, usage, analytics, telemetry, reply,
    clock, timeoutMs,
    personaOf: threadId => characterById(threadCharacter.get(threadId)?.characterId)?.persona,
  })
  const json = (response, status, data) => {
    telemetry.emit({ event: 'request', route: response.controlRoute, status, code: data.code, durationMs: Date.now() - response.controlStarted })
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
    response.end(JSON.stringify(data))
  }
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

  const fallbackSummary = content => ({
    title: Array.from(content.trim().replace(/\s+/g, ' ')).slice(0, 24).join(''),
    body: Array.from(content.match(/[^。！？!?\n]+[。！？!?]*/g)?.slice(0, 3).join('') || content).slice(0, 1000).join(''),
  })

  // Real-model card preview goes through the same reserve/settle quota gateway as
  // messages (operation='preview'), and degrades to the local extraction on any
  // failure so a card can always be edited and saved manually.
  async function previewSummary(key, source) {
    let attempt = null
    if (summarize && authorization.controlled) {
      usage.transaction(() => {
        const subject = authorization.authorize(key)
        attempt = usage.reserve(subject, authorization.digest('preview:' + source.id), 'preview')
      })
    }
    const fallback = () => fallbackSummary(source.content)
    if (!summarize) return { attempt, summary: fallback() }
    const controller = new AbortController()
    const started = Date.now()
    let timedOut = false
    let timer
    try {
      const model = Promise.resolve().then(() => summarize(source.content, controller.signal)).then(result => {
        if (!result || typeof result.title !== 'string' || typeof result.body !== 'string') throw new Error('Invalid model summary')
        return result
      })
      const summary = await Promise.race([
        model,
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            timedOut = true
            try { usage.timeout(attempt) } catch { telemetry.emit({ event: 'control_error' }) }
            telemetry.emit({ event: 'model_timeout', durationMs: Date.now() - started })
            controller.abort()
            reject(new Error('Timed out'))
          }, timeoutMs)
        }),
      ])
      usage.settle(attempt, 'success')
      if (!timedOut) telemetry.emit({ event: 'model_success', durationMs: Date.now() - started })
      return { attempt, summary: summary, model: summary }
    } catch (error) {
      usage.settle(attempt, 'error')
      if (!timedOut) telemetry.emit({ event: 'model_error', durationMs: Date.now() - started })
      return { attempt, summary: fallback() }
    } finally {
      clearTimeout(timer)
    }
  }

  async function generate(threadId, user, requestId, card, attempt, job) {
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
    const started = Date.now()
    let timedOut = false
    let timer
    try {
      const model = Promise.resolve().then(() => {
        // Persona follows the thread's character; unknown characters fall back to 林舟.
        const characterId = threadCharacter.get(threadId)?.characterId
        return reply(modelMessages, controller.signal, characterById(characterId)?.persona
          ?? characterById(defaultCharacterId).persona)
      }).then(content => {
        if (typeof content !== 'string' || !content.trim()) throw new Error('Empty model reply')
        return content
      })
      job.started = true
      job.settled = model.then(() => {
        usage.settle(attempt, 'success')
        if (!timedOut) telemetry.emit({ event: 'model_success', durationMs: Date.now() - started })
      }, () => {
        usage.settle(attempt, 'error')
        if (!timedOut) telemetry.emit({ event: 'model_error', durationMs: Date.now() - started })
      }).catch(() => telemetry.emit({ event: 'control_error' })).finally(() => pending.delete(threadId))
      // The HTTP timeout never frees a slot before the underlying operation settles.
      const content = await Promise.race([
        model,
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            timedOut = true
            try { usage.timeout(attempt) } catch { telemetry.emit({ event: 'control_error' }) }
            telemetry.emit({ event: 'model_timeout', durationMs: Date.now() - started })
            controller.abort()
            reject(new Error('Timed out'))
          }, timeoutMs)
        }),
      ])
      db.exec('BEGIN')
      try {
        const assistantId = randomUUID()
        insert.run(assistantId, threadId, 'assistant', content, requestId, 'complete', card?.id ?? null, new Date().toISOString())
        recordActivity.run(assistantId, context.length)
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
    analytics.prune()
    const url = new URL(request.url, 'http://localhost')
    response.controlRoute = routeCategory(url.pathname)
    response.controlStarted = Date.now()
    telemetry.ensure()
    const key = request.headers.cookie?.match(/(?:^|;\s*)wanxin=([a-f0-9-]{36})(?:;|$)/)?.[1]
    const threadRow = key ? findThread.get(key) : undefined
    let threadId = threadRow?.id
    const route = request.method + ' ' + url.pathname
    if (route === 'GET /api/session') {
      if (threadId) { try { authorization.authorize(key) } catch (error) {
        if (error.status !== 403) throw error
        threadId = null
      } }
      return json(response, 200, {
        accessRequired: authorization.controlled,
        threadId: threadId || null,
        character: threadId ? characterById(threadRow.characterId)?.name ?? '林舟' : undefined,
        characters: characters.map(summarizeCharacter),
        ...(weather && { weatherAvailable: true }),
      })
    }
    if (route === 'GET /api/characters') {
      return json(response, 200, { characters: characters.map(summarizeCharacter) })
    }
    if (request.method !== 'GET') authorization.checkWrite(request)
    if (route === 'POST /api/session') {
      usage.redeemRate(authorization.source(request))
      const admission = await readBody(request)
      if (admission?.adult !== true) return json(response, 400, { error: '请先确认成年' })
      const selectedCharacter = admission?.characterId == null ? defaultCharacterId : admission.characterId
      if (typeof selectedCharacter !== 'string' || !characterById(selectedCharacter)) return json(response, 400, { error: '角色不可用' })
      if (threadId) {
        try { authorization.authorize(key) } catch (error) {
          if (!(error instanceof ControlError) || error.code !== 'invitation_required' || !admission.inviteToken) throw error
          // A new invitation creates a separate identity; never adopt old unbound data.
          threadId = null
        }
      }
      if (!threadId) {
        const visitor = randomUUID()
        threadId = randomUUID()
        const now = new Date().toISOString()
        db.exec('BEGIN IMMEDIATE')
        try {
          db.prepare('INSERT INTO visitors VALUES (?, ?, ?)').run(visitor, now, now)
          authorization.redeem(visitor, admission.inviteToken)
          db.prepare('INSERT INTO threads VALUES (?, ?, ?, ?)').run(threadId, visitor, selectedCharacter, now)
          insert.run(randomUUID(), threadId, 'assistant', characterById(selectedCharacter).opening, null, 'complete', null, now)
          db.exec('COMMIT')
        } catch (error) {
          db.exec('ROLLBACK')
          throw error
        }
        response.setHeader('Set-Cookie', 'wanxin=' + visitor + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000' + (secure ? '; Secure' : ''))
      }
      return json(response, 200, { threadId, character: characterById(selectedCharacter).name, ...(weather && { weatherAvailable: true }) })
    }
    if (!threadId && authorization.controlled) throw new ControlError(403, 'invitation_required')
    if (threadId && route !== 'DELETE /api/session') {
      const subject = authorization.authorize(key)
      usage.endpointRate(subject)
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
    // 陪伴功能路由（羁绊/心情/朋友圈/形象/信箱/愿望/纪念日/礼物/生活服务）
    if (/^\/api\/(bond|mood|home|moments|avatar|services|letters|anniversaries|wishes|gifts)(\/|$)/.test(url.pathname)) {
      if (!threadId) return json(response, 403, { error: '请先确认成年' })
      const featureBody = ['POST', 'PATCH', 'PUT'].includes(request.method) ? await readBody(request) : null
      const handled = await features.handle({ method: request.method, url, pathname: url.pathname, body: featureBody, threadId, key })
      if (!handled) return json(response, 404, {})
      return json(response, handled.status, handled.data)
    }
    const pinRoute = /^\/api\/pins\/([a-f0-9-]{36})$/.exec(url.pathname)
    const mutatingPin = pinRoute && ['PUT', 'DELETE'].includes(request.method)
    const cardRoute = /^\/api\/cards\/([a-f0-9-]{36})$/.exec(url.pathname)
    if (!['GET /api/thread', 'POST /api/messages', 'POST /api/card-preview', 'GET /api/cards',
      'POST /api/cards', 'DELETE /api/session'].includes(route) && !mutatingPin &&
      !(cardRoute && ['GET', 'PATCH', 'DELETE'].includes(request.method))) return json(response, 404, {})
    if (!threadId) return json(response, 403, { error: '请先确认成年' })
    if (url.searchParams.has('threadId') && url.searchParams.get('threadId') !== threadId) return json(response, 404, {})
    if (mutatingPin) {
      const messageId = pinRoute[1]
      if (!findSource.get(threadId, messageId)) return json(response, 404, {})
      if (request.method === 'PUT') pinMessage.run(messageId, new Date().toISOString())
      else unpinMessage.run(messageId)
      return json(response, 200, { messages: history.all(threadId) })
    }
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
      if (request.method === 'GET') {
        analytics.record(key, 'card_open')
        return json(response, 200, { card })
      }
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
        analytics.record(key, 'card_preview')
        const { summary, model } = await previewSummary(key, source)
        return json(response, 200, { ...(model ?? summary), createdAt: source.createdAt })
      }
      const fields = cardFields(body)
      if (!fields) return json(response, 400, { error: '请输入标题和正文' })
      const now = new Date().toISOString()
      const saved = db.prepare('INSERT INTO cards VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(threadId, sourceMessageId) DO NOTHING')
        .run(randomUUID(), threadId, sourceId, ...fields, now, now)
      if (saved.changes) {
        analytics.record(key, 'card_save')
        features.award(threadId, 5)
      }
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
      let attempt
      let fresh = false
      telemetry.ensure()
      usage.transaction(() => {
        const subject = authorization.authorize(key)
        attempt = usage.reserve(subject, authorization.controlled ? authorization.digest(requestId) : requestId)
        if (!user) {
          fresh = true
          const firstSend = !db.prepare("SELECT 1 FROM messages WHERE threadId = ? AND role = 'user' LIMIT 1").get(threadId)
          user = { id: randomUUID(), content }
          insert.run(user.id, threadId, 'user', content, requestId, 'pending', sourceCardId ?? null, new Date().toISOString())
          if (firstSend) analytics.record(key, 'first_send')
          analytics.record(key, 'send')
          if (card) analytics.record(key, 'card_send')
        } else status.run('pending', user.id)
      })
      if (fresh) features.award(threadId, card ? 3 : 2)
      job = { requestId, started: false, settled: Promise.resolve() }
      pending.set(threadId, job)
      job.result = generate(threadId, user, requestId, card, attempt, job).finally(() => {
        if (!job.started) { usage.settle(attempt, 'error'); pending.delete(threadId) }
      })
    }
    const complete = await job.result
    return json(response, complete ? 200 : 503, { messages: history.all(threadId) })
  }

  const server = createServer((request, response) => {
    handle(request, response).catch(error => {
      if (error instanceof ControlError) {
        if (error.retryAfter) response.setHeader('Retry-After', String(error.retryAfter))
        return json(response, error.status, { error: error.status === 403 ? '需要有效邀请才能继续。' : error.status === 429 ? '请求已达当前额度或频率上限，请稍后手动重试。' : '服务暂不可用，请稍后手动重试。', code: error.code })
      }
      json(response, 500, { error: '请求暂时无法完成' })
    })
  })
  server.on('close', () => {
    const close = () => { db.close(); release() }
    if (pending.size) Promise.allSettled([...pending.values()].map(job => job.settled)).then(close)
    else close()
  })
  return server
  } catch (error) { db?.close(); release(); throw error }
}

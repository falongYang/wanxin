// 晚信陪伴功能路由：羁绊、心情、朋友圈、形象、信箱、愿望、纪念日、礼物、生活服务。
// 所有数据线程级隔离（ON DELETE CASCADE），模型调用一律走受控 reserve/settle 网关
// 并支持零成本模板降级；外部服务只做深链+网页回退，不伪造平台 API。
import { randomUUID } from 'node:crypto'

const DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' })

export function dayKey(clock) {
  return DAY.format(clock())
}

// 羁绊等级表：门槛 -> 称号
const LEVELS = [[0, '初识'], [100, '点头之交'], [300, '熟悉'], [700, '陪伴'], [1500, '牵挂'], [3000, '灵魂共振']]
export function levelOf(points) {
  let index = 0
  for (let i = 0; i < LEVELS.length; i++) if (points >= LEVELS[i][0]) index = i
  return { level: index + 1, title: LEVELS[index][1], floor: LEVELS[index][0], ceil: LEVELS[index + 1]?.[0] ?? null }
}

export const MOODS = ['开心', '平静', '疲惫', '难过', '焦虑', '生气', '期待', '其他']
const MOOD_REPLIES = {
  开心: ['替你把这份开心多留了一会儿。今晚的灯都亮得柔和一些。', '开心是会传染的，我这边也跟着亮了一下。'],
  平静: ['平静也很好。像退潮之后的海面，什么都稳稳的。', '这样的平静很难得，值得多待一会儿。'],
  疲惫: ['辛苦了。把脚步放慢一点，剩下的路我陪你慢慢走。', '累就靠一会儿，电台的灯不催你。'],
  难过: ['难过不用急着收起来。你想说，我就在；不想说，我也在。', '把难过交给我保管一会儿，你只管喘口气。'],
  焦虑: ['先把呼吸放慢。事情一件一件来，今晚先只顾好自己。', '焦虑的时候，先抓住眼前一件小事就好。'],
  生气: ['生气是合理的。先让它过去，我陪你等风停。', '气就发出来，这里不会碎。'],
  期待: ['有期待的日子，夜里的星星都会提前亮。', '我也开始期待了。到时候记得讲给我听。'],
  其他: ['不管今天是什么样，你来了，这里就亮着。', '慢慢说，我听着呢。'],
}
const moodReply = mood => MOOD_REPLIES[mood]?.[Math.floor(Math.random() * MOOD_REPLIES[mood].length)] ?? MOOD_REPLIES.其他[0]

export function createFeatures(db, { authorization, usage, analytics, telemetry, reply, clock = () => new Date(), timeoutMs = 15000, personaOf }) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS bond (threadId TEXT PRIMARY KEY REFERENCES threads(id) ON DELETE CASCADE, points INTEGER NOT NULL DEFAULT 0, updatedAt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS mood_log (threadId TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE, day TEXT NOT NULL, mood TEXT NOT NULL, note TEXT, reply TEXT, createdAt TEXT NOT NULL, PRIMARY KEY(threadId, day));
    CREATE TABLE IF NOT EXISTS moments (id TEXT PRIMARY KEY, threadId TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE, author TEXT NOT NULL CHECK(author IN ('user','character')), content TEXT NOT NULL, moodTag TEXT, createdAt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS moment_likes (momentId TEXT NOT NULL REFERENCES moments(id) ON DELETE CASCADE, threadId TEXT NOT NULL, PRIMARY KEY(momentId, threadId));
    CREATE TABLE IF NOT EXISTS moment_comments (id TEXT PRIMARY KEY, momentId TEXT NOT NULL REFERENCES moments(id) ON DELETE CASCADE, author TEXT NOT NULL CHECK(author IN ('user','character')), content TEXT NOT NULL, createdAt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS avatar_config (threadId TEXT PRIMARY KEY REFERENCES threads(id) ON DELETE CASCADE, config TEXT NOT NULL, updatedAt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS letters (id TEXT PRIMARY KEY, threadId TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE, day TEXT NOT NULL, content TEXT NOT NULL, readAt TEXT, createdAt TEXT NOT NULL, UNIQUE(threadId, day));
    CREATE TABLE IF NOT EXISTS anniversaries (id TEXT PRIMARY KEY, threadId TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE, title TEXT NOT NULL, date TEXT NOT NULL, repeatYearly INTEGER NOT NULL DEFAULT 1, createdAt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS wishes (id TEXT PRIMARY KEY, threadId TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE, content TEXT NOT NULL, blessing TEXT, createdAt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS gift_log (threadId TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE, day TEXT NOT NULL, count INTEGER NOT NULL, PRIMARY KEY(threadId, day));
  `)

  const now = () => clock().toISOString()
  const bondRow = db.prepare('SELECT points FROM bond WHERE threadId = ?')
  const addBond = db.prepare('INSERT INTO bond VALUES (?, ?, ?) ON CONFLICT(threadId) DO UPDATE SET points = points + excluded.points, updatedAt = excluded.updatedAt')

  function award(threadId, points) {
    if (!Number.isSafeInteger(points) || points <= 0) return
    db.exec('BEGIN IMMEDIATE')
    try { addBond.run(threadId, points, now()); db.exec('COMMIT') }
    catch { db.exec('ROLLBACK') }
  }
  function bondInfo(threadId) {
    const points = bondRow.get(threadId)?.points ?? 0
    const { level, title, floor, ceil } = levelOf(points)
    return { points, level, title, progress: ceil ? Math.round((points - floor) / (ceil - floor) * 100) : 100, next: ceil }
  }

  // 统一的模型调用：reserve -> 调用 -> settle，超时/失败/无额度一律降级返回 null。
  async function callModel(ctx, operation, digestKey, messages, system) {
    if (typeof reply !== 'function') return null
    let attempt = null
    if (authorization.controlled) {
      try {
        usage.transaction(() => {
          const subject = authorization.authorize(ctx.key)
          attempt = usage.reserve(subject, authorization.digest(operation + ':' + digestKey), operation)
        })
      } catch { return null }
    }
    const controller = new AbortController()
    const started = Date.now()
    let timedOut = false
    let timer
    try {
      const model = Promise.resolve().then(() => reply(messages, controller.signal, system)).then(content => {
        if (typeof content !== 'string' || !content.trim()) throw new Error('Empty model reply')
        return content.trim()
      })
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
      usage.settle(attempt, 'success')
      if (!timedOut) telemetry.emit({ event: 'model_success', durationMs: Date.now() - started })
      return content
    } catch {
      usage.settle(attempt, 'error')
      return null
    } finally { clearTimeout(timer) }
  }

  // 最近聊天上下文（给动态/信笺生成用）
  const recent = db.prepare(`
    SELECT role, content FROM messages WHERE threadId = ? AND status = 'complete' ORDER BY rowid DESC LIMIT 10
  `)
  function chatContext(threadId) {
    return recent.all(threadId).reverse().map(({ role, content }) => ({ role, content }))
  }

  const count = (sql, ...args) => db.prepare(sql).get(...args).n
  const hasMood = (threadId, day) => !!db.prepare('SELECT 1 FROM mood_log WHERE threadId = ? AND day = ?').get(threadId, day)
  // 连续打卡：从今天（或昨天）往前数
  function streakOf(threadId) {
    let start = 0
    if (!hasMood(threadId, dayKey(clock))) start = 1
    let streak = 0
    for (let i = start; hasMood(threadId, DAY.format(new Date(clock().getTime() - i * 86400000))); i++) streak++
    return streak
  }

  async function handle(ctx) {
    const { method, pathname, threadId, key } = ctx
    const seg = pathname.split('/').filter(Boolean) // ['api', ...]
    const [, resource, arg, action] = seg
    const body = ctx.body
    const persona = personaOf(threadId) || ''

    if (resource === 'bond' && method === 'GET') return { status: 200, data: bondInfo(threadId) }

    if (resource === 'mood') {
      if (method === 'GET') {
        const day = dayKey(clock)
        const today = db.prepare('SELECT mood, note, reply, createdAt FROM mood_log WHERE threadId = ? AND day = ?').get(threadId, day)
        return { status: 200, data: { today: today ?? null, streak: streakOf(threadId), moods: MOODS, history: db.prepare('SELECT day, mood, note FROM mood_log WHERE threadId = ? ORDER BY day DESC LIMIT 14').all(threadId) } }
      }
      if (method === 'POST') {
        const mood = typeof body?.mood === 'string' && MOODS.includes(body.mood) ? body.mood : null
        const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 200) : ''
        if (!mood) return { status: 400, data: { error: '选一个今天的心情吧' } }
        const day = dayKey(clock)
        const existing = db.prepare('SELECT mood, note, reply, createdAt FROM mood_log WHERE threadId = ? AND day = ?').get(threadId, day)
        if (existing) return { status: 200, data: { mood: existing, already: true, bond: bondInfo(threadId) } }
        let replyText = moodReply(mood)
        const context = chatContext(threadId)
        const modelReply = await callModel(ctx, 'letter', 'mood:' + day + ':' + threadId,
          [{ role: 'user', content: `我今天的心情是「${mood}」${note ? '，补充：' + note : ''}。请以你的身份简短回应我（两三句，60字内），温柔共情，不评判。` }, ...context.slice(-6)],
          persona + '这是心情打卡后的私下回应，用第二人称直接对用户说。')
        if (modelReply) replyText = modelReply
        const saved = db.prepare('INSERT OR IGNORE INTO mood_log VALUES (?, ?, ?, ?, ?, ?)').run(threadId, day, mood, note || null, replyText, now())
        if (!saved.changes) return { status: 200, data: { mood: db.prepare('SELECT mood, note, reply, createdAt FROM mood_log WHERE threadId = ? AND day = ?').get(threadId, day), already: true, bond: bondInfo(threadId) } }
        award(threadId, 4)
        analytics.record(key, 'mood_checkin')
        return { status: 200, data: { mood: { mood, note: note || null, reply: replyText, createdAt: now() }, bond: bondInfo(threadId) } }
      }
    }

    if (resource === 'home' && method === 'GET') {
      const day = dayKey(clock)
      const mood = db.prepare('SELECT mood FROM mood_log WHERE threadId = ? AND day = ?').get(threadId, day)
      const unread = count("SELECT count(*) n FROM letters WHERE threadId = ? AND readAt IS NULL", threadId)
      const wishesN = count('SELECT count(*) n FROM wishes WHERE threadId = ?', threadId)
      const gifts = db.prepare('SELECT count FROM gift_log WHERE threadId = ? AND day = ?').get(threadId, day)?.count ?? 0
      const days = db.prepare('SELECT id, title, date, repeatYearly FROM anniversaries WHERE threadId = ? ORDER BY date').all(threadId)
        .map(row => {
          const base = new Date(row.date + 'T00:00:00+08:00')
          let next = base
          if (row.repeatYearly) {
            const today = new Date(clock().getTime() + 8 * 3600000)
            next = new Date(base)
            next.setFullYear(today.getUTCFullYear())
            if (next.getTime() < today.getTime() - 86400000) next = new Date(next.getTime() + 365.25 * 86400000)
          }
          return { id: row.id, title: row.title, date: row.date, repeatYearly: row.repeatYearly, daysLeft: Math.max(0, Math.round((next.getTime() - clock().getTime()) / 86400000)) }
        })
        .sort((a, b) => a.daysLeft - b.daysLeft)
      return {
        status: 200,
        data: {
          bond: bondInfo(threadId),
          mood: { today: mood?.mood ?? null, streak: streakOf(threadId) },
          letters: { unread },
          wishes: { count: wishesN },
          anniversaries: { next: days[0] ?? null },
          gifts: { today: gifts },
        },
      }
    }
    return null
  }

  return { handle, award, bondInfo, callModel, chatContext, dayKey: () => dayKey(clock), moodReply }
}
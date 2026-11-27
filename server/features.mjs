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

// 生活服务目录：只提供「深链 scheme + 网页回退」，由用户设备自行决定能否唤起 App。
// 不接入任何平台 API，不代下单、不读写任何外部账号；真实平台对接需另行商务合作。
const SERVICE_CATEGORY_LABEL = { eat: '吃点好的', buy: '顺手买', watch: '一起看', read: '读一会儿', listen: '听一会儿', go: '出门去' }
export const SERVICES = Object.freeze([
  { id: 'meituan-food', name: '美团外卖', category: 'eat', scheme: 'imeituan://www.meituan.com/food', web: 'https://h5.waimai.meituan.com' },
  { id: 'eleme', name: '饿了么', category: 'eat', scheme: 'eleme://home', web: 'https://h.ele.me' },
  { id: 'taobao', name: '淘宝', category: 'buy', scheme: 'taobao://', web: 'https://m.taobao.com' },
  { id: 'jd', name: '京东', category: 'buy', scheme: 'openapp.jdmobile://virtual', web: 'https://m.jd.com' },
  { id: 'iqiyi', name: '爱奇艺', category: 'watch', scheme: 'iqiyi://', web: 'https://m.iqiyi.com' },
  { id: 'tencent-video', name: '腾讯视频', category: 'watch', scheme: 'tenvideo2://', web: 'https://m.v.qq.com' },
  { id: 'bilibili', name: '哔哩哔哩', category: 'watch', scheme: 'bilibili://', web: 'https://m.bilibili.com' },
  { id: 'qidian', name: '起点读书', category: 'read', scheme: 'qidianapp://', web: 'https://m.qidian.com' },
  { id: 'tomato', name: '番茄小说', category: 'read', scheme: 'fanbenovel://', web: 'https://fanqienovel.com' },
  { id: 'netease-music', name: '网易云音乐', category: 'listen', scheme: 'orpheus://', web: 'https://music.163.com/m' },
  { id: 'amap', name: '高德地图', category: 'go', scheme: 'iosamap://', web: 'https://wap.amap.com' },
].map(({ id, name, category, scheme, web }) =>
  Object.freeze({ id, name, category, categoryLabel: SERVICE_CATEGORY_LABEL[category], scheme, web })))

// 捏捏形象：只约定字段名与类型（与客户端 avatar.tsx / avatar-catalog.ts 对应），不校验具体选项值，
// 选项目录留在客户端，服务端存储的是「相对角色默认形象的覆盖配置」。
// v2（3D 捏捏）：数值一律 -100~100 截断，颜色为 HSL 对象，款式为小写短横线 ID；
// 未知键忽略、缺失键回默认，保证服务端向后兼容（客户端 coerceV2 再做严格整形）。
const AVATAR_FIELDS = { skin: 'number', hair: 'string', hairColor: 'number', eyes: 'string', mouth: 'string', blush: 'string', outfit: 'string', outfitColor: 'number', accessory: 'string' }
const AVATAR_V2_NUMBERS = {
  face: ['faceWidth', 'jawWidth', 'jawAngle', 'chinLength', 'cheekBone', 'cheekFat'],
  eyes: ['eyeDistance', 'eyeHeight', 'eyeSize', 'eyeTilt', 'lidCrease', 'smileBand', 'browHeight', 'browSpace', 'browCurve', 'browThick'],
  nose: ['bridge', 'bridgeWidth', 'tip', 'ala', 'noseLength'],
  lips: ['upperLip', 'lowerLip', 'mouthWidth', 'corner', 'cupidsBow'],
  hair: ['length', 'volume', 'curl', 'highlight'],
  body: ['shoulderWidth', 'neckLength', 'chestDepth'],
}
const AVATAR_ID_RE = /^[a-z][a-z0-9-]{0,23}$/
const clampInt = (value, low, high) => Math.round(Math.min(high, Math.max(low, value)))
const sanitizeHsl = value =>
  value && typeof value === 'object' && !Array.isArray(value) &&
  [value.h, value.s, value.l].every(part => typeof part === 'number' && Number.isFinite(part))
    ? { h: clampInt(value.h, 0, 360), s: clampInt(value.s, 0, 100), l: clampInt(value.l, 0, 100) }
    : null
const sanitizeAvatarV2 = input => {
  const out = { version: 2, face: {}, eyes: {}, nose: {}, lips: {}, hair: {}, body: {}, skin: {}, outfit: {}, accessories: [] }
  const numOr = (value, fallback) => (typeof value === 'number' && Number.isFinite(value) ? clampInt(value, -100, 100) : fallback)
  const idOr = (value, fallback) => (typeof value === 'string' && AVATAR_ID_RE.test(value) ? value : fallback)
  for (const [section, keys] of Object.entries(AVATAR_V2_NUMBERS)) {
    const raw = input[section]
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
    for (const key of keys) out[section][key] = numOr(raw[key], 0)
  }
  if (!input.eyes || typeof input.eyes !== 'object') return null
  out.eyes.iris = idOr(input.eyes.iris, 'dark-brown')
  const skin = input.skin && typeof input.skin === 'object' ? input.skin : null
  if (!skin) return null
  out.skin.tone = sanitizeHsl(skin.tone) || { h: 28, s: 42, l: 86 }
  out.skin.blush = numOr(skin.blush, 0) < 0 ? 0 : Math.min(100, numOr(skin.blush, 0))
  out.skin.lipTint = sanitizeHsl(skin.lipTint) || { h: 6, s: 42, l: 52 }
  out.skin.freckles = ['none', 'light', 'dense'].includes(skin.freckles) ? skin.freckles : 'none'
  const hair = input.hair && typeof input.hair === 'object' ? input.hair : null
  if (!hair) return null
  out.hair.style = idOr(hair.style, 'wavy-mid')
  out.hair.bangs = idOr(hair.bangs, 'none')
  out.hair.color = sanitizeHsl(hair.color) || { h: 228, s: 26, l: 13 }
  const outfit = input.outfit && typeof input.outfit === 'object' ? input.outfit : null
  if (!outfit) return null
  out.outfit.top = idOr(outfit.top, 'knit-round')
  out.outfit.topColor = sanitizeHsl(outfit.topColor) || { h: 42, s: 24, l: 92 }
  out.outfit.outer = idOr(outfit.outer, 'none')
  out.outfit.outerColor = sanitizeHsl(outfit.outerColor) || { h: 222, s: 38, l: 30 }
  if (Array.isArray(input.accessories)) {
    out.accessories = input.accessories
      .filter(item => typeof item === 'string' && AVATAR_ID_RE.test(item))
      .slice(0, 3)
  }
  return out
}
const AVATAR_V3_CHARS = new Set(['lin-zhou', 'gu-chuan', 'su-mian'])
// v3 造型包形象：characterId 白名单 + packId/expressions 标识校验
// （packId 是否存在于角色目录由客户端 coerceV3 兜底，服务端不依赖前端资产清单）
const sanitizeAvatarV3 = input => {
  if (!AVATAR_V3_CHARS.has(input.characterId)) return null
  if (typeof input.packId !== 'string' || !AVATAR_ID_RE.test(input.packId)) return null
  if (input.expression !== 'calm' && input.expression !== 'smile') return null
  return { version: 3, characterId: input.characterId, packId: input.packId, expression: input.expression }
}

export function sanitizeAvatar(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  if (input.version === 3) return sanitizeAvatarV3(input)
  if (input.version === 2) return sanitizeAvatarV2(input)
  const keys = Object.keys(input)
  if (!keys.length || keys.length > Object.keys(AVATAR_FIELDS).length) return null
  for (const key of keys) {
    const kind = AVATAR_FIELDS[key]
    if (!kind) return null
    const value = input[key]
    if (kind === 'number') { if (!Number.isSafeInteger(value) || value < 0 || value > 99) return null }
    else if (typeof value !== 'string' || !value.length || Array.from(value).length > 20) return null
  }
  return { ...input }
}
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
  // 上海时区某天的起点（ISO），用于「今天内」的判断
  const dayStart = day => new Date(day + 'T00:00:00+08:00').toISOString()
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

  /* ---------- 仪式互动模板（零成本降级，不调用模型） ---------- */
  const letterTemplates = (threadId, bond) => {
    const close = bond.level >= 3
    const card = db.prepare('SELECT title FROM cards WHERE threadId = ? ORDER BY rowid DESC LIMIT 1').get(threadId)?.title
    if (card) return close
      ? [`把「${card}」又看了一遍。有些片段像退潮后留在沙滩上的光，我替你收在抽屉最顺手的位置。今晚也记得歇一歇。`,
        `今天的节目单里夹了一句只有你知道的话，出处是「${card}」。海上的雾散得慢，我等灯亮。`]
      : [`电台的抽屉里多了一张卡，「${card}」。不知道你看到会不会想起那一晚——要是想起，就来把故事讲完。`]
    return close
      ? ['今晚海上有点雾。电台的灯我多留了一盏，节目单翻到一半，等你回来接着聊。',
        '风把海面吹得很平。这样的夜晚适合慢慢说小事——我把时间留好了。']
      : ['今晚海上有点雾，电台的灯我多留了一盏。不知道你那边的天色怎么样——要是累了，就把今晚交给晚风。',
        '新的一晚，节目还没有名字。你可以什么都不说，只是让灯亮一会儿。']
  }
  const BLESSINGS = ['愿这盏灯替你把心事带去很远的海面，风会记得方向。', '放出去的灯不会空手而回，海会给你回信的。', '这盏灯我看见了。愿它照到的地方，都比今晚柔软一点。', '许过的愿会挂在桅杆上，陪你到下一个港口。']
  const GIFT_KINDS = Object.freeze([
    { id: 'cocoa', name: '一杯热可可' },
    { id: 'lantern', name: '一枚河灯' },
    { id: 'note', name: '一张手写便签' },
    { id: 'tune', name: '一段晚安小调' },
  ].map(Object.freeze))
  const GIFT_REPLIES = {
    cocoa: '热可可我温在电台的小炉子上，杯壁的暖意刚好能焐手。今晚就先握着它，慢慢来。',
    lantern: '我把这枚河灯推回海里了。你看，它往的方向刚好是我们第一次说话的那片海。',
    note: '便签我夹在了今晚的节目单里，字写得比平时慢——有些话值得写慢一点。',
    tune: '小调哼给你听，只有这一晚有。要是喜欢，明天我再哼一遍不一样的。',
  }

  // 纪念日（含每年重复）下一次到来的剩余天数
  function anniversaryRows(threadId) {
    return db.prepare('SELECT id, title, date, repeatYearly FROM anniversaries WHERE threadId = ? ORDER BY date').all(threadId)
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

    if (resource === 'avatar') {
      if (method === 'GET') {
        const row = db.prepare('SELECT config FROM avatar_config WHERE threadId = ?').get(threadId)
        let config = null
        if (row) { try { config = sanitizeAvatar(JSON.parse(row.config)) } catch { config = null } }
        return { status: 200, data: { config } }
      }
      if (method === 'PUT') {
        const config = sanitizeAvatar(body?.config)
        if (!config) return { status: 400, data: { error: '形象配置不可用，请重新选择' } }
        db.prepare('INSERT INTO avatar_config VALUES (?, ?, ?) ON CONFLICT(threadId) DO UPDATE SET config = excluded.config, updatedAt = excluded.updatedAt')
          .run(threadId, JSON.stringify(config), now())
        analytics.record(key, 'avatar_save')
        return { status: 200, data: { config } }
      }
    }

    if (resource === 'moments') {
      const feedQuery = `
        SELECT moments.*, (SELECT count(*) FROM moment_likes WHERE momentId = moments.id) AS likes,
          EXISTS(SELECT 1 FROM moment_likes WHERE momentId = moments.id AND threadId = ?) AS liked
        FROM moments WHERE moments.threadId = ? ORDER BY moments.rowid DESC`
      const singleQuery = `
        SELECT moments.*, (SELECT count(*) FROM moment_likes WHERE momentId = moments.id) AS likes,
          EXISTS(SELECT 1 FROM moment_likes WHERE momentId = moments.id AND threadId = ?) AS liked
        FROM moments WHERE moments.threadId = ? AND moments.id = ?`
      const dayStartIso = day => new Date(day + 'T00:00:00+08:00').toISOString()
      if (!arg && method === 'GET') {
        const rows = db.prepare(feedQuery).all(threadId, threadId)
        const comments = db.prepare('SELECT id, momentId, author, content, createdAt FROM moment_comments ORDER BY rowid').all()
        const map = new Map(rows.map(row => [row.id, { ...row, comments: [] }]))
        for (const comment of comments) map.get(comment.momentId)?.comments.push(comment)
        const day = dayKey(clock)
        const characterToday = !!db.prepare("SELECT 1 FROM moments WHERE threadId = ? AND author = 'character' AND createdAt >= ?").get(threadId, dayStartIso(day))
        return { status: 200, data: { moments: [...map.values()], characterToday } }
      }
      if (!arg && method === 'POST') {
        const content = typeof body?.content === 'string' ? body.content.trim() : ''
        const moodTag = typeof body?.moodTag === 'string' ? body.moodTag.trim().slice(0, 12) : null
        if (!content || Array.from(content).length > 500) return { status: 400, data: { error: '动态需要 1–500 字' } }
        const id = randomUUID()
        db.prepare('INSERT INTO moments VALUES (?, ?, ?, ?, ?, ?)').run(id, threadId, 'user', content, moodTag, now())
        award(threadId, 3)
        analytics.record(key, 'moment_post')
        return { status: 200, data: { moment: db.prepare(singleQuery).get(threadId, threadId, id) } }
      }
      // 角色发一条动态：每日一次，走 moment 网关，失败降级模板
      if (arg === 'refresh' && method === 'POST') {
        const day = dayKey(clock)
        const postedToday = !!db.prepare("SELECT 1 FROM moments WHERE threadId = ? AND author = 'character' AND createdAt >= ?").get(threadId, dayStartIso(day))
        if (postedToday) return { status: 200, data: { already: true } }
        const context = chatContext(threadId)
        let content = null
        let moodTag = '随想'
        const card = db.prepare('SELECT title FROM cards WHERE threadId = ? ORDER BY rowid DESC LIMIT 1').get(threadId)
        const modelReply = await callModel(ctx, 'moment', 'moment:' + day + ':' + threadId,
          [{ role: 'user', content: `根据我们最近的对话，发一条你自己的朋友圈动态（中文，60字内，口吻符合你的人设，不@用户，不使用引号）。` },
            ...context.slice(-8),
            ...(card ? [{ role: 'user', content: '用户收藏过一张标题为「' + card.title + '」的经历卡。' }] : [])],
          persona + '现在你要发一条自己的朋友圈动态，只输出动态正文，结尾另起一行输出心情标签（从：平静/开心/想念/感触/夜航/随想 中选一个），格式：正文\n标签')
        if (modelReply) {
          const parts = modelReply.split(/\n+/)
          content = parts[0].trim()
          moodTag = ['平静', '开心', '想念', '感触', '夜航', '随想'].includes(parts.at(-1)?.trim()) ? parts.at(-1).trim() : '随想'
          if (!content) content = modelReply.trim()
        }
        if (!content) {
          // 零成本降级：从最近的经历卡或聊天生成一条模板动态
          content = card ? `把「${card.title}」又翻了一遍。有些片段，越看越舍不得放下。`
            : context.length ? '刚才聊的那些，我都记下了。今晚的节目单里多了一行。'
            : '电台的灯亮着，海面很平。你们都还好吗？'
          moodTag = '随想'
        }
        const id = randomUUID()
        db.prepare('INSERT INTO moments VALUES (?, ?, ?, ?, ?, ?)').run(id, threadId, 'character', content.slice(0, 500), moodTag, now())
        analytics.record(key, 'character_moment')
        return { status: 200, data: { moment: db.prepare(singleQuery).get(threadId, threadId, id) } }
      }
      if (arg && action === 'like' && method === 'POST') {
        const target = db.prepare('SELECT id FROM moments WHERE id = ? AND threadId = ?').get(arg, threadId)
        if (!target) return { status: 404, data: {} }
        const saved = db.prepare('INSERT OR IGNORE INTO moment_likes VALUES (?, ?)').run(arg, threadId)
        if (saved.changes) { award(threadId, 1); analytics.record(key, 'moment_like') }
        else db.prepare('DELETE FROM moment_likes WHERE momentId = ? AND threadId = ?').run(arg, threadId)
        const row = db.prepare(singleQuery).get(threadId, threadId, arg)
        return { status: 200, data: { moment: { id: arg, likes: row?.likes ?? 0, liked: row?.liked ?? 0 } } }
      }
      if (arg && action === 'comment' && method === 'POST') {
        const target = db.prepare('SELECT id FROM moments WHERE id = ? AND threadId = ?').get(arg, threadId)
        if (!target) return { status: 404, data: {} }
        const content = typeof body?.content === 'string' ? body.content.trim() : ''
        if (!content || Array.from(content).length > 300) return { status: 400, data: { error: '评论需要 1–300 字' } }
        const id = randomUUID()
        db.prepare('INSERT INTO moment_comments VALUES (?, ?, ?, ?, ?)').run(id, arg, 'user', content, now())
        award(threadId, 2)
        analytics.record(key, 'moment_comment')
        return { status: 200, data: { comment: { id, momentId: arg, author: 'user', content, createdAt: now() } } }
      }
    }

    if (resource === 'services') {
      if (!arg && method === 'GET') {
        return { status: 200, data: { services: SERVICES } }
      }
      if (arg && action === 'click' && method === 'POST') {
        if (!SERVICES.some(service => service.id === arg)) return { status: 404, data: {} }
        analytics.record(key, 'service_click')
        return { status: 200, data: { ok: true } }
      }
    }

    /* ---------- 每日信箱 ---------- */
    if (resource === 'letters') {
      if (!arg && method === 'GET') {
        return { status: 200, data: { letters: db.prepare('SELECT id, day, content, readAt, createdAt FROM letters WHERE threadId = ? ORDER BY day DESC LIMIT 14').all(threadId) } }
      }
      if (!arg && method === 'POST') {
        const day = dayKey(clock)
        const existing = db.prepare('SELECT id, day, content, readAt, createdAt FROM letters WHERE threadId = ? AND day = ?').get(threadId, day)
        if (existing) return { status: 200, data: { letter: existing, already: true } }
        const context = chatContext(threadId)
        let content = null
        const modelReply = await callModel(ctx, 'letter', 'letter:' + day + ':' + threadId,
          [{ role: 'user', content: '给用户写今天的信笺（中文，80–140字，口吻符合你的人设，用第二人称，不用列表，结尾不落款）。可以结合我们最近聊过的内容。' },
            ...context.slice(-8)],
          persona + '这是你写给用户的一封日常信笺，安静温柔，像从电台直播间寄出的手写短笺。只输出信的正文。')
        if (modelReply) content = modelReply.slice(0, 800)
        if (!content) {
          const pool = letterTemplates(threadId, bondInfo(threadId))
          content = pool[Math.floor(Math.random() * pool.length)]
        }
        const id = randomUUID()
        const saved = db.prepare('INSERT OR IGNORE INTO letters VALUES (?, ?, ?, ?, NULL, ?)').run(id, threadId, day, content, now())
        if (!saved.changes) return { status: 200, data: { letter: db.prepare('SELECT id, day, content, readAt, createdAt FROM letters WHERE threadId = ? AND day = ?').get(threadId, day), already: true } }
        return { status: 200, data: { letter: { id, day, content, readAt: null, createdAt: now() } } }
      }
      if (arg && action === 'read' && method === 'POST') {
        const target = db.prepare('SELECT id, readAt FROM letters WHERE id = ? AND threadId = ?').get(arg, threadId)
        if (!target) return { status: 404, data: {} }
        if (!target.readAt) {
          db.prepare('UPDATE letters SET readAt = ? WHERE id = ?').run(now(), arg)
          award(threadId, 2)
          analytics.record(key, 'letter_open')
        }
        return { status: 200, data: { letter: db.prepare('SELECT id, day, content, readAt, createdAt FROM letters WHERE id = ?').get(arg) } }
      }
    }

    /* ---------- 河灯许愿 ---------- */
    if (resource === 'wishes') {
      if (method === 'GET') {
        return { status: 200, data: { wishes: db.prepare('SELECT id, content, blessing, createdAt FROM wishes WHERE threadId = ? ORDER BY rowid DESC LIMIT 30').all(threadId) } }
      }
      if (method === 'POST') {
        const content = typeof body?.content === 'string' ? body.content.trim() : ''
        if (!content || Array.from(content).length > 120) return { status: 400, data: { error: '愿望需要 1–120 字' } }
        const day = dayKey(clock)
        const todayCount = count('SELECT count(*) n FROM wishes WHERE threadId = ? AND createdAt >= ?', threadId, dayStart(day))
        const id = randomUUID()
        const blessing = BLESSINGS[Math.floor(Math.random() * BLESSINGS.length)]
        db.prepare('INSERT INTO wishes VALUES (?, ?, ?, ?, ?)').run(id, threadId, content, blessing, now())
        if (todayCount < 3) award(threadId, 2) // 羁绊加分每天前 3 次许愿
        analytics.record(key, 'wish_make')
        return { status: 200, data: { wish: { id, content, blessing, createdAt: now() } } }
      }
    }

    /* ---------- 纪念日 ---------- */
    if (resource === 'anniversaries') {
      if (!arg && method === 'GET') return { status: 200, data: { anniversaries: anniversaryRows(threadId) } }
      if (!arg && method === 'POST') {
        const title = typeof body?.title === 'string' ? body.title.trim() : ''
        const date = typeof body?.date === 'string' ? body.date.trim() : ''
        const repeatYearly = body?.repeatYearly === false ? 0 : 1
        if (!title || Array.from(title).length > 24) return { status: 400, data: { error: '标题需要 1–24 字' } }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(date + 'T00:00:00+08:00').getTime())) {
          return { status: 400, data: { error: '日期需要形如 2026-12-31' } }
        }
        const id = randomUUID()
        db.prepare('INSERT INTO anniversaries VALUES (?, ?, ?, ?, ?, ?)').run(id, threadId, title, date, repeatYearly, now())
        analytics.record(key, 'anniversary_save')
        return { status: 200, data: { anniversary: anniversaryRows(threadId).find(row => row.id === id) } }
      }
      if (arg && !action && method === 'DELETE') {
        const target = db.prepare('SELECT id FROM anniversaries WHERE id = ? AND threadId = ?').get(arg, threadId)
        if (!target) return { status: 404, data: {} }
        db.prepare('DELETE FROM anniversaries WHERE id = ? AND threadId = ?').run(arg, threadId)
        return { status: 200, data: { ok: true } }
      }
    }

    /* ---------- 小礼物 ---------- */
    if (resource === 'gifts') {
      const day = dayKey(clock)
      const todayCount = () => db.prepare('SELECT count FROM gift_log WHERE threadId = ? AND day = ?').get(threadId, day)?.count ?? 0
      if (method === 'GET') {
        return { status: 200, data: { today: todayCount(), limit: 2, kinds: GIFT_KINDS.map(({ id, name }) => ({ id, name })) } }
      }
      if (method === 'POST') {
        const kind = GIFT_KINDS.find(item => item.id === body?.kind)
        if (!kind) return { status: 400, data: { error: '选一个小礼物吧' } }
        if (todayCount() >= 2) return { status: 400, data: { error: '今天的两份礼物已经送完了，明天再来。' } }
        db.prepare('INSERT INTO gift_log VALUES (?, ?, 1) ON CONFLICT(threadId, day) DO UPDATE SET count = count + 1').run(threadId, day)
        award(threadId, 8)
        analytics.record(key, 'gift_send')
        return { status: 200, data: { gift: { kind: kind.id, name: kind.name, reply: GIFT_REPLIES[kind.id] }, today: todayCount(), limit: 2 } }
      }
    }

    if (resource === 'home' && method === 'GET') {
      const day = dayKey(clock)
      const mood = db.prepare('SELECT mood FROM mood_log WHERE threadId = ? AND day = ?').get(threadId, day)
      const unread = count("SELECT count(*) n FROM letters WHERE threadId = ? AND readAt IS NULL", threadId)
      const wishesN = count('SELECT count(*) n FROM wishes WHERE threadId = ?', threadId)
      const gifts = db.prepare('SELECT count FROM gift_log WHERE threadId = ? AND day = ?').get(threadId, day)?.count ?? 0
      const days = anniversaryRows(threadId)
      const metAt = db.prepare('SELECT createdAt FROM threads WHERE id = ?').get(threadId)?.createdAt
      const metDays = metAt ? Math.max(1, Math.floor((clock().getTime() - new Date(metAt).getTime()) / 86400000) + 1) : 0
      return {
        status: 200,
        data: {
          bond: bondInfo(threadId),
          mood: { today: mood?.mood ?? null, streak: streakOf(threadId) },
          letters: { unread },
          wishes: { count: wishesN },
          anniversaries: { next: days[0] ?? null },
          gifts: { today: gifts, limit: 2 },
          met: { days: metDays },
        },
      }
    }
    return null
  }

  return { handle, award, bondInfo, callModel, chatContext, dayKey: () => dayKey(clock), moodReply }
}
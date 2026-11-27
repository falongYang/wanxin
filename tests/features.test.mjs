import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createApp } from '../server/app.mjs'
import { developmentPolicy } from '../server/access.mjs'
import { fixture } from './helpers/access-fixture.mjs'
import { makeClient } from './helpers/http-client.mjs'
import { DatabaseSync } from 'node:sqlite'

const session = async (request, characterId, inviteToken) => (await request('session', { adult: true, characterId, inviteToken })).cookie

test('羁绊积分：发消息/带卡发送/收藏累积并升级', async t => {
  const app = createApp(':memory:', async () => '合成回复', { access: developmentPolicy() })
  t.after(() => app.emit('close'))
  const request = makeClient(app)
  const cookie = await session(request)
  // 未打卡前羁绊为 0 级「初识」
  assert.deepEqual((await request('bond', null, cookie)).json(), { points: 0, level: 1, title: '初识', progress: 0, next: 100 })
  const sent = await request('messages', { requestId: 'b1', text: '第一条消息' }, cookie)
  assert.equal(sent.status, 200)
  assert.equal((await request('bond', null, cookie)).json().points, 2)
  const source = sent.json().messages.at(-2).id
  await request('cards', { sourceMessageId: source, title: '卡', body: '正文' }, cookie)
  assert.equal((await request('bond', null, cookie)).json().points, 7) // 2 + 5
  await request('messages', { requestId: 'b2', text: '接着说' }, cookie) // 普通再 +2
  assert.equal((await request('bond', null, cookie)).json().points, 9)
  const retried = await request('messages', { requestId: 'b1', text: '第一条消息' }, cookie) // 重试不重复积分
  assert.equal(retried.status, 200)
  assert.equal((await request('bond', null, cookie)).json().points, 9)
})

test('心情打卡：每日一次、角色回应、重复幂等、连续天数', async t => {
  let clock = new Date('2026-11-26T20:00:00Z')
  const app = createApp(':memory:', async () => '今晚就先到这里，我记下了。', { access: developmentPolicy(), clock: () => clock })
  t.after(() => app.emit('close'))
  const request = makeClient(app)
  const cookie = await session(request)
  const first = await request('mood', { mood: '疲惫', note: '今天开了三个会' }, cookie)
  assert.equal(first.status, 200)
  assert.equal(first.json().mood.mood, '疲惫')
  assert.equal(first.json().bond.points, 4)
  const again = await request('mood', { mood: '开心' }, cookie)
  assert.equal(again.json().already, true)
  assert.equal(again.json().mood.mood, '疲惫')
  assert.equal(again.json().bond.points, 4) // 不重复加分
  const bad = await request('mood', { mood: '不存在的心情' }, cookie)
  assert.equal(bad.status, 400)
  let state = (await request('mood', null, cookie)).json()
  assert.equal(state.today.mood, '疲惫')
  assert.equal(state.streak, 1)
  clock = new Date('2026-11-27T21:00:00Z')
  await request('mood', { mood: '平静' }, cookie)
  clock = new Date('2026-11-28T21:00:00Z')
  await request('mood', { mood: '期待' }, cookie)
  state = (await request('mood', null, cookie)).json()
  assert.equal(state.streak, 3)
})

test('玄关仪表盘聚合：羁绊/心情/空数据安全', async t => {
  const app = createApp(':memory:', async () => '合成回复', { access: developmentPolicy() })
  t.after(() => app.emit('close'))
  const request = makeClient(app)
  const cookie = await session(request)
  const home = (await request('home', null, cookie)).json()
  assert.equal(home.bond.title, '初识')
  assert.equal(home.mood.today, null)
  assert.equal(home.mood.streak, 0)
  assert.equal(home.letters.unread, 0)
  assert.equal(home.wishes.count, 0)
  assert.equal(home.anniversaries.next, null)
  assert.equal(home.gifts.today, 0)
  assert.equal(home.gifts.limit, 2)
  assert.equal(home.met.days, 1) // 新线程当天即相遇第 1 天
})

test('受控模式心情回应走 letter 网关并落账', async t => {
  const f = fixture(t)
  const { createHash } = await import('node:crypto')
  const token2 = 'f'.repeat(64)
  f.save([f.invite, { ...f.invite, tokenId: 'mood-other', subjectId: 'mood-other', digest: createHash('sha256').update(token2).digest('hex') }])
  const db = new DatabaseSync(f.env.SQLITE_PATH)
  f.after(() => db.close())
  const app = createApp(f.env.SQLITE_PATH, async () => '共情的一句回复。', { access: f.policy, clock: () => new Date('2026-11-26T00:00:00Z') })
  f.after(() => app.emit('close'))
  const request = makeClient(app)
  const cookie = await session(request, undefined, f.token)
  db.exec('UPDATE runtime_control SET callsEnabled=1')
  const done = await request('mood', { mood: '难过' }, cookie)
  assert.equal(done.status, 200)
  const attempt = db.prepare("SELECT operation, state FROM call_attempts WHERE operation='letter'").get()
  assert.equal(attempt.state, 'success')
  assert.equal(done.json().mood.reply, '共情的一句回复。')
  // 停止模型调用后，心情打卡降级为模板回应且不再新增 letter 尝试
  db.exec('UPDATE runtime_control SET callsEnabled=0')
  const other = await session(request, undefined, token2)
  const next = await request('mood', { mood: '开心' }, other)
  assert.equal(next.status, 200)
  assert.equal(db.prepare("SELECT count(*) n FROM call_attempts WHERE operation='letter'").get().n, 1)
  assert.ok(next.json().mood.reply.length > 0)
})

test('清除会话级联删除陪伴数据', async t => {
  const app = createApp(':memory:', async () => '合成回复', { access: developmentPolicy() })
  t.after(() => app.emit('close'))
  const request = makeClient(app)
  const cookie = await session(request)
  await request('mood', { mood: '开心' }, cookie)
  const db = null
  await request('session', null, cookie, 'DELETE')
  const fresh = await session(request)
  assert.equal((await request('bond', null, fresh)).json().points, 0)
  assert.equal((await request('mood', null, fresh)).json().today, null)
})
test('捏捏形象：保存/读取/形状校验/线程隔离/级联删除', async t => {
  const app = createApp(':memory:', async () => '合成回复', { access: developmentPolicy() })
  t.after(() => app.emit('close'))
  const request = makeClient(app)
  const cookie = await session(request)
  // 未保存前为空，客户端会用角色默认形象
  assert.equal((await request('avatar', null, cookie)).json().config, null)
  const saved = await request('avatar', { config: { skin: 2, hair: '卷发', accessory: '星发夹' } }, cookie, 'PUT')
  assert.equal(saved.status, 200)
  assert.deepEqual(saved.json().config, { skin: 2, hair: '卷发', accessory: '星发夹' })
  assert.deepEqual((await request('avatar', null, cookie)).json().config, { skin: 2, hair: '卷发', accessory: '星发夹' })
  // 覆盖保存
  await request('avatar', { config: { hair: '马尾' } }, cookie, 'PUT')
  assert.deepEqual((await request('avatar', null, cookie)).json().config, { hair: '马尾' })
  // 形状校验：未知字段 / 类型不符 / 空对象 / 非对象
  assert.equal((await request('avatar', { config: { nope: 1 } }, cookie, 'PUT')).status, 400)
  assert.equal((await request('avatar', { config: { skin: '浅麦' } }, cookie, 'PUT')).status, 400)
  assert.equal((await request('avatar', { config: { hair: 3 } }, cookie, 'PUT')).status, 400)
  assert.equal((await request('avatar', { config: {} }, cookie, 'PUT')).status, 400)
  assert.equal((await request('avatar', { config: '林舟' }, cookie, 'PUT')).status, 400)
  // 保存形象不增加羁绊
  assert.equal((await request('bond', null, cookie)).json().points, 0)
  // 线程隔离
  const other = await session(request)
  assert.equal((await request('avatar', null, other)).json().config, null)
  // 清除会话级联删除
  await request('session', null, cookie, 'DELETE')
  const fresh = await session(request)
  assert.equal((await request('avatar', null, fresh)).json().config, null)
})

test('捏捏形象 v2：3D 配置保存/数值截断/缺省回退/非法输入 400/旧配置共存', async t => {
  const app = createApp(':memory:', async () => '合成回复', { access: developmentPolicy() })
  t.after(() => app.emit('close'))
  const request = makeClient(app)
  const cookie = await session(request)
  const v2 = {
    version: 2,
    face: { faceWidth: -14, jawWidth: -10, jawAngle: -12, chinLength: 10, cheekBone: 6, cheekFat: -6 },
    eyes: { eyeDistance: 0, eyeHeight: 2, eyeSize: 10, eyeTilt: -6, lidCrease: 12, smileBand: 16, browHeight: 6, browSpace: 4, browCurve: 18, browThick: -6, iris: 'dark-brown' },
    nose: { bridge: 8, bridgeWidth: -8, tip: -4, ala: -6, noseLength: 6 },
    lips: { upperLip: 2, lowerLip: 6, mouthWidth: -6, corner: 22, cupidsBow: 4 },
    skin: { tone: { h: 28, s: 42, l: 86 }, blush: 34, lipTint: { h: 6, s: 42, l: 52 }, freckles: 'none' },
    hair: { style: 'wavy-mid', bangs: 'airy', color: { h: 222, s: 22, l: 15 }, length: 10, volume: 14, curl: 10, highlight: 0 },
    body: { shoulderWidth: -8, neckLength: 8, chestDepth: -6 },
    outfit: { top: 'knit-round', topColor: { h: 42, s: 24, l: 92 }, outer: 'cardigan', outerColor: { h: 30, s: 46, l: 80 } },
    accessories: ['headphones'],
  }
  const saved = await request('avatar', { config: v2 }, cookie, 'PUT')
  assert.equal(saved.status, 200)
  const stored = saved.json().config
  assert.equal(stored.version, 2)
  assert.equal(stored.face.faceWidth, -14)
  assert.equal(stored.eyes.iris, 'dark-brown')
  assert.equal(stored.outfit.outer, 'cardigan')
  assert.deepEqual(stored.accessories, ['headphones'])
  assert.deepEqual((await request('avatar', null, cookie)).json().config, stored)
  // 超范围数值截断到 ±100；非法数值回退 0；非法 ID 回退默认；配饰过滤 + 最多 3 件
  const loose = await request('avatar', {
    config: {
      ...v2,
      face: { faceWidth: 250, jawWidth: -400, jawAngle: 'x', chinLength: 10, cheekBone: 6, cheekFat: -6 },
      eyes: { ...v2.eyes, iris: 'NOT-AN-ID' },
      hair: { ...v2.hair, style: 'new-future-style' },
      accessories: ['headphones', 'bad id', 'scarf', 'ribbon', 'camera'],
    },
  }, cookie, 'PUT')
  assert.equal(loose.status, 200)
  const cleaned = loose.json().config
  assert.equal(cleaned.face.faceWidth, 100)
  assert.equal(cleaned.face.jawWidth, -100)
  assert.equal(cleaned.face.jawAngle, 0)
  assert.equal(cleaned.eyes.iris, 'dark-brown')
  assert.equal(cleaned.hair.style, 'new-future-style')
  assert.deepEqual(cleaned.accessories, ['headphones', 'scarf', 'ribbon'])
  // 分区缺失 / 非对象 → 400
  assert.equal((await request('avatar', { config: { version: 2, face: 'oops' } }, cookie, 'PUT')).status, 400)
  assert.equal((await request('avatar', { config: { version: 2 } }, cookie, 'PUT')).status, 400)
  // v1 与 v2 在不同线程共存互不影响
  const other = await session(request)
  await request('avatar', { config: { hair: '马尾' } }, other, 'PUT')
  assert.equal((await request('avatar', null, other)).json().config.hair, '马尾')
  assert.equal((await request('avatar', null, cookie)).json().config.version, 2)
})

test('v3 造型包形象：保存、校验、与 v2 共存', async t => {
  const app = createApp(':memory:', async () => '合成回复', { access: developmentPolicy() })
  t.after(() => app.emit('close'))
  const request = makeClient(app)
  const cookie = await session(request)
  // 合法 v3 保存并原样读回
  const v3 = { version: 3, characterId: 'lin-zhou', packId: 'pack1', expression: 'smile' }
  const saved = await request('avatar', { config: v3 }, cookie, 'PUT')
  assert.equal(saved.status, 200)
  assert.deepEqual(saved.json().config, v3)
  assert.deepEqual((await request('avatar', null, cookie)).json().config, v3)
  // 非法角色 / 非法包 ID / 非法表情 → 400
  assert.equal((await request('avatar', { config: { ...v3, characterId: 'nobody' } }, cookie, 'PUT')).status, 400)
  assert.equal((await request('avatar', { config: { ...v3, packId: 'not a id!' } }, cookie, 'PUT')).status, 400)
  assert.equal((await request('avatar', { config: { ...v3, expression: 'angry' } }, cookie, 'PUT')).status, 400)
  // 与 v2 在不同线程共存
  const v2thread = await session(request)
  const v2 = { version: 3, characterId: 'gu-chuan', packId: 'pack1', expression: 'calm' }
  await request('avatar', { config: v2 }, v2thread, 'PUT')
  assert.equal((await request('avatar', null, v2thread)).json().config.characterId, 'gu-chuan')
  assert.equal((await request('avatar', null, cookie)).json().config.characterId, 'lin-zhou')
})

test('生活服务：目录下发、点击落账、未知服务 404', async t => {
  const app = createApp(':memory:', async () => '合成回复', { access: developmentPolicy() })
  t.after(() => app.emit('close'))
  const request = makeClient(app)
  const cookie = await session(request)
  const catalog = (await request('services', null, cookie)).json()
  assert.ok(catalog.services.length >= 10)
  assert.ok(catalog.services.every(service => service.id && service.name && service.category && service.categoryLabel && service.scheme && service.web))
  assert.ok(catalog.services.some(service => service.id === 'meituan-food'))
  const click = await request('services/meituan-food/click', {}, cookie)
  assert.equal(click.status, 200)
  assert.equal(click.json().ok, true)
  assert.equal((await request('services/not-exist/click', {}, cookie)).status, 404)
  // 服务点击不影响羁绊
  assert.equal((await request('bond', null, cookie)).json().points, 0)
})

test('受控模式服务点击记入试用事件白名单', async t => {
  const f = fixture(t)
  const db = new DatabaseSync(f.env.SQLITE_PATH)
  f.after(() => db.close())
  const app = createApp(f.env.SQLITE_PATH, async () => '合成回复', { access: f.policy })
  f.after(() => app.emit('close'))
  const request = makeClient(app)
  const cookie = await session(request, undefined, f.token)
  await request('services/taobao/click', {}, cookie)
  assert.equal(db.prepare("SELECT count(*) n FROM trial_events WHERE event = 'service_click'").get().n, 1)
  await request('mood', { mood: '开心' }, cookie)
  assert.equal(db.prepare("SELECT count(*) n FROM trial_events WHERE event = 'mood_checkin'").get().n, 1)
})

test('分析事件白名单对旧库自动迁移扩展', async t => {
  const { randomUUID } = await import('node:crypto')
  const { DatabaseSync } = await import('node:sqlite')
  const { rmSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { tmpdir } = await import('node:os')
  const file = join(tmpdir(), 'wanxin-analytics-migrate-' + randomUUID() + '.sqlite')
  const old = new DatabaseSync(file)
  old.exec(`CREATE TABLE visitors (id TEXT PRIMARY KEY, adultConfirmedAt TEXT NOT NULL, createdAt TEXT NOT NULL);
    CREATE TABLE analytics_visitors (visitorId TEXT PRIMARY KEY REFERENCES visitors(id) ON DELETE CASCADE, analysisId TEXT NOT NULL UNIQUE);
    CREATE TABLE trial_events (analysisId TEXT NOT NULL REFERENCES analytics_visitors(analysisId) ON DELETE CASCADE,
      event TEXT NOT NULL CHECK(event IN ('send','first_send','card_preview','card_save','card_open','card_send')),
      occurredAt TEXT NOT NULL);`)
  old.close()
  t.after(() => { rmSync(file, { force: true }) })
  const app = createApp(file, async () => '合成回复', { access: developmentPolicy() })
  t.after(() => app.emit('close'))
  const request = makeClient(app)
  const cookie = await session(request)
  // 旧白名单下 mood_checkin 会被 OR IGNORE 静默丢弃；迁移后应正常入库
  await request('mood', { mood: '开心' }, cookie)
  const db = new DatabaseSync(file)
  t.after(() => db.close())
  assert.equal(db.prepare("SELECT count(*) n FROM trial_events WHERE event = 'mood_checkin'").get().n, 1)
})

test('每日信箱：生成/幂等/已读加分/隔离', async t => {
  const app = createApp(':memory:', async () => '这是写给你的第七封信：今晚的海比昨天安静。', { access: developmentPolicy() })
  t.after(() => app.emit('close'))
  const request = makeClient(app)
  const cookie = await session(request)
  const first = await request('letters', {}, cookie)
  assert.equal(first.status, 200)
  assert.equal(first.json().letter.content, '这是写给你的第七封信：今晚的海比昨天安静。')
  assert.equal(first.json().letter.readAt, null)
  const again = await request('letters', {}, cookie)
  assert.equal(again.json().already, true)
  assert.equal(again.json().letter.id, first.json().letter.id)
  // 读信 +2
  assert.equal((await request('bond', null, cookie)).json().points, 0)
  const read = await request('letters/' + first.json().letter.id + '/read', {}, cookie)
  assert.equal(read.status, 200)
  assert.ok(read.json().letter.readAt)
  assert.equal((await request('bond', null, cookie)).json().points, 2)
  // 重复读不重复加分
  await request('letters/' + first.json().letter.id + '/read', {}, cookie)
  assert.equal((await request('bond', null, cookie)).json().points, 2)
  // 列表与线程隔离
  assert.equal((await request('letters', null, cookie)).json().letters.length, 1)
  const other = await session(request)
  assert.equal((await request('letters', null, other)).json().letters.length, 0)
  assert.equal((await request('letters/' + first.json().letter.id + '/read', {}, other)).status, 404)
})

test('河灯许愿与纪念日：加分封顶/校验/倒计时/删除隔离', async t => {
  let clock = new Date('2026-11-26T20:00:00Z')
  const app = createApp(':memory:', async () => 'x', { access: developmentPolicy(), clock: () => clock })
  t.after(() => app.emit('close'))
  const request = makeClient(app)
  const cookie = await session(request)
  // 前 3 次许愿每次 +2，之后不再加分
  for (let i = 0; i < 3; i++) {
    const wish = await request('wishes', { content: '愿望' + i }, cookie)
    assert.equal(wish.status, 200)
    assert.ok(wish.json().wish.blessing.length > 0)
  }
  assert.equal((await request('bond', null, cookie)).json().points, 6)
  await request('wishes', { content: '第四个愿望' }, cookie)
  assert.equal((await request('bond', null, cookie)).json().points, 6)
  // 校验
  assert.equal((await request('wishes', { content: '' }, cookie)).status, 400)
  assert.equal((await request('wishes', { content: 'x'.repeat(121) }, cookie)).status, 400)
  assert.equal((await request('wishes', null, cookie)).json().wishes.length, 4)
  // 纪念日：倒计时与每年重复
  assert.equal((await request('anniversaries', { title: '第一次见面', date: '2026-12-01' }, cookie)).status, 200)
  const rows = (await request('anniversaries', null, cookie)).json().anniversaries
  assert.equal(rows.length, 1)
  assert.equal(rows[0].daysLeft, 4) // 上海时区 11-27 凌晨，至 12-01 剩 3 天 20 小时，四舍五入
  assert.equal(rows[0].repeatYearly, 1)
  assert.equal((await request('anniversaries', { title: '', date: '2026-12-01' }, cookie)).status, 400)
  assert.equal((await request('anniversaries', { title: 'x', date: '2026/12/01' }, cookie)).status, 400)
  assert.equal((await request('anniversaries', { title: 'x', date: '2026-13-01' }, cookie)).status, 400)
  // 删除：他人不可删
  const id = rows[0].id
  const other = await session(request)
  assert.equal((await request('anniversaries/' + id, null, other, 'DELETE')).status, 404)
  assert.equal((await request('anniversaries/' + id, null, cookie, 'DELETE')).status, 200)
  assert.equal((await request('anniversaries', null, cookie)).json().anniversaries.length, 0)
})

test('小礼物：每日两份封顶/加分/目录/跨日恢复', async t => {
  let clock = new Date('2026-11-26T20:00:00Z')
  const app = createApp(':memory:', async () => 'x', { access: developmentPolicy(), clock: () => clock })
  t.after(() => app.emit('close'))
  const request = makeClient(app)
  const cookie = await session(request)
  const catalog = (await request('gifts', null, cookie)).json()
  assert.equal(catalog.today, 0)
  assert.equal(catalog.limit, 2)
  assert.ok(catalog.kinds.length >= 4)
  const first = await request('gifts', { kind: 'cocoa' }, cookie)
  assert.equal(first.status, 200)
  assert.ok(first.json().gift.reply.length > 0)
  assert.equal(first.json().gift.name, '一杯热可可')
  assert.equal(first.json().today, 1)
  const second = await request('gifts', { kind: 'lantern' }, cookie)
  assert.equal(second.json().today, 2)
  assert.equal((await request('bond', null, cookie)).json().points, 16) // 两份 ×8
  // 当日第三份被拒，不加不减
  assert.equal((await request('gifts', { kind: 'note' }, cookie)).status, 400)
  assert.equal((await request('gifts', { kind: 'nope' }, cookie)).status, 400)
  assert.equal((await request('bond', null, cookie)).json().points, 16)
  assert.equal((await request('gifts', null, cookie)).json().today, 2)
  // 次日恢复
  clock = new Date('2026-11-27T20:00:00Z')
  assert.equal((await request('gifts', null, cookie)).json().today, 0)
})

test('受控模式信笺走 letter 网关并降级', async t => {
  const f = fixture(t)
  const db = new DatabaseSync(f.env.SQLITE_PATH)
  f.after(() => db.close())
  const app = createApp(f.env.SQLITE_PATH, async () => '今晚的信写得慢了些，海风替我磨了墨。', { access: f.policy, clock: () => new Date('2026-11-26T00:00:00Z') })
  f.after(() => app.emit('close'))
  const request = makeClient(app)
  const cookie = await session(request, undefined, f.token)
  db.exec('UPDATE runtime_control SET callsEnabled=1')
  const letter = await request('letters', {}, cookie)
  assert.equal(letter.json().letter.content, '今晚的信写得慢了些，海风替我磨了墨。')
  assert.equal(db.prepare("SELECT state FROM call_attempts WHERE operation='letter'").get().state, 'success')
  // 停写后第二个主体降级为模板信笺，不再新增 letter 尝试
  db.exec('UPDATE runtime_control SET callsEnabled=0')
  const { createHash } = await import('node:crypto')
  const token2 = 'c'.repeat(64)
  f.save([{ ...f.invite, tokenId: 'letter-other', subjectId: 'letter-other', digest: createHash('sha256').update(token2).digest('hex') }])
  const other = await session(request, undefined, token2)
  const degraded = await request('letters', {}, other)
  assert.equal(degraded.status, 200)
  assert.ok(degraded.json().letter.content.length > 0)
  assert.equal(db.prepare("SELECT count(*) n FROM call_attempts WHERE operation='letter'").get().n, 1)
})

test('朋友圈：发布/点赞/评论/角色发动态每日一次', async t => {
  const app = createApp(':memory:', async () => '角色的一条动态正文\n随想', { access: developmentPolicy() })
  t.after(() => app.emit('close'))
  const request = makeClient(app)
  const cookie = await session(request)
  // 用户发动态 +3
  const post = await request('moments', { content: '今天路过的书店还亮着灯。', moodTag: '开心' }, cookie)
  assert.equal(post.status, 200)
  assert.equal(post.json().moment.author, 'user')
  assert.equal(post.json().moment.moodTag, '开心')
  assert.equal(post.json().moment.likes, 0)
  assert.equal((await request('bond', null, cookie)).json().points, 3)
  const momentId = post.json().moment.id
  // 点赞 +1，再点取消
  const liked = await request('moments/' + momentId + '/like', {}, cookie)
  assert.equal(liked.json().moment.likes, 1)
  assert.equal((await request('bond', null, cookie)).json().points, 4)
  const unliked = await request('moments/' + momentId + '/like', {}, cookie)
  assert.equal(unliked.json().moment.likes, 0)
  assert.equal((await request('bond', null, cookie)).json().points, 4)
  // 评论 +2
  const comment = await request('moments/' + momentId + '/comment', { content: '下次带我去。' }, cookie)
  assert.equal(comment.status, 200)
  assert.equal((await request('bond', null, cookie)).json().points, 6)
  // 角色发动态（走模型替身），同日第二次幂等
  const charMoment = await request('moments/refresh', {}, cookie)
  assert.equal(charMoment.status, 200)
  assert.equal(charMoment.json().moment.author, 'character')
  assert.equal(charMoment.json().moment.moodTag, '随想')
  const again = await request('moments/refresh', {}, cookie)
  assert.equal(again.json().already, true)
  // 列表聚合评论与点赞，以及角色今日已发状态
  const feed = (await request('moments', null, cookie)).json()
  assert.equal(feed.moments.length, 2)
  assert.equal(feed.characterToday, true)
  const mine = feed.moments.find(row => row.id === momentId)
  assert.equal(mine.comments.length, 1)
  assert.equal(mine.comments[0].content, '下次带我去。')
  // 校验与格式错误
  assert.equal((await request('moments', { content: '' }, cookie)).status, 400)
  assert.equal((await request('moments/' + momentId + '/comment', { content: '' }, cookie)).status, 400)
  // 错误方法（GET refresh）不再 500，统一 404
  assert.equal((await request('moments/refresh', null, cookie)).status, 404)
})

test('朋友圈线程隔离且清除会话后为空', async t => {
  const app = createApp(':memory:', async () => '动态', { access: developmentPolicy() })
  t.after(() => app.emit('close'))
  const request = makeClient(app)
  const a = await session(request)
  const b = await session(request)
  const post = await request('moments', { content: '只属于我的动态' }, a)
  const id = post.json().moment.id
  assert.equal((await request('moments/' + id + '/like', {}, b)).status, 404)
  assert.equal((await request('moments/' + id + '/comment', { content: '随便看看' }, b)).status, 404)
  assert.equal((await request('moments', null, b)).json().moments.length, 0)
  assert.equal((await request('moments', null, b)).json().characterToday, false)
  await request('session', null, a, 'DELETE')
  assert.equal((await request('moments', null, a)).status, 403)
})

test('受控模式角色动态走 moment 网关并落账', async t => {
  const f = fixture(t)
  const db = new DatabaseSync(f.env.SQLITE_PATH)
  f.after(() => db.close())
  const app = createApp(f.env.SQLITE_PATH, async () => '今晚的海很安静。\n平静', { access: f.policy, clock: () => new Date('2026-11-26T00:00:00Z') })
  f.after(() => app.emit('close'))
  const request = makeClient(app)
  const cookie = await session(request, undefined, f.token)
  db.exec('UPDATE runtime_control SET callsEnabled=1')
  const done = await request('moments/refresh', {}, cookie)
  assert.equal(done.status, 200)
  assert.equal(done.json().moment.content, '今晚的海很安静。')
  const attempt = db.prepare("SELECT operation, state FROM call_attempts WHERE operation='moment'").get()
  assert.equal(attempt.state, 'success')
  // 停止后角色动态降级为模板
  db.exec('UPDATE runtime_control SET callsEnabled=0')
  const cookie2 = await (async () => {
    const { createHash } = await import('node:crypto')
    const token2 = 'e'.repeat(64)
    f.save([{ ...f.invite, tokenId: 'moment-other', subjectId: 'moment-other', digest: createHash('sha256').update(token2).digest('hex') }])
    return session(request, undefined, token2)
  })()
  const degraded = await request('moments/refresh', {}, cookie2)
  assert.equal(degraded.status, 200)
  assert.ok(degraded.json().moment.content.length > 0)
  assert.equal(db.prepare("SELECT count(*) n FROM call_attempts WHERE operation='moment'").get().n, 1)
})
/* ================= M4 记忆 / M2 反馈（阶段12） ================= */

test('角色记忆：提取入库、短消息跳过、重复去重、注入下一轮人设', async t => {
  const seenSystems = []
  const reply = async (messages, signal, system) => {
    seenSystems.push(system)
    return '合成回复'
  }
  reply.remember = async () => '她喜欢在下雨天听电台'
  const app = createApp(':memory:', reply, { access: developmentPolicy() })
  t.after(() => app.emit('close'))
  const request = makeClient(app)
  const cookie = await session(request)
  // 长消息 → 触发提取
  await request('messages', { requestId: 'm1', text: '我最喜欢在下雨天听电台，听着浪声写东西。' }, cookie)
  await new Promise(resolve => setImmediate(resolve))
  const memories = (await request('memories', null, cookie)).json()
  assert.equal(memories.memories.length, 1)
  assert.equal(memories.memories[0].fact, '她喜欢在下雨天听电台')
  // 相同事实再提取 → 去重
  await request('messages', { requestId: 'm2', text: '下雨天还是要听电台，这是我的小习惯。' }, cookie)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal((await request('memories', null, cookie)).json().memories.length, 1)
  // 短消息不消耗提取次数
  await request('messages', { requestId: 'm3', text: '嗯嗯' }, cookie)
  await new Promise(resolve => setImmediate(resolve))
  // 下一轮对话 system 注入了记忆
  await request('messages', { requestId: 'm4', text: '今天想聊聊别的，比如我的猫。' }, cookie)
  const lastSystem = seenSystems.at(-1)
  assert.ok(lastSystem.includes('她喜欢在下雨天听电台'), '记忆应注入人设')
  assert.ok(lastSystem.includes('关于她，你已经记得'))
})

test('角色记忆：reply 无 remember 能力时静默跳过', async t => {
  const app = createApp(':memory:', async () => '合成回复', { access: developmentPolicy() })
  t.after(() => app.emit('close'))
  const request = makeClient(app)
  const cookie = await session(request)
  await request('messages', { requestId: 'n1', text: '我养了一只叫馒头的橘猫，特别黏人。' }, cookie)
  await new Promise(resolve => setImmediate(resolve))
  const memories = (await request('memories', null, cookie)).json()
  assert.equal(memories.memories.length, 0)
})

test('用户反馈：入库、空内容 400、每日三条限流', async t => {
  const app = createApp(':memory:', async () => '合成回复', { access: developmentPolicy() })
  t.after(() => app.emit('close'))
  const request = makeClient(app)
  const cookie = await session(request)
  assert.equal((await request('feedback', { content: '希望河灯能多放几盏。' }, cookie)).status, 200)
  assert.equal((await request('feedback', { content: '  ' }, cookie)).status, 400)
  assert.equal((await request('feedback', { content: '信笺很好看。' }, cookie)).status, 200)
  assert.equal((await request('feedback', { content: '主题想再加一个紫色。' }, cookie)).status, 200)
  const limited = await request('feedback', { content: '还想说一句。' }, cookie)
  assert.equal(limited.status, 429)
})

test('每日小纸条：home 聚合携带 care 且当天幂等', async t => {
  let clock = new Date('2026-11-27T12:00:00Z')
  const app = createApp(':memory:', async (messages, signal, system) => '今晚的海把星子摇得很轻，早点休息。', { access: developmentPolicy(), clock: () => clock })
  t.after(() => app.emit('close'))
  const request = makeClient(app)
  const cookie = await session(request)
  const home1 = (await request('home', null, cookie)).json()
  assert.ok(home1.care.today.length > 0)
  const home2 = (await request('home', null, cookie)).json()
  assert.equal(home2.care.today, home1.care.today, '当天小纸条应缓存复用')
})

test('care/memory 新网关操作在受控模式下可 reserve 不再 operation_denied', async t => {
  const f = fixture(t)
  // 记忆提取为 fire-and-forget，放宽 fixture 默认的 subjectDaily/inFlight 以免网关限流掩盖断言
  const { loadPolicy } = await import('../server/access.mjs')
  f.env.ACCESS_LIMITS = JSON.stringify({ subjectDaily: 10, globalDaily: 20, subjectMinute: 10, globalMinute: 20, inFlight: 3, redeemSource: 3, redeemGlobal: 5, endpointMinute: 30, timeZone: 'Asia/Shanghai' })
  const relaxed = loadPolicy(f.env)
  const db = new DatabaseSync(f.env.SQLITE_PATH)
  f.after(() => db.close())
  const reply = async (messages, signal, system) => {
    // 简单模拟：care 返回一句话；聊天正文随消息返回
    const last = messages.at(-1)?.content ?? ''
    if (system?.includes('小纸条') || last.includes('小纸条')) return '今晚风轻，替你留了一盏灯。'
    return '好，先听你说。'
  }
  reply.remember = async () => '她喜欢在下雨天听电台写日记' // 模拟记忆提取（真实实现走 rememberSystem）
  const app = createApp(f.env.SQLITE_PATH, reply, { access: relaxed })
  f.after(() => app.emit('close'))
  db.exec('UPDATE runtime_control SET callsEnabled=1') // 受控模式默认停用模型调用，显式开启
  const request = makeClient(app)
  const cookie = await session(request, undefined, f.token)
  const home = await request('home', null, cookie)
  assert.equal(home.status, 200)
  assert.ok((home.json().care?.today ?? '').length > 0, 'care 应有内容（模型或降级）')
  await request('messages', { requestId: 'gw1', text: '我很喜欢在下雨天听电台写日记，这是我的小习惯。' }, cookie)
  // 记忆提取为 fire-and-forget 异步，轮询等待落库
  let mem = { memories: [] }
  for (let i = 0; i < 40 && mem.memories.length === 0; i++) {
    await new Promise(resolve => setImmediate(resolve))
    mem = (await request('memories', null, cookie)).json()
  }
  assert.equal(mem.memories.length, 1, '记忆应入库')
  assert.equal(mem.memories[0].fact, '她喜欢在下雨天听电台写日记')
  // 等待 fire-and-forget 记忆 promise 完全排干，避免 teardown 清理与异步收尾竞态（instance-lock ENOENT）
  await new Promise(resolve => setTimeout(resolve, 50))
})

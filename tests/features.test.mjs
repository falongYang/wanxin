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

test('朋友圈：发布/点赞/评论/角色发动态每日一次', async t => {
  const app = createApp(':memory:', async () => '角色的一条动态正文\n随想', { access: developmentPolicy() })
  t.after(() => app.emit('close'))
  const request = makeClient(app)
  const cookie = await session(request)
  // 用户发动态 +3
  const post = await request('moments', { content: '今天路过的书店还亮着灯。', moodTag: '开心' }, cookie)
  assert.equal(post.status, 200)
  assert.equal(post.json().moment.author, 'user')
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
  // 列表聚合评论与点赞
  const feed = (await request('moments', null, cookie)).json()
  assert.equal(feed.moments.length, 2)
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
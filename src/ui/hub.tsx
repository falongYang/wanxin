// 陪伴功能页面：我的（心情/羁绊）、朋友圈、生活服务、信箱、河灯愿、纪念日、捏捏形象。
// 组件自取数据；所有接口均线程级隔离。
import { useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'

export type Character = { id: string; name: string; scene: string; intro: string; opening: string; suggestions: [string, string][] }

type Api = <T>(path: string, data?: unknown, method?: string) => Promise<T>
type FeatureError = (message: string) => void

export type Bond = { points: number; level: number; title: string; progress: number; next: number | null }

const MOOD_FACE: Record<string, string> = {
  开心: '(ᗒᗨᗕ)', 平静: '(˘︶˘)', 疲惫: '(´-ω-｀)', 难过: '(;﹏;)', 焦虑: '(；′⌒`)', 生气: '(`へ´)', 期待: '(✧ω✧)', 其他: '(・_・;)',
}

function formatDay(day: string) {
  return day.replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$1年$2月$3日')
}

/* ---------- 羁绊进度条 ---------- */
export function BondBar({ bond, compact }: { bond: Bond | null; compact?: boolean }) {
  if (!bond) return null
  return <div className={'bond' + (compact ? ' compact' : '')}>
    <div className="bond-head"><span>羁绊 · {bond.title}</span><small>{bond.points} 点 · Lv.{bond.level}</small></div>
    <div className="bond-track"><i style={{ width: Math.min(100, Math.max(2, bond.progress)) + '%' }} /></div>
    {!compact && bond.next && <small className="bond-next">再 {bond.next - bond.points} 点升级</small>}
  </div>
}

/* ---------- 我的：心情打卡 + 羁绊 ---------- */
export function MeScreen({ api, onError, character, refreshHome, avatar, onEditAvatar }: {
  api: Api
  onError: FeatureError
  character: Character | null
  refreshHome?: () => void
  avatar?: ReactNode
  onEditAvatar?: () => void
}) {
  const [moodState, setMoodState] = useState<{ today: { mood: string; note: string | null; reply: string | null } | null; streak: number; moods: string[]; history: { day: string; mood: string; note: string | null }[] } | null>(null)
  const [mood, setMood] = useState('')
  const [note, setNote] = useState('')
  const [bond, setBond] = useState<Bond | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')

  const load = async () => {
    try {
      const result = await api<typeof moodState>('mood')
      setMoodState(result)
      const b = await api<Bond>('bond')
      setBond(b)
    } catch (error) { onError('暂时无法加载，请重试。') }
  }
  useEffect(() => { void load() }, [])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!mood || busy) return
    setBusy(true)
    setNotice('')
    try {
      const result = await api<{ mood: { mood: string; note: string | null; reply: string | null }, bond: Bond, already?: boolean }>('mood', { mood, note: note.trim() || undefined })
      setBond(result.bond)
      setNote('')
      await load()
      setNotice(result.already ? '今天已经打过卡了，TA记着呢。' : '打卡完成，TA回应了你。')
      refreshHome?.()
    } catch (error) {
      onError('打卡暂时失败，请重试。')
    } finally { setBusy(false) }
  }

  const today = moodState?.today
  return <section className="me">
    <header className="album-actions">
      <h1>我的夜航</h1>
    </header>
    {avatar && onEditAvatar && <button type="button" className="me-avatar" onClick={onEditAvatar}>
      {avatar}
      <span><strong>{character?.name ?? 'TA'}现在的样子</strong><small>捏一捏，给TA换套新搭配</small></span>
    </button>}
    <div className="me-grid">
      <div className="me-card">
        <h2>今日心情</h2>
        {today
          ? <div className="mood-today">
              <span className="mood-face">{MOOD_FACE[today.mood] ?? '(・_・;)'}</span>
              <strong>{today.mood}</strong>
              {today.note && <p>{today.note}</p>}
              {today.reply && <blockquote>{today.reply}</blockquote>}
            </div>
          : <form onSubmit={submit} className="mood-form">
            <div className="mood-grid">
              {(moodState?.moods ?? []).map(item => (
                <button type="button" key={item} className={'mood-item' + (mood === item ? ' active' : '')} onClick={() => setMood(item)}>
                  <span>{MOOD_FACE[item] ?? '(・_・;)'}</span>
                  <small>{item}</small>
                </button>
              ))}
            </div>
            <input aria-label="补充一句（可选）" placeholder="想多说一句？（可选）" maxLength={200} value={note}
              onChange={event => setNote(event.target.value)} />
            <button type="submit" disabled={!mood || busy}>记下今天</button>
          </form>}
        <p className="me-foot">连续打卡 <strong>{moodState?.streak ?? 0}</strong> 天{moodState?.history?.length ? ` · 最近 ${moodState.history[0].mood}` : ''}</p>
      </div>
      <div className="me-card">
        <h2>与{character?.name ?? 'TA'}的羁绊</h2>
        <BondBar bond={bond} />
        <p className="me-hint">聊天、收藏经历、打卡与互动都会让羁绊慢慢生长。</p>
      </div>
    </div>
    {notice && <p role="status">{notice}</p>}
  </section>
}
/* ---------- 朋友圈 ---------- */
type MomentComment = { id: string; momentId: string; author: 'user' | 'character'; content: string; createdAt: string }
type Moment = { id: string; author: 'user' | 'character'; content: string; moodTag: string | null; createdAt: string; likes: number; liked: 0 | 1; comments: MomentComment[] }

function momentTime(iso: string) {
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return ''
  return date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function MomentsScreen({ api, onError, character, avatar }: { api: Api; onError: FeatureError; character: Character | null; avatar?: ReactNode }) {
  const [moments, setMoments] = useState<Moment[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [commenting, setCommenting] = useState<string | null>(null)
  const [commentDraft, setCommentDraft] = useState('')

  const load = async () => {
    try { setMoments((await api<{ moments: Moment[] }>('moments')).moments) }
    catch { onError('暂时无法加载朋友圈。') }
  }
  useEffect(() => { void load() }, [])

  async function post(event: FormEvent) {
    event.preventDefault()
    const content = draft.trim()
    if (!content || busy) return
    setBusy(true)
    try {
      await api('moments', { content })
      setDraft('')
      await load()
      setNotice('已发布。')
    } catch { onError('发布失败，请重试。') } finally { setBusy(false) }
  }

  async function refreshByCharacter() {
    if (busy) return
    setBusy(true)
    try {
      const result = await api<{ already?: boolean }>('moments/refresh', {})
      if (!result.already) { await load(); setNotice(`${character?.name ?? 'TA'}发了一条新动态。`) }
      else setNotice('TA今天已经发过一条了，明天再来。')
    } catch { onError('TA暂时发不出来，稍后再试。') } finally { setBusy(false) }
  }

  async function like(moment: Moment) {
    try {
      const result = await api<{ moment: { likes: number; liked: 0 | 1 } }>('moments/' + moment.id + '/like', {})
      setMoments(previous => previous.map(item => item.id === moment.id ? { ...item, likes: result.moment.likes, liked: result.moment.liked } : item))
    } catch { onError('点赞失败。') }
  }

  async function comment(moment: Moment) {
    const content = commentDraft.trim()
    if (!content) return
    try {
      const result = await api<{ comment: MomentComment }>('moments/' + moment.id + '/comment', { content })
      setMoments(previous => previous.map(item => item.id === moment.id ? { ...item, comments: [...item.comments, result.comment] } : item))
      setCommentDraft('')
      setCommenting(null)
    } catch { onError('评论失败。') }
  }

  return <section className="moments-screen">
    <header className="album-actions"><h1>{character?.name ?? 'TA'}与我的朋友圈</h1></header>
    <div className="moments-composer">
      <form onSubmit={post}>
        <textarea aria-label="发一条动态" placeholder="此刻想留下一句…" maxLength={500} rows={2} value={draft}
          onChange={event => setDraft(event.target.value)} />
        <button type="submit" disabled={busy || !draft.trim()}>发布</button>
      </form>
      <button type="button" className="secondary" disabled={busy} onClick={() => void refreshByCharacter()}>让{character?.name ?? 'TA'}也发一条</button>
    </div>
    {notice && <p role="status">{notice}</p>}
    {!moments.length && <p className="muted moments-empty">还没有动态。留下一句，或者让TA先说。</p>}
    <ol className="moment-list">
      {moments.map(moment => <li key={moment.id} className={'moment ' + moment.author}>
        <div className="moment-head">
          {avatar && moment.author === 'character' && <span className="moment-avatar" aria-hidden="true">{avatar}</span>}
          <strong>{moment.author === 'character' ? (character?.name ?? 'TA') : '我'}</strong>
          {moment.moodTag && <small>· {moment.moodTag}</small>}
          <time>{momentTime(moment.createdAt)}</time>
        </div>
        <p className="moment-body">{moment.content}</p>
        <div className="moment-tools">
          <button type="button" className={'moment-like' + (moment.liked ? ' active' : '')} onClick={() => void like(moment)}>
            {moment.liked ? '♥' : '♡'} {moment.likes || ''}
          </button>
          <button type="button" className="secondary" onClick={() => { setCommenting(commenting === moment.id ? null : moment.id); setCommentDraft('') }}>评论</button>
        </div>
        {moment.comments.length > 0 && <ul className="moment-comments">
          {moment.comments.map(item => <li key={item.id}><strong>{item.author === 'character' ? (character?.name ?? 'TA') : '我'}</strong> {item.content}</li>)}
        </ul>}
        {commenting === moment.id && <form className="moment-comment-form" onSubmit={event => { event.preventDefault(); void comment(moment) }}>
          <input aria-label="评论内容" placeholder="想说一句…" maxLength={300} value={commentDraft}
            onChange={event => setCommentDraft(event.target.value)} />
          <button type="submit" disabled={!commentDraft.trim()}>发送</button>
        </form>}
      </li>)}
    </ol>
  </section>
}

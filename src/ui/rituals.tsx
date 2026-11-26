// 仪式互动：每日信箱、河灯许愿、纪念日倒数、小礼物。
// 全部接口均线程级隔离；信笺走受控 letter 网关并支持模板降级。
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'

export type Character = { id: string; name: string; scene: string; intro: string; opening: string; suggestions: [string, string][] }

type Api = <T>(path: string, data?: unknown, method?: string) => Promise<T>
type FeatureError = (message: string) => void

type Letter = { id: string; day: string; content: string; readAt: string | null; createdAt: string }
type Wish = { id: string; content: string; blessing: string | null; createdAt: string }
type Anniversary = { id: string; title: string; date: string; repeatYearly: 0 | 1; daysLeft: number }
type GiftKind = { id: string; name: string }

/* ---------- 每日信箱 ---------- */
function LetterBox({ api, onError, characterName }: { api: Api; onError: FeatureError; characterName: string }) {
  const [letters, setLetters] = useState<Letter[]>([])
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [opening, setOpening] = useState<string | null>(null)

  const load = async () => {
    try { setLetters((await api<{ letters: Letter[] }>('letters')).letters) }
    catch { onError('暂时无法打开信箱。') }
  }
  useEffect(() => { void load() }, [])

  async function receive() {
    if (busy) return
    setBusy(true)
    setNotice('')
    try {
      const result = await api<{ letter: Letter; already?: boolean }>('letters', {})
      setOpening(result.letter.id)
      setNotice(result.already ? '今天的信已经收到了，往上翻翻。' : `${characterName}给你写了一封信。`)
      await load()
    } catch { onError('信笺暂时没送到，稍后再试。') } finally { setBusy(false) }
  }

  async function markRead(letter: Letter) {
    setOpening(letter.id)
    if (letter.readAt) return
    try {
      await api('letters/' + letter.id + '/read', {})
      setLetters(previous => previous.map(item => item.id === letter.id ? { ...item, readAt: new Date().toISOString() } : item))
    } catch { /* 已读标记失败不阻断阅读 */ }
  }

  return <div className="me-card ritual-card">
    <h2>每日信箱</h2>
    <p className="me-hint">每天可以收一封{characterName}写的信。</p>
    <button type="button" disabled={busy} onClick={() => void receive()}>收今天的信</button>
    {notice && <p role="status">{notice}</p>}
    {letters.length > 0 && <ol className="letter-list">
      {letters.map(letter => <li key={letter.id} className={'letter' + (letter.readAt ? '' : ' unread')}>
        <button type="button" onClick={() => void markRead(letter)}>
          <small>{letter.day.replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$1年$2月$3日')}</small>
          {opening === letter.id
            ? <p className="letter-body">{letter.content}</p>
            : <span className="letter-preview">{letter.readAt ? letter.content.slice(0, 24) + (letter.content.length > 24 ? '…' : '') : '未读 · 点开这封信'}</span>}
        </button>
      </li>)}
    </ol>}
  </div>
}

/* ---------- 河灯许愿 ---------- */
function WishRiver({ api, onError }: { api: Api; onError: FeatureError }) {
  const [wishes, setWishes] = useState<Wish[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')

  const load = async () => {
    try { setWishes((await api<{ wishes: Wish[] }>('wishes')).wishes) }
    catch { onError('暂时看不到河灯。') }
  }
  useEffect(() => { void load() }, [])

  async function release(event: FormEvent) {
    event.preventDefault()
    const content = draft.trim()
    if (!content || busy) return
    setBusy(true)
    try {
      const result = await api<{ wish: Wish }>('wishes', { content })
      setWishes(previous => [result.wish, ...previous])
      setDraft('')
      setNotice('河灯放出去了。')
    } catch (error) { onError('这盏灯暂时放不出去，再试一次。') } finally { setBusy(false) }
  }

  return <div className="me-card ritual-card">
    <h2>河灯许愿</h2>
    <p className="me-hint">把心事写在灯上，放进今晚的海里。</p>
    <form onSubmit={release} className="wish-form">
      <input aria-label="愿望" maxLength={120} placeholder="今晚想许一个什么愿？" value={draft}
        onChange={event => setDraft(event.target.value)} />
      <button type="submit" disabled={busy || !draft.trim()}>放一盏</button>
    </form>
    {notice && <p role="status">{notice}</p>}
    {wishes.length > 0 && <ul className="wish-list">
      {wishes.map(wish => <li key={wish.id}>
        <span className="lantern" aria-hidden="true" />
        <span>{wish.content}{wish.blessing && <small>{wish.blessing}</small>}</span>
      </li>)}
    </ul>}
  </div>
}

/* ---------- 纪念日 ---------- */
function Anniversaries({ api, onError }: { api: Api; onError: FeatureError }) {
  const [rows, setRows] = useState<Anniversary[]>([])
  const [title, setTitle] = useState('')
  const [date, setDate] = useState('')
  const [yearly, setYearly] = useState(true)
  const [busy, setBusy] = useState(false)

  const load = async () => {
    try { setRows((await api<{ anniversaries: Anniversary[] }>('anniversaries')).anniversaries) }
    catch { onError('暂时无法加载纪念日。') }
  }
  useEffect(() => { void load() }, [])

  async function add(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      await api('anniversaries', { title: title.trim(), date, repeatYearly: yearly })
      setTitle('')
      setDate('')
      await load()
    } catch { onError('纪念日暂时没记上，请检查标题和日期。') } finally { setBusy(false) }
  }

  async function remove(id: string) {
    try { await api('anniversaries/' + id, undefined, 'DELETE'); await load() }
    catch { onError('暂时删不掉这条纪念日。') }
  }

  return <div className="me-card ritual-card">
    <h2>纪念日</h2>
    <p className="me-hint">记一个重要的日子，让TA帮你一起倒数。</p>
    <form onSubmit={add} className="anniversary-form">
      <input aria-label="纪念日标题" maxLength={24} placeholder="比如：第一次聊天" value={title}
        onChange={event => setTitle(event.target.value)} />
      <input aria-label="日期" type="date" value={date} onChange={event => setDate(event.target.value)} />
      <label className="yearly"><input type="checkbox" checked={yearly} onChange={event => setYearly(event.target.checked)} />每年重复</label>
      <button type="submit" disabled={busy || !title.trim() || !date}>记下</button>
    </form>
    {rows.length > 0 && <ul className="anniversary-list">
      {rows.map(row => <li key={row.id}>
        <span><strong>{row.title}</strong><small>{row.date}{row.repeatYearly ? ' · 每年' : ''}</small></span>
        <em>{row.daysLeft === 0 ? '就是今天' : `还有 ${row.daysLeft} 天`}</em>
        <button type="button" className="secondary" onClick={() => void remove(row.id)}>删除</button>
      </li>)}
    </ul>}
  </div>
}

/* ---------- 小礼物 ---------- */
function GiftStand({ api, onError, characterName }: { api: Api; onError: FeatureError; characterName: string }) {
  const [kinds, setKinds] = useState<GiftKind[]>([])
  const [today, setToday] = useState(0)
  const [limit, setLimit] = useState(2)
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)

  const load = async () => {
    try {
      const result = await api<{ today: number; limit: number; kinds: GiftKind[] }>('gifts')
      setKinds(result.kinds); setToday(result.today); setLimit(result.limit)
    } catch { onError('暂时拿不到礼物目录。') }
  }
  useEffect(() => { void load() }, [])

  async function send(kind: GiftKind) {
    if (busy) return
    setBusy(true)
    try {
      const result = await api<{ gift: { name: string; reply: string }; today: number }>('gifts', { kind: kind.id })
      setToday(result.today)
      setReply(result.gift.reply)
    } catch (error) { onError(error instanceof Error && error.message.includes('送完') ? '今天的两份礼物已经送完了，明天再来。' : '礼物暂时没送出去，再试一次。') }
    finally { setBusy(false) }
  }

  return <div className="me-card ritual-card">
    <h2>小礼物</h2>
    <p className="me-hint">每天可以送{characterName}两份小礼物，让TA知道你来了。</p>
    <div className="gift-kinds">
      {kinds.map(kind => <button type="button" key={kind.id} disabled={busy || today >= limit} onClick={() => void send(kind)}>{kind.name}</button>)}
    </div>
    <p className="me-foot">今天已送 {today}/{limit} 份</p>
    {reply && <blockquote className="gift-reply">{reply}</blockquote>}
  </div>
}

/* ---------- 仪式屏 ---------- */
export function RitualsScreen({ api, onError, character }: { api: Api; onError: FeatureError; character: Character | null }) {
  const name = character?.name ?? 'TA'
  return <section className="rituals-screen">
    <header className="album-actions"><h1>小小仪式</h1></header>
    <p className="services-note">信箱、河灯、纪念日与小礼物——都是你与{name}之间的记号。</p>
    <div className="me-grid">
      <LetterBox api={api} onError={onError} characterName={name} />
      <WishRiver api={api} onError={onError} />
      <GiftStand api={api} onError={onError} characterName={name} />
      <Anniversaries api={api} onError={onError} />
    </div>
  </section>
}

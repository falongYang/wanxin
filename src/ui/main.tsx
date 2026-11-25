import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { createRoot } from 'react-dom/client'
import './style.css'

type Message = {
  id: string
  role: 'user' | 'assistant'
  content: string
  requestId: string | null
  sourceCardId?: string | null
  status: 'complete' | 'pending' | 'failed'
}
type Submission = { requestId: string; text: string; sourceCardId?: string | null }
type Card = { id: string; sourceMessageId: string; title: string; body: string; createdAt: string; sourceContent?: string }
type CardDraft = Pick<Card, 'sourceMessageId' | 'title' | 'body' | 'createdAt'> & { id?: string; sourceContent: string }

class ApiError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

const suggestions = [
  ['聊聊今天', '我想说说今天发生的一件事。'],
  ['给今晚点首歌', '我想给今晚点一首歌。'],
  ['接一段电台故事', '今晚的电台有什么故事？'],
]

async function api<T>(path: string, data?: unknown, method = data === undefined ? 'GET' : 'POST'): Promise<T> {
  const response = await fetch('/api/' + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!response.ok) {
    const result = await response.json()
    throw new ApiError(response.status, result.error || '请求暂时无法完成')
  }
  return response.json() as Promise<T>
}

function App() {
  const [screen, setScreen] = useState<'loading' | 'gate' | 'discover' | 'chat' | 'cards' | 'card'>('loading')
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [failed, setFailed] = useState<Submission | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [cards, setCards] = useState<Card[]>([])
  const [cardDraft, setCardDraft] = useState<CardDraft | null>(null)
  const [reference, setReference] = useState<Card | null>(null)
  const [notice, setNotice] = useState('')
  const input = useRef<HTMLTextAreaElement>(null)
  const bottom = useRef<HTMLDivElement>(null)
  const sending = useRef(false)

  async function load() {
    setError('')
    try {
      const session = await api<{ threadId: string | null }>('session')
      setScreen(session.threadId ? 'discover' : 'gate')
    } catch {
      setError('暂时无法连接，请重试。')
    }
  }

  useEffect(() => { void load() }, [])
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'end' }) }, [messages, screen, busy])

  async function confirmAge() {
    setBusy(true)
    setError('')
    try {
      await api('session', { adult: true })
      setScreen('discover')
    } catch {
      setError('暂时无法确认，请重试。')
    } finally {
      setBusy(false)
    }
  }

  async function openChat() {
    setBusy(true)
    setError('')
    try {
      const history = await api<{ messages: Message[] }>('thread')
      const restored = history.messages
      if (failed) {
        const existing = restored.find(message => message.role === 'user' && message.requestId === failed.requestId)
        if (existing?.status === 'complete') {
          setFailed(null)
        } else if (!existing) {
          restored.push({ id: failed.requestId, role: 'user', content: failed.text, requestId: failed.requestId, status: 'failed' })
        }
      }
      setMessages(restored)
      setScreen('chat')
    } catch {
      setError('暂时无法打开聊天，请重试。')
    } finally {
      setBusy(false)
    }
  }

  async function send(submission: Submission) {
    if (sending.current) return
    sending.current = true
    setBusy(true)
    setError('')
    setFailed(null)
    setMessages(previous => previous.some(message => message.requestId === submission.requestId) ? previous : [
      ...previous,
      { id: submission.requestId, role: 'user', content: submission.text, requestId: submission.requestId, status: 'pending' },
    ])
    try {
      const result = await api<{ messages: Message[] }>('messages', submission)
      setMessages(result.messages)
      setReference(null)
    } catch (error) {
      if (submission.sourceCardId && error instanceof ApiError && error.status === 404) {
        setMessages(previous => previous.filter(message => message.id !== submission.requestId))
        setDraft(submission.text)
        setError(reference ? '经历卡已不可用，移除引用后可以继续发送。' : '经历卡已不可用，可以继续发送这条消息。')
        return
      }
      setMessages(previous => previous.map(message => message.role === 'user' && message.requestId === submission.requestId
        ? { ...message, status: 'failed' }
        : message))
      setFailed(submission)
      setError('回复暂未送达，可以重试这条消息。')
    } finally {
      setBusy(false)
      sending.current = false
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    const text = draft.trim()
    if (!text || Array.from(text).length > 1000 || failed || sending.current) return
    setDraft('')
    const sourceCardId = reference?.id
    void send({ requestId: crypto.randomUUID(), text, sourceCardId })
  }

  async function cardAction(action: () => Promise<void>) {
    setBusy(true)
    setError('')
    setNotice('')
    try { await action() } catch (error) {
      setError(error instanceof ApiError ? error.message : '操作暂时无法完成，请重试。')
    } finally { setBusy(false) }
  }

  async function showCards() {
    const result = await api<{ cards: Card[] }>('cards')
    setCards(result.cards)
    setScreen('cards')
  }

  async function previewCard(message: Message) {
    const fallback = {
      sourceMessageId: message.id,
      title: Array.from(message.content.trim()).slice(0, 24).join(''),
      body: Array.from(message.content).slice(0, 1000).join(''),
      createdAt: new Date().toISOString(),
      sourceContent: message.content,
    }
    setCardDraft(fallback)
    setScreen('card')
    try {
      const preview = await api<Pick<Card, 'title' | 'body' | 'createdAt'>>('card-preview', { sourceMessageId: message.id })
      setCardDraft({ ...fallback, ...preview })
    } catch {
      setNotice('预览生成失败，可以用原文编辑后收藏。')
    }
  }

  async function saveCard(event: FormEvent) {
    event.preventDefault()
    if (!cardDraft || busy) return
    const { id, title, body, sourceMessageId } = cardDraft
    await cardAction(async () => {
      const result = await api<{ card: Card }>(id ? 'cards/' + id : 'cards',
        { title, body, sourceMessageId }, id ? 'PATCH' : 'POST')
      setCardDraft({ ...result.card, sourceContent: result.card.sourceContent ?? '' })
      setNotice(id ? '已保存修改' : '已存入共同经历')
    })
  }

  async function clearSession() {
    if (!window.confirm('清除与林舟的聊天记录和全部共同经历？') ||
        !window.confirm('清除后无法恢复。确认清除？')) return
    await cardAction(async () => {
      await api('session', undefined, 'DELETE')
      setMessages([])
      setCards([])
      setCardDraft(null)
      setReference(null)
      setFailed(null)
      setDraft('')
      setScreen('gate')
    })
  }

  return <main className={screen === 'chat' ? 'shell chat' : 'shell discovery'}>
    {screen === 'chat' ? <>
      <header className="chat-header">
        <button type="button" disabled={busy} onClick={() => { setError(''); setScreen('discover') }}>返回</button>
        <div><strong>林舟</strong><small>AI 虚构角色</small></div>
        <button type="button" disabled={busy} onClick={() => void cardAction(showCards)}>共同经历</button>
        <details className="chat-menu"><summary>菜单</summary>
          <button type="button" disabled={busy} onClick={() => void clearSession()}>清除会话</button>
        </details>
      </header>
      <section className="history" aria-label="聊天记录">
        {messages.map(message => <div className={'bubble ' + message.role} key={message.id}>
          {message.content}
          {message.status === 'complete' && <button type="button" disabled={busy}
            onClick={() => void cardAction(() => previewCard(message))}>做成经历卡</button>}
          {message.role === 'user' && message.status !== 'complete' && message.requestId && !busy &&
            <button type="button" onClick={() => void send({ requestId: message.requestId!, text: message.content, sourceCardId: message.sourceCardId })}>重试</button>}
        </div>)}
        {busy && <p className="activity" role="status">林舟正在回复…</p>}
        <div ref={bottom} />
      </section>
      <div className="composer">
        {!messages.some(message => message.role === 'user') && <div className="suggestions">
          {suggestions.map(([label, text]) => <button key={label} type="button" onClick={() => { setDraft(text); input.current?.focus() }}>{label}</button>)}
        </div>}
        {error && <p role="alert">{error}</p>}
        {reference && <div className="reference">
          <span>引用：{reference.title}</span>
          <button type="button" disabled={busy} onClick={() => {
            setReference(null)
            if (failed?.sourceCardId) {
              setDraft(failed.text)
              setFailed(null)
            }
            setError('')
          }}>移除引用</button>
        </div>}
        <form onSubmit={submit}>
          <textarea ref={input} aria-label="消息" placeholder="说说你想聊的事" rows={2} value={draft}
            onChange={event => setDraft(Array.from(event.target.value).slice(0, 1000).join(''))} />
          <button disabled={busy || !draft.trim() || !!failed} type="submit">发送</button>
        </form>
      </div>
    </> : screen === 'cards' || screen === 'card' ? <section className="album">
      <header className="album-actions">
        <button disabled={busy} onClick={() => {
          if (screen === 'card' && cardDraft?.id) void cardAction(showCards)
          else void openChat()
        }}>{screen === 'card' && !cardDraft?.id ? '取消预览' : '返回'}</button>
        <h1>{screen === 'cards' ? '共同经历' : cardDraft?.id ? '经历卡' : '预览经历卡'}</h1>
      </header>
      {screen === 'cards' && <>
        {cards.length === 0 && <p>聊天时，选择想留下的消息做成经历卡。</p>}
        {cards.map(card => <button className="card-list-item" key={card.id} disabled={busy}
          onClick={() => void cardAction(async () => {
            const result = await api<{ card: Card }>('cards/' + card.id)
            setCardDraft({ ...result.card, sourceContent: result.card.sourceContent ?? '' })
            setScreen('card')
          })}>
          <strong>{card.title}</strong><small>{new Date(card.createdAt).toLocaleDateString('zh-CN')}</small>
          <span>{card.body}</span>
        </button>)}
      </>}
      {screen === 'card' && cardDraft && <form className="card-form" onSubmit={saveCard}>
        <small>{new Date(cardDraft.createdAt).toLocaleDateString('zh-CN')}</small>
        <label>标题<input required maxLength={60} disabled={busy} value={cardDraft.title}
          onChange={event => setCardDraft({ ...cardDraft, title: event.target.value })} /></label>
        <label>正文<textarea required maxLength={1000} rows={4} disabled={busy} value={cardDraft.body}
          onChange={event => setCardDraft({ ...cardDraft, body: event.target.value })} /></label>
        <details><summary>查看来源</summary><p>{cardDraft.sourceContent}</p></details>
        <div className="album-actions">
          <button type="submit" disabled={busy || !cardDraft.title.trim() || !cardDraft.body.trim()}>
            {cardDraft.id ? '保存修改' : '收藏'}
          </button>
          {cardDraft.id && <>
            <button type="button" disabled={busy} onClick={() => {
              setReference({ ...cardDraft, id: cardDraft.id! })
              void openChat()
            }}>从这里继续聊</button>
            <button type="button" disabled={busy} onClick={() => {
              if (!window.confirm('删除这张经历卡？')) return
              void cardAction(async () => {
                await api('cards/' + cardDraft.id, undefined, 'DELETE')
                if (reference?.id === cardDraft.id) setReference(null)
                await showCards()
              })
            }}>删除卡片</button>
          </>}
        </div>
      </form>}
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
    </section> : <>
      <div className="brand">晚信</div>
      {screen === 'loading' && (error ? <button onClick={() => void load()}>重试</button> : <p role="status">正在打开晚信…</p>)}
      {screen === 'gate' && <section className="intro">
        <h1>欢迎来到晚信</h1><p>晚信面向成年人。你将与 AI 虚构角色对话。</p>
        <button disabled={busy} onClick={() => void confirmAge()}>我已年满 18 岁</button>
      </section>}
      {screen === 'discover' && <section className="intro">
        <p className="scene">深夜电台</p><h1>林舟</h1>
        <small>AI 虚构角色</small><p>在海边值夜班的电台主播</p>
        <blockquote>今晚的节目还没开始。你想先点一首歌，还是说说今天？</blockquote>
        <button disabled={busy} onClick={() => void openChat()}>和林舟聊天</button>
      </section>}
      {error && <p role="alert">{error}</p>}
    </>}
  </main>
}

createRoot(document.getElementById('root')!).render(<App />)

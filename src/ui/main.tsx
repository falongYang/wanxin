import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { createRoot } from 'react-dom/client'
import './style.css'

type Message = {
  id: string
  role: 'user' | 'assistant'
  content: string
  requestId: string | null
  status: 'complete' | 'pending' | 'failed'
}
type Submission = { requestId: string; text: string }

const suggestions = [
  ['聊聊今天', '我想说说今天发生的一件事。'],
  ['给今晚点首歌', '我想给今晚点一首歌。'],
  ['接一段电台故事', '今晚的电台有什么故事？'],
]

async function api<T>(path: string, data?: unknown): Promise<T> {
  const response = await fetch('/api/' + path, data === undefined ? undefined : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!response.ok) throw new Error('Request failed')
  return response.json() as Promise<T>
}

function App() {
  const [screen, setScreen] = useState<'loading' | 'gate' | 'discover' | 'chat'>('loading')
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [failed, setFailed] = useState<Submission | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
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
    } catch {
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
    void send({ requestId: crypto.randomUUID(), text })
  }

  return <main className={screen === 'chat' ? 'shell chat' : 'shell discovery'}>
    {screen === 'chat' ? <>
      <header className="chat-header">
        <button type="button" disabled={busy} onClick={() => { setError(''); setScreen('discover') }}>返回</button>
        <div><strong>林舟</strong><small>AI 虚构角色</small></div>
      </header>
      <section className="history" aria-label="聊天记录">
        {messages.map(message => <div className={'bubble ' + message.role} key={message.id}>
          {message.content}
          {message.role === 'user' && message.status !== 'complete' && message.requestId && !busy &&
            <button type="button" onClick={() => void send({ requestId: message.requestId!, text: message.content })}>重试</button>}
        </div>)}
        {busy && <p className="activity" role="status">林舟正在回复…</p>}
        <div ref={bottom} />
      </section>
      <div className="composer">
        {!messages.some(message => message.role === 'user') && <div className="suggestions">
          {suggestions.map(([label, text]) => <button key={label} type="button" onClick={() => { setDraft(text); input.current?.focus() }}>{label}</button>)}
        </div>}
        {error && <p role="alert">{error}</p>}
        <form onSubmit={submit}>
          <textarea ref={input} aria-label="消息" placeholder="说说你想聊的事" rows={2} value={draft}
            onChange={event => setDraft(Array.from(event.target.value).slice(0, 1000).join(''))} />
          <button disabled={busy || !draft.trim() || !!failed} type="submit">发送</button>
        </form>
      </div>
    </> : <>
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

import { groupCards } from './card-library.js'
import { MeScreen, MomentsScreen, BondBar, type Bond } from './hub'
import { AvatarScreen, Avatar, CHARACTER_DEFAULT_AVATAR, FALLBACK_AVATAR, mergeAvatar, type AvatarConfig } from './avatar'
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
  contextCount?: number | null
  pinned?: number
  status: 'complete' | 'pending' | 'failed'
}
type Submission = { requestId: string; text: string; sourceCardId?: string | null; queuedIds?: string[] }
type QueuedMessage = { id: string; text: string }
type Card = { id: string; sourceMessageId: string; title: string; body: string; createdAt: string; sourceContent?: string }
type CardDraft = Pick<Card, 'sourceMessageId' | 'title' | 'body' | 'createdAt'> & { id?: string; sourceContent: string }
type Character = { id: string; name: string; scene: string; intro: string; opening: string; suggestions: [string, string][] }

class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly code = '', readonly retryAfter = '') { super(message) }
}

function newRequestId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('')
}

async function api<T>(path: string, data?: unknown, method = data === undefined ? 'GET' : 'POST'): Promise<T> {
  const response = await fetch('/api/' + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!response.ok) {
    const result = await response.json()
    throw new ApiError(response.status, result.error || '请求暂时无法完成', result.code, response.headers.get('Retry-After') || '')
  }
  return response.json() as Promise<T>
}

type City = { id: number; label: string; latitude: number; longitude: number }

function Weather({ city, selectCity }: { city: City | null; selectCity: (city: City | null) => void }) {
  const [name, setName] = useState('')
  const [cities, setCities] = useState<City[]>([])
  const [reading, setReading] = useState<{ cityId: number; temperature: number } | null>(null)
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    if (!city) return
    let active = true
    const params = new URLSearchParams({ latitude: String(city.latitude), longitude: String(city.longitude) })
    void api<{ temperature: number | null }>('weather/current?' + params).then(({ temperature }) => {
      if (active && temperature !== null) setReading({ cityId: city.id, temperature })
    }).catch(() => {})
    return () => { active = false }
  }, [city])

  async function findCities(event: FormEvent) {
    event.preventDefault()
    setSearching(true)
    setCities([])
    try {
      const result = await api<{ cities: City[] }>('weather/cities?' + new URLSearchParams({ name }))
      setCities(result.cities)
    } catch {
      // Weather is optional. The foyer stays usable when its provider is offline.
    } finally {
      setSearching(false)
    }
  }

  return <details className="weather">
    <summary>{city && reading?.cityId === city.id ? city.label + ' · ' + Math.round(reading.temperature) + '°C' : '选择天气城市'}</summary>
    <form onSubmit={findCities}>
      <input aria-label="城市名" value={name} maxLength={80} onChange={event => setName(event.target.value)} />
      <button disabled={searching || name.trim().length < 2}>查询城市</button>
    </form>
    {cities.map(item => <button type="button" key={item.id} onClick={() => {
      selectCity(item)
      setCities([])
    }}>{item.label}</button>)}
    {city && <button type="button" onClick={() => { selectCity(null); setReading(null) }}>清除城市</button>}
    {city && reading?.cityId === city.id && <small>数据来自 <a href="https://open-meteo.com/">Open-Meteo</a></small>}
  </details>
}

function ConversationDrawer({ messages, busy, togglePin }: {
  messages: Message[]
  busy: boolean
  togglePin: (message: Message) => void
}) {
  const drawer = useRef<HTMLDetailsElement>(null)
  const [query, setQuery] = useState('')
  const term = query.trim().toLocaleLowerCase()
  const matching = messages.filter(message => message.status === 'complete' &&
    (term ? message.content.toLocaleLowerCase().includes(term) : message.pinned))
  const entries = [...matching.filter(message => message.pinned).reverse(),
    ...matching.filter(message => !message.pinned).reverse()]

  return <details ref={drawer} className="history-drawer">
    <summary>会话抽屉</summary>
    <div className="drawer-panel">
      <input type="search" aria-label="搜索聊天记录" placeholder="搜索聊天记录" value={query}
        onChange={event => setQuery(event.target.value)} />
      {!entries.length && <p>{term ? '未找到匹配的消息。' : '置顶的消息会显示在这里。'}</p>}
      <ul aria-label={term ? '搜索结果' : '置顶消息'}>
        {entries.map(message => <li key={message.id}>
          <button type="button" onClick={() => {
            if (drawer.current) drawer.current.open = false
            const target = document.getElementById('message-' + message.id)
            target?.focus({ preventScroll: true })
            target?.scrollIntoView({ block: 'center' })
          }}>{message.content.slice(0, 100)}</button>
          <button type="button" disabled={busy} onClick={() => togglePin(message)}>
            {message.pinned ? '取消置顶' : '置顶'}
          </button>
        </li>)}
      </ul>
    </div>
  </details>
}

function ReplyActivity({ message, name = '角色' }: { message: Message; name?: string }) {
  return <details className="activity">
    <summary>回复过程</summary>
    <ol>
      <li>读取本次消息及 {message.contextCount} 条近期消息</li>
      {message.sourceCardId && <li>加入你选中的经历卡</li>}
      <li>生成并保存{name}的回复</li>
    </ol>
  </details>
}

function App() {
  const [screen, setScreen] = useState<'loading' | 'gate' | 'discover' | 'chat' | 'cards' | 'card' | 'me' | 'moments' | 'avatar'>('loading')
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [queue, setQueue] = useState<QueuedMessage[]>([])
  const [editing, setEditing] = useState<string | null>(null)
  const [city, setCity] = useState<City | null>(null)
  const [accessRequired, setAccessRequired] = useState(false)
  const [inviteToken, setInviteToken] = useState('')
  const [admissionNeeded, setAdmissionNeeded] = useState(false)
  const [weatherAvailable, setWeatherAvailable] = useState(false)
  const [characters, setCharacters] = useState<Character[]>([])
  const [character, setCharacter] = useState<Character | null>(null)
  const [pickedId, setPickedId] = useState('lin-zhou')
  const [theme, setTheme] = useState(() => new Date().getHours() >= 6 && new Date().getHours() < 12 ? 'morning' : 'night')
  const foyer = useRef<HTMLDivElement>(null)
  const [returnFromCards, setReturnFromCards] = useState<'chat' | 'discover'>('chat')
  const [failed, setFailed] = useState<Submission | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [cards, setCards] = useState<Card[]>([])
  const [cardQuery, setCardQuery] = useState('')
  const cardSearch = useRef<HTMLInputElement>(null)
  const cardReturn = useRef({ top: 0, id: '', index: 0 })
  const restoreCardList = useRef(false)
  const cardGroups = groupCards(cards, cardQuery)
  const visibleCards = cardGroups.flatMap(group => group.cards)
  const [cardDraft, setCardDraft] = useState<CardDraft | null>(null)
  const [reference, setReference] = useState<Card | null>(null)
  const [notice, setNotice] = useState('')
  const [editingCard, setEditingCard] = useState(false)
  const originalCard = useRef<CardDraft | null>(null)
  const [sourceTarget, setSourceTarget] = useState<string | null>(null)
  const [highlighted, setHighlighted] = useState<string | null>(null)
  const [messageMenu, setMessageMenu] = useState<string | null>(null)
  const menuMessage = useRef<string | null>(null)
  const restoreMessageFocus = useRef(false)
  const menuPanel = useRef<HTMLDivElement>(null)
  const menuTrigger = useRef<HTMLButtonElement | null>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const bottom = useRef<HTMLDivElement>(null)
  const sending = useRef(false)
  const [listening, setListening] = useState(false)
  const [bond, setBond] = useState<Bond | null>(null)
  const [avatarOverride, setAvatarOverride] = useState<Partial<AvatarConfig> | null>(null)
  const avatarConfig = mergeAvatar((character && CHARACTER_DEFAULT_AVATAR[character.id]) || FALLBACK_AVATAR, avatarOverride)
  useEffect(() => {
    if (screen !== 'discover' && screen !== 'me' && screen !== 'moments') return
    void api<Bond>('bond').then(setBond).catch(() => {})
  }, [screen])

  async function load() {
    setError('')
    try {
      const session = await api<{ threadId: string | null; character?: string; characters?: Character[]; weatherAvailable?: boolean; accessRequired?: boolean }>('session')
      setAccessRequired(!!session.accessRequired)
      setWeatherAvailable(!!session.weatherAvailable)
      if (session.characters?.length) {
        setCharacters(session.characters)
        const current = session.character ? session.characters.find(item => item.name === session.character) : undefined
        setCharacter(current ?? session.characters[0] ?? null)
        setPickedId(current?.id ?? 'lin-zhou')
      }
      setScreen(session.threadId ? 'discover' : 'gate')
      if (session.threadId) {
        void api<{ config: Partial<AvatarConfig> | null }>('avatar')
          .then(({ config }) => setAvatarOverride(config)).catch(() => {})
      }
    } catch {
      setError('暂时无法连接，请重试。')
    }
  }

  useEffect(() => { void load() }, [])
  useEffect(() => {
    if (screen !== 'chat') return
    if (sourceTarget) {
      const element = document.getElementById('message-' + sourceTarget)
      if (element) {
        element.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
        element.focus({ preventScroll: true })
        setHighlighted(sourceTarget)
      } else setNotice('这段来源消息暂时不在可用记录中，无法定位。')
      setSourceTarget(null)
    } else if (!highlighted) bottom.current?.scrollIntoView({ block: 'end' })
  }, [messages, screen, busy, sourceTarget])
  useEffect(() => {
    if (!highlighted) return
    const timer = window.setTimeout(() => setHighlighted(null), 3200)
    return () => window.clearTimeout(timer)
  }, [highlighted])
  useEffect(() => {
    if (screen === 'card') document.getElementById('card-heading')?.focus()
    if (screen === 'chat' && !busy && restoreMessageFocus.current && menuMessage.current) {
      document.getElementById('message-' + menuMessage.current)?.querySelector<HTMLButtonElement>('.message-trigger')?.focus()
      restoreMessageFocus.current = false
    }
  }, [screen, busy])

  useEffect(() => {
    if (screen !== 'cards' || busy || !restoreCardList.current) return
    restoreCardList.current = false
    const saved = cardReturn.current
    const target = document.getElementById('card-' + saved.id) ||
      document.getElementById('card-' + (visibleCards[Math.min(saved.index, visibleCards.length - 1)]?.id ?? ''))
    if (target) {
      target.focus({ preventScroll: true })
      window.scrollTo({ top: saved.top, behavior: 'auto' })
    } else {
      cardSearch.current?.focus({ preventScroll: true })
      window.scrollTo({ top: 0, behavior: 'auto' })
    }
  }, [screen, busy, cards, cardQuery])

  function closeMessageMenu(restoreFocus = false) {
    setMessageMenu(null)
    if (restoreFocus) menuTrigger.current?.focus()
  }

  useEffect(() => {
    if (!messageMenu) return
    menuPanel.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
    function outside(event: PointerEvent) {
      if (!menuPanel.current?.contains(event.target as Node) && !menuTrigger.current?.contains(event.target as Node)) closeMessageMenu()
    }
    function keyboard(event: KeyboardEvent) {
      if (event.key === 'Escape') { event.preventDefault(); closeMessageMenu(true) }
      if (event.key === 'Tab') closeMessageMenu()
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        menuPanel.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
      }
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', keyboard)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', keyboard)
    }
  }, [messageMenu])

  function accessError(error: unknown) {
    if (error instanceof ApiError && error.code === 'invitation_required') {
      setAccessRequired(true)
      setAdmissionNeeded(true)
    }
  }

  async function confirmAge() {
    setBusy(true)
    setError('')
    try {
      const chosen = characters.find(item => item.id === pickedId)
      const session = await api<{ weatherAvailable?: boolean; character?: string }>('session', { adult: true, inviteToken: inviteToken || undefined, characterId: chosen?.id })
      setWeatherAvailable(!!session.weatherAvailable)
      setCharacter(chosen ?? null)
      setAdmissionNeeded(false)
      setScreen('discover')
    } catch (error) {
      setError(error instanceof ApiError ? error.message : '暂时无法确认，请重试。')
    } finally {
      setInviteToken('')
      setBusy(false)
    }
  }

  async function openChat(sourceMessageId?: string) {
    closeMessageMenu()
    setBusy(true)
    setError('')
    try {
      const history = await api<{ messages: Message[] }>('thread')
      const restored = history.messages
      if (failed) {
        const existing = restored.find(message => message.role === 'user' && message.requestId === failed.requestId)
        if (existing?.status === 'complete') {
          setQueue(previous => previous.filter(item => !failed.queuedIds?.includes(item.id)))
          setFailed(null)
        } else if (!existing) {
          restored.push({ id: failed.requestId, role: 'user', content: failed.text, requestId: failed.requestId, status: 'failed' })
        }
      }
      setMessages(restored)
      setNotice('')
      setHighlighted(null)
      setSourceTarget(sourceMessageId ?? null)
      setScreen('chat')
      return true
    } catch (error) {
      accessError(error)
      setError(error instanceof ApiError ? error.message : '暂时无法打开聊天，请重试。')
      return false
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
    setHighlighted(null)
    setMessages(previous => previous.some(message => message.requestId === submission.requestId) ? previous : [
      ...previous,
      { id: submission.requestId, role: 'user', content: submission.text, requestId: submission.requestId, sourceCardId: submission.sourceCardId, status: 'pending' },
    ])
    try {
      const { queuedIds, ...payload } = submission
      const result = await api<{ messages: Message[] }>('messages', payload)
      setQueue(previous => previous.filter(item => !queuedIds?.includes(item.id)))
      setMessages(result.messages)
      setReference(null)
      setDraft(previous => previous === submission.text ? '' : previous)
    } catch (error) {
      if (submission.sourceCardId && error instanceof ApiError && error.status === 404) {
        setMessages(previous => previous.filter(message => message.id !== submission.requestId))
        if (!submission.queuedIds) setDraft(submission.text)
        setError(reference ? '经历卡已不可用，移除引用后可以继续发送。' : '经历卡已不可用，可以继续发送这条消息。')
        return
      }
      setMessages(previous => previous.map(message => message.role === 'user' && message.requestId === submission.requestId
        ? { ...message, status: 'failed' }
        : message))
      setFailed(submission)
      if (!submission.queuedIds) setDraft(submission.text)
      accessError(error)
      const retry = error instanceof ApiError && error.retryAfter ? `（请至少等待 ${error.retryAfter} 秒）` : ''
      setError(error instanceof ApiError && error.code ? error.message + retry : '回复暂未送达，可以手动重试这条消息。')
    } finally {
      setBusy(false)
      sending.current = false
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    const text = draft.trim()
    if (!text || editing || Array.from(text).length > 1000 || failed || sending.current) return
    setDraft('')
    const sourceCardId = reference?.id
    void send({ requestId: newRequestId(), text, sourceCardId })
  }

  function enqueue() {
    const text = draft.trim()
    if (!text || busy || failed) return
    const id = editing ?? newRequestId()
    setQueue(previous => editing
      ? previous.map(item => item.id === editing ? { id, text } : item)
      : [...previous, { id, text }])
    setEditing(null)
    setDraft('')
  }

  function startVoice() {
    const Ctor = (window as unknown as { SpeechRecognition?: new () => any; webkitSpeechRecognition?: new () => any })
    const Recognition = Ctor.SpeechRecognition || Ctor.webkitSpeechRecognition
    if (!Recognition) { setError('当前浏览器不支持语音输入，可以手动输入。'); return }
    setError('')
    setListening(true)
    const recognition = new Recognition()
    recognition.lang = 'zh-CN'
    recognition.interimResults = false
    recognition.maxAlternatives = 1
    recognition.onresult = (event: { results?: ArrayLike<ArrayLike<{ transcript?: string } | undefined>> }) => {
      const text = event.results?.[0]?.[0]?.transcript ?? ''
      if (text) setDraft(previous => Array.from((previous + ' ' + text).trim()).slice(0, 1000).join(''))
    }
    recognition.onerror = () => {
      setListening(false)
      setError('没有听清，可以再试一次。')
    }
    recognition.onend = () => setListening(false)
    try { recognition.start() } catch {
      setListening(false)
      setError('语音输入未能启动，可以手动输入。')
    }
  }

  function sendQueued(items: QueuedMessage[]) {
    if (!items.length || busy || failed || editing) return
    const text = items.map(item => item.text).join('\n')
    if (Array.from(text).length > 1000) {
      setError('合并后的消息超过 1000 字，请分开发送。')
      return
    }
    void send({ requestId: newRequestId(), text, sourceCardId: reference?.id, queuedIds: items.map(item => item.id) })
  }

  async function cardAction(action: () => Promise<void>) {
    setBusy(true)
    setError('')
    setNotice('')
    try { await action() } catch (error) {
      accessError(error)
      setError(error instanceof ApiError ? error.message : '操作暂时无法完成，请重试。')
    } finally { setBusy(false) }
  }

  async function showCards(restore = false) {
    const result = await api<{ cards: Card[] }>('cards')
    setCards(result.cards)
    if (!restore) cardReturn.current = { top: 0, id: '', index: 0 }
    restoreCardList.current = true
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
    setEditingCard(true)
    setCardDraft(fallback)
    setScreen('card')
    try {
      const preview = await api<Pick<Card, 'title' | 'body' | 'createdAt'>>('card-preview', { sourceMessageId: message.id })
      setCardDraft({ ...fallback, ...preview })
    } catch (error) {
      accessError(error)
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
      setEditingCard(false)
      setCards(previous => [result.card, ...previous.filter(card => card.id !== result.card.id)])
      setNotice(id ? '已保存修改' : '已存入共同经历')
    })
  }

  async function continueFromCard() {
    if (!cardDraft?.id) return
    await cardAction(async () => {
      const result = await api<{ card: Card }>('cards/' + cardDraft.id)
      if (await openChat()) {
        setReference(result.card)
        input.current?.focus()
      }
    })
  }

  async function leaveCard() {
    if (screen === 'card' && cardDraft?.id) await cardAction(() => showCards(true))
    else if (screen === 'cards' && returnFromCards === 'discover') setScreen('discover')
    else {
      restoreMessageFocus.current = screen === 'card'
      if (await openChat()) setCardDraft(null)
    }
  }

  async function clearSession() {
    if (!window.confirm(`清除与${character?.name ?? '角色'}的聊天记录和全部共同经历？`) ||
        !window.confirm('清除后无法恢复。确认清除？')) return
    await cardAction(async () => {
      await api('session', undefined, 'DELETE')
      setMessages([])
      setCards([])
      setCardQuery('')
      cardReturn.current = { top: 0, id: '', index: 0 }
      restoreCardList.current = false
      setCardDraft(null)
      setReference(null)
      setFailed(null)
      setDraft('')
      setQueue([])
      setEditing(null)
      setCity(null)
      setScreen('gate')
    })
  }

  async function togglePin(message: Message) {
    if (busy || sending.current) return
    setBusy(true)
    setError('')
    try {
      const result = await api<{ messages: Message[] }>('pins/' + message.id, undefined, message.pinned ? 'DELETE' : 'PUT')
      const updated = result.messages.find(item => item.id === message.id)
      setMessages(previous => previous.map(item => item.id === message.id ? { ...item, pinned: updated?.pinned } : item))
    } catch (error) {
      accessError(error)
      setError(error instanceof ApiError ? error.message : '暂时无法更新置顶，请重试。')
    } finally {
      setBusy(false)
    }
  }

  const showAdmission = admissionNeeded && screen !== 'gate'
  return <main data-theme={theme} className={screen === 'chat' ? 'shell chat' : 'shell discovery'}>
    {screen === 'chat' ? <>
      <header className="chat-header">
        <button type="button" disabled={busy} onClick={() => { setError(''); setScreen('discover') }}>返回</button>
        <div className="chat-who"><Avatar config={avatarConfig} size={38} /><span><strong>{character?.name ?? '角色'}</strong><small>AI 虚构角色</small></span></div>
        <button type="button" disabled={busy} onClick={() => { setReturnFromCards('chat'); void cardAction(showCards) }}>共同经历</button>
        <details className="chat-menu"><summary>菜单</summary>
          <button type="button" disabled={busy} onClick={() => void clearSession()}>清除会话</button>
        </details>
      </header>
      <section className="history" aria-label="聊天记录"><p className="history-intro">{character?.scene ?? '深夜 · 想说的话，这里都听得到'}</p>
        <ConversationDrawer messages={messages} busy={busy} togglePin={message => void togglePin(message)} />
        {messages.map(message => <div id={'message-' + message.id} tabIndex={-1} className={'bubble ' + message.role + (highlighted === message.id ? ' source-highlight' : '')} key={message.id}>
          {message.content}
          {message.contextCount != null && <ReplyActivity message={message} name={character?.name} />}
          {message.role === 'user' && message.status === 'complete' && <div className="message-tools">
            <button type="button" className="message-trigger" aria-label="消息操作" aria-haspopup="menu"
              aria-expanded={messageMenu === message.id} aria-controls={messageMenu === message.id ? 'message-menu' : undefined}
              disabled={busy} onClick={event => {
                menuMessage.current = message.id
                menuTrigger.current = event.currentTarget
                setMessageMenu(messageMenu === message.id ? null : message.id)
              }}>···</button>
            {messageMenu === message.id && <div className="message-popover" id="message-menu" role="menu" aria-label="消息操作" ref={menuPanel}>
              <button type="button" role="menuitem" onClick={() => {
                closeMessageMenu()
                void cardAction(() => previewCard(message))
              }}>做成经历卡</button>
            </div>}
          </div>}
          {message.role === 'user' && message.status !== 'complete' && message.requestId && !busy &&
            <button type="button" onClick={() => void send(failed?.requestId === message.requestId ? failed : { requestId: message.requestId!, text: message.content, sourceCardId: message.sourceCardId })}>重试</button>}
        </div>)}
        {(busy || failed || messages.at(-1)?.role === 'assistant') &&
          <p role="status" className="chat-status">{busy ? '正在处理' : failed ? '回复失败' : '回复已收到'}</p>}
        <div ref={bottom} />
      </section>
      <div className="composer">
        {!messages.some(message => message.role === 'user') && <div className="suggestions">
          {(character?.suggestions ?? []).map(([label, text]) => <button key={label} type="button" onClick={() => { setDraft(text); input.current?.focus() }}>{label}</button>)}
        </div>}
        {error && <p role="alert">{error}</p>}
      {showAdmission && <button type="button" onClick={() => setScreen('gate')}>重新确认邀请</button>}
        {notice && <p role="status">{notice}</p>}
        {reference && <div className="reference">
          <span>引用：{reference.title}</span>
          <button type="button" disabled={busy} onClick={() => {
            setReference(null)
            if (failed?.sourceCardId) {
              if (!failed.queuedIds) setDraft(failed.text)
              setFailed(null)
            }
            setError('')
          }}>移除引用</button>
        </div>}
        {queue.length > 0 && <section className="queue" aria-label="待发碎语">
          <small>待发碎语 · 刷新页面会清空</small>
          <ul>{queue.map(item => <li key={item.id}>
            <span>{item.text}</span>
            <button disabled={busy || !!failed || !!editing} onClick={() => sendQueued([item])}>发送</button>
            <button disabled={busy || !!failed || !!editing || !!draft.trim()} onClick={() => {
              setEditing(item.id)
              setDraft(item.text)
              input.current?.focus()
            }}>编辑</button>
            <button disabled={busy || !!failed || !!editing} onClick={() => setQueue(previous => previous.filter(entry => entry.id !== item.id))}>删除</button>
          </li>)}</ul>
          {queue.length > 1 && <button disabled={busy || !!failed || !!editing} onClick={() => sendQueued(queue)}>合并发送</button>}
        </section>}
        <form onSubmit={submit}>
          <textarea ref={input} aria-label="消息" placeholder="说说你想聊的事" rows={2} value={draft}
            onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) {
                event.preventDefault()
                enqueue()
              }
            }}
            onChange={event => setDraft(Array.from(event.target.value).slice(0, 1000).join(''))} />
          <button type="button" className="voice" disabled={busy || listening} onClick={startVoice}
            aria-label="语音输入">{listening ? '正在听…' : '语音'}</button>
          <button disabled={busy || !draft.trim() || !!failed} type="button" onClick={enqueue}>{editing ? '保存' : '待发'}</button>
          {editing
            ? <button type="button" onClick={() => { setEditing(null); setDraft('') }}>取消</button>
            : <button disabled={busy || !draft.trim() || !!failed} type="submit">发送</button>}
        </form>
      </div>
    </> : screen === 'cards' || screen === 'card' ? <section className="album">
      <header className="album-actions">
        <button className="secondary" disabled={busy} onClick={() => void leaveCard()}>{screen === 'card' && !cardDraft?.id ? '取消预览' : '返回'}</button>
        <h1 id="card-heading" tabIndex={-1}>{screen === 'cards' ? '共同经历' : cardDraft?.id ? '经历卡' : '预览经历卡'}</h1>
      </header>
      {screen === 'cards' && <>
        <div className="card-search">
          <label htmlFor="card-search">寻找一个片段</label>
          <div><input id="card-search" ref={cardSearch} type="search" autoComplete="off" disabled={busy}
            value={cardQuery} placeholder="搜索标题或正文" onChange={event => setCardQuery(event.target.value)} />
            {cardQuery.length > 0 && <button className="secondary" type="button" disabled={busy} onClick={() => {
              setCardQuery('')
              cardSearch.current?.focus()
            }}>清空搜索</button>}
          </div>
        </div>
        <p className="card-count" role="status">{cardQuery.trim() ? `找到 ${visibleCards.length} 段共同经历` : `共 ${cards.length} 段共同经历`}</p>
        {cards.length === 0 && <p className="muted">这里会收好你与{character?.name ?? '角色'}的片段。<br />回到聊天，选择想留下的消息做成经历卡。</p>}
        {cards.length > 0 && visibleCards.length === 0 && <p className="muted">没有找到这个片段，换个关键词或清空搜索试试。</p>}
        {cardGroups.map(group => <section className="card-month" aria-label={group.label} key={group.key}>
          <h2>{group.label}<small>{group.cards.length} 段</small></h2>
          <div className="lantern-river">
          {group.cards.map(card => <button className="card-list-item" id={'card-' + card.id} key={card.id} disabled={busy}
            onClick={() => {
              cardReturn.current = { top: window.scrollY, id: card.id, index: visibleCards.findIndex(item => item.id === card.id) }
              restoreCardList.current = true // Also restore focus if the detail request fails.
              void cardAction(async () => {
                const result = await api<{ card: Card }>('cards/' + card.id)
                setCardDraft({ ...result.card, sourceContent: result.card.sourceContent ?? '' })
                setEditingCard(false)
                setScreen('card')
                window.scrollTo({ top: 0, behavior: 'auto' })
              })
            }}>
            <strong><span className="lantern" aria-hidden="true" />{card.title}</strong><small>{Number.isFinite(Date.parse(card.createdAt)) ? new Date(card.createdAt).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '日期未知'}</small>
            <span>{card.body}</span>
          </button>)}
          </div>
        </section>)}
      </>}
      {screen === 'card' && cardDraft && <form className="card-form" onSubmit={saveCard}>
        <small><span className="lantern" aria-hidden="true" />{new Date(cardDraft.createdAt).toLocaleDateString('zh-CN')}</small>
        {editingCard ? <><label>标题<input required maxLength={60} disabled={busy} value={cardDraft.title}
          onChange={event => setCardDraft({ ...cardDraft, title: event.target.value })} /></label>
        <label>正文<textarea required maxLength={1000} rows={4} disabled={busy} value={cardDraft.body}
          onChange={event => setCardDraft({ ...cardDraft, body: event.target.value })} /></label>
        </> : <><p className="scene">与你 · 共同经历</p><h2>{cardDraft.title}</h2><p className="letter-body">{cardDraft.body}</p></>}
        <details><summary>来源原文</summary><p>{cardDraft.sourceContent || '来源原文暂不可用。'}</p></details>
        <div className="album-actions">
          {editingCard && <button type="submit" disabled={busy || !cardDraft.title.trim() || !cardDraft.body.trim()}>
            {cardDraft.id ? '保存修改' : '收藏'}
          </button>}
          {editingCard && cardDraft.id && <button type="button" className="secondary" disabled={busy} onClick={() => {
            setCardDraft(originalCard.current)
            setEditingCard(false)
          }}>取消修改</button>}
          {!editingCard && <button type="button" className="secondary" disabled={busy} onClick={() => void openChat(cardDraft.sourceMessageId)}>查看来源</button>}
          {!editingCard && cardDraft.id && <button type="button" className="secondary" disabled={busy} onClick={() => {
            originalCard.current = { ...cardDraft }
            setEditingCard(true)
            window.requestAnimationFrame(() => document.querySelector<HTMLInputElement>('.card-form input')?.focus())
          }}>编辑</button>}
          {cardDraft.id && !editingCard && <>
            <button type="button" disabled={busy} onClick={() => void continueFromCard()}>从这里继续聊</button>
            <button type="button" className="secondary" disabled={busy} onClick={() => {
              if (!window.confirm('删除这张经历卡？')) return
              void cardAction(async () => {
                await api('cards/' + cardDraft.id, undefined, 'DELETE')
                if (reference?.id === cardDraft.id) setReference(null)
                setCards(previous => previous.filter(card => card.id !== cardDraft.id))
                setCardDraft(null)
                restoreCardList.current = true
                setScreen('cards')
                await showCards(true)
              })
            }}>删除卡片</button>
          </>}
        </div>
      </form>}
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
      {showAdmission && <button type="button" onClick={() => setScreen('gate')}>重新确认邀请</button>}
    </section> : <>
      <div className="brand">晚信<small>把今晚，慢慢说给我听</small></div>
      {screen === 'loading' && (error ? <button onClick={() => void load()}>重试</button> : <p role="status">正在打开晚信…</p>)}
      {screen === 'gate' && <section className="intro">
        <h1>欢迎来到晚信</h1><p>晚信面向成年人。你将与 AI 虚构角色对话。</p>
        {characters.length > 0 && <fieldset className="character-pick">
          <legend>选择今晚想见的人</legend>
          {characters.map(item => <label key={item.id} className={'character-option' + (pickedId === item.id ? ' active' : '')}>
            <input type="radio" name="character" checked={pickedId === item.id} onChange={() => setPickedId(item.id)} />
            <strong>{item.name}</strong><span>{item.scene}</span>
          </label>)}
        </fieldset>}
        {accessRequired && <label className="invite-input">邀请码<input type="password" aria-label="邀请码" autoComplete="off" maxLength={256}
          value={inviteToken} onChange={event => setInviteToken(event.target.value)} /></label>}
        {accessRequired && <p className="footnote">邀请码仅可兑换一次。清除会话或丢失浏览器身份后，请联系邀请人补发。</p>}
        <button disabled={busy || (accessRequired && !inviteToken.trim())} onClick={() => void confirmAge()}>我已年满 18 岁</button>
      </section>}
      {screen === 'discover' && <section className="intro">
        <div className="foyer-heading">
          <p>{new Date().getHours() < 6 ? '夜深了' : new Date().getHours() < 12 ? '早上好' : new Date().getHours() < 18 ? '下午好' : '晚上好'}</p>
          <button onClick={() => setTheme(theme === 'night' ? 'morning' : 'night')}>{theme === 'night' ? '晨间主题' : '夜海主题'}</button>
        </div>
        {weatherAvailable && <Weather city={city} selectCity={setCity} />}
        <div className="foyer" ref={foyer}>
          <article>
            <div className="radio-scene" aria-hidden="true"><span>{character?.scene ?? '深夜 · 晚信'}</span></div>
            <div className="foyer-avatar" aria-hidden="true"><Avatar config={avatarConfig} size={104} glow /></div>
            <p className="scene">{character?.scene?.split('·')[0].trim() ?? '深夜'}</p><h1>{character?.name ?? '角色'}</h1>
            <small>AI 虚构角色</small><p>{character?.intro ?? ''}</p>
            <blockquote>{character?.opening ?? ''}</blockquote>
            <BondBar bond={bond} compact />
            <button disabled={busy} onClick={() => void openChat()}>和{character?.name ?? '角色'}聊天</button>
          </article>
          <article>
            <h2>共同经历</h2><p>回看你和{character?.name ?? '角色'}留下的故事。</p>
            <button disabled={busy} onClick={() => { setReturnFromCards('discover'); void cardAction(showCards) }}>打开共同经历</button>
          </article>
        </div>
        <nav className="foyer-heading" aria-label="切换玄关卡片">
          {['深夜电台', '共同经历'].map((label, index) => <button key={label} onClick={() => {
            const panel = foyer.current
            if (panel) panel.scrollLeft = panel.clientWidth * index
          }}>{label}</button>)}
        </nav>
      </section>}
      {screen === 'me' && <MeScreen api={api} onError={message => setError(message)} character={character} refreshHome={() => {}} avatar={<Avatar config={avatarConfig} size={72} glow />} onEditAvatar={() => { setError(''); setScreen('avatar') }} />}
      {screen === 'moments' && <MomentsScreen api={api} onError={message => setError(message)} character={character} avatar={<Avatar config={avatarConfig} size={34} />} />}
      {screen === 'avatar' && <AvatarScreen api={api} onError={message => setError(message)} characterId={character?.id} characterName={character?.name ?? 'TA'} onSaved={config => setAvatarOverride(config)} onClose={() => { setError(''); setScreen('me') }} />}
      {(screen === 'discover' || screen === 'me' || screen === 'moments' || screen === 'avatar') && <nav className="tabbar" aria-label="主导航">
        <button type="button" className={screen === 'discover' ? 'active' : ''} onClick={() => { setError(''); setScreen('discover') }}>玄关</button>
        <button type="button" className={screen === 'moments' ? 'active' : ''} onClick={() => { setError(''); setScreen('moments') }}>朋友圈</button>
        <button type="button" className={screen === 'me' || screen === 'avatar' ? 'active' : ''} onClick={() => { setError(''); setScreen('me') }}>我的</button>
      </nav>}
      {error && <p role="alert">{error}</p>}
      {showAdmission && <button type="button" onClick={() => setScreen('gate')}>重新确认邀请</button>}
    </>}
  </main>
}

createRoot(document.getElementById('root')!).render(<App />)

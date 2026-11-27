// 造型小屋：2.5D 插画形象系统（S11 · 造型包体系）
// 形象 = AI 插画立绘整图（观感=设计稿）+ Layer2D 动效（眨眼/呼吸/视差/说话）。
// v1 SVG 头像保留为素材加载失败时的降级渲染。
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  CHARACTER_PACKS, decodeShareV3, defaultConfigV3, encodeShareV3, expressionFrame,
  isCharacterId, coerceV3, migrateToV3,
  type AvatarConfigV3, type CharacterId,
} from './avatar-packs'
import { Layer2D, renderPackSnapshot, type AtmosphereKey } from './avatar2d'

/* ========================================================================
 * 第一部分：SVG 降级头像（v1，素材加载失败时的兜底渲染）
 * ======================================================================== */
export type AvatarConfig = {
  skin: number
  hair: string
  hairColor: number
  eyes: string
  mouth: string
  blush: string
  outfit: string
  outfitColor: number
  accessory: string
}

const SKIN = ['#f6dcc4', '#f0c8a8', '#d8a97e']
const HAIR = ['#2c2c34', '#4a3728', '#a8763e', '#7a5230', '#5b4b6e', '#8d8a96']
const OUTFIT = ['#1d2c4e', '#4d3654', '#2f4a3e', '#6e4a2f', '#7a3040', '#3a3f52']

const HAIR_SHAPES: Record<string, { back: string; front: string }> = {
  长直发: {
    back: 'M26,48 C22,92 30,98 50,98 C70,98 78,92 74,48 L74,44 C74,20 62,14 50,14 C38,14 26,20 26,44 Z',
    front: 'M26,46 C26,26 36,16 50,16 C64,16 74,26 74,46 C74,36 66,30 50,30 C34,30 26,36 26,46 Z',
  },
  短发: {
    back: 'M28,52 C26,66 32,72 50,72 C68,72 74,66 72,52 L72,44 C72,20 62,14 50,14 C38,14 28,20 28,44 Z',
    front: 'M28,46 C28,26 38,16 50,16 C62,16 72,26 72,46 C70,38 64,34 58,33 L54,40 L46,32 L38,36 C33,38 29,40 28,46 Z',
  },
  卷发: {
    back: 'M26,50 C20,74 26,94 50,94 C74,94 80,74 74,50 C76,20 62,10 50,10 C38,10 24,20 26,50 Z',
    front: 'M27,46 C25,24 38,14 50,14 C62,14 75,24 73,46 C70,36 64,32 58,36 C56,30 50,28 46,33 C42,28 34,32 31,38 C29,40 27,42 27,46 Z',
  },
  马尾: {
    back: 'M28,52 C27,72 34,78 50,78 C66,78 73,72 72,52 L72,44 C72,20 62,14 50,14 C38,14 28,20 28,44 Z M70,40 C82,38 88,52 84,68 C82,76 74,78 72,72 C78,60 76,48 70,46 Z',
    front: 'M28,48 C28,26 38,16 50,16 C62,16 72,26 72,48 C70,36 62,32 50,32 C38,32 30,36 28,48 Z',
  },
}

function Eyes({ kind }: { kind: string }) {
  if (kind === '弯月') return <g stroke="#3a3630" strokeWidth="2.4" fill="none" strokeLinecap="round">
    <path d="M36,54 Q40,50 44,54" /><path d="M56,54 Q60,50 64,54" />
  </g>
  if (kind === '星星') return <g fill="#3a3630">
    <path d="M40,48 l1.8,3.4 3.8,.5 -2.8,2.6 .7,3.8 -3.5,-1.9 -3.5,1.9 .7,-3.8 -2.8,-2.6 3.8,-.5 Z" />
    <path d="M60,48 l1.8,3.4 3.8,.5 -2.8,2.6 .7,3.8 -3.5,-1.9 -3.5,1.9 .7,-3.8 -2.8,-2.6 3.8,-.5 Z" />
  </g>
  if (kind === '困困') return <g stroke="#3a3630" strokeWidth="2.4" fill="none" strokeLinecap="round">
    <path d="M36,54 h8" /><path d="M56,54 h8" /><path d="M40,60 q2,2 4,0" />
  </g>
  return <g>
    <circle cx="40" cy="53" r="3.2" fill="#3a3630" /><circle cx="61" cy="53" r="3.2" fill="#3a3630" />
    <circle cx="41.2" cy="51.8" r="1" fill="#fff" /><circle cx="62.2" cy="51.8" r="1" fill="#fff" />
  </g>
}

function Mouth({ kind }: { kind: string }) {
  if (kind === '小圆') return <ellipse cx="50" cy="66" rx="3.2" ry="4" fill="#b06a5e" />
  if (kind === '平直') return <path d="M45,65 h10" stroke="#8d5a4e" strokeWidth="2" strokeLinecap="round" fill="none" />
  if (kind === '猫嘴') return <path d="M46,64 q2,3 4,0 q2,3 4,0" stroke="#8d5a4e" strokeWidth="1.8" fill="none" strokeLinecap="round" />
  return <path d="M44,64 q6,6 12,0" stroke="#8d5a4e" strokeWidth="2.2" fill="none" strokeLinecap="round" />
}

function Outfit({ kind, color }: { kind: string; color: string }) {
  const shoulders = <path d="M18,100 C20,82 34,76 50,76 C66,76 80,82 82,100 Z" fill={color} />
  if (kind === '衬衫') return <g>{shoulders}<path d="M42,78 L50,86 L58,78 L54,76 L50,80 L46,76 Z" fill="#f4ede0" /></g>
  if (kind === '围巾') return <g>{shoulders}<path d="M32,78 C38,84 62,84 68,78 L68,86 C62,92 38,92 32,86 Z" fill="#d9bc84" /><path d="M58,86 l4,12 8,-6 -2,-9 Z" fill="#d9bc84" /></g>
  if (kind === '连帽') return <g><path d="M30,78 C34,62 66,62 70,78 Z" fill={color} opacity=".6" />{shoulders}<path d="M44,86 h12" stroke="#f4ede0" strokeWidth="1.6" /><circle cx="46" cy="92" r="1.4" fill="#f4ede0" /><circle cx="54" cy="92" r="1.4" fill="#f4ede0" /></g>
  return <g>{shoulders}<path d="M42,77 q8,10 16,0" stroke="#00000022" strokeWidth="2" fill="none" />{shoulders}</g>
}

function Accessory({ kind }: { kind: string }) {
  if (kind === '星发夹') return <path d="M66,26 l2,3.6 4,.6 -3,2.8 .8,4 -3.8,-2 -3.8,2 .8,-4 -3,-2.8 4,-.6 Z" fill="#f0c56a" stroke="#b98f56" strokeWidth=".6" />
  if (kind === '耳钉') return <g><circle cx="25" cy="56" r="1.8" fill="#f0c56a" /><circle cx="75" cy="56" r="1.8" fill="#f0c56a" /></g>
  if (kind === '圆眼镜') return <g fill="none" stroke="#4a443a" strokeWidth="1.6">
    <circle cx="40" cy="53" r="7.5" /><circle cx="60" cy="53" r="7.5" /><path d="M47.5,53 h5" />
  </g>
  if (kind === '缎带') return <g fill="#e88a9a"><path d="M30,22 l8,-3 -2,8 -6,-5 Z" /><path d="M30,22 l-8,3 5,6 3,-9 Z" /><circle cx="30.5" cy="23" r="2" /></g>
  return null
}

export function Avatar({ config, size = 64, glow }: { config: AvatarConfig; size?: number; glow?: boolean }) {
  const hair = HAIR[config.hairColor % HAIR.length]
  const shape = HAIR_SHAPES[config.hair] ?? HAIR_SHAPES.长直发
  const blushOpacity = config.blush === '浅浅' ? .28 : config.blush === '绯红' ? .5 : 0
  return <svg className={'avatar' + (glow ? ' glow' : '')} width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
    <path d={shape.back} fill={hair} />
    <ellipse cx="50" cy="54" rx="25" ry="26" fill={SKIN[config.skin % SKIN.length]} />
    <circle cx="25" cy="56" r="4" fill={SKIN[config.skin % SKIN.length]} />
    <circle cx="75" cy="56" r="4" fill={SKIN[config.skin % SKIN.length]} />
    {blushOpacity > 0 && <g fill="#f4a9a0" opacity={blushOpacity}>
      <ellipse cx="35" cy="61" rx="4.5" ry="2.6" /><ellipse cx="65" cy="61" rx="4.5" ry="2.6" />
    </g>}
    <Eyes kind={config.eyes} />
    <Mouth kind={config.mouth} />
    <Outfit kind={config.outfit} color={OUTFIT[config.outfitColor % OUTFIT.length]} />
    <path d={shape.front} fill={hair} />
    <Accessory kind={config.accessory} />
  </svg>
}

export const CHARACTER_DEFAULT_AVATAR: Record<string, AvatarConfig> = {
  'lin-zhou': { skin: 0, hair: '卷发', hairColor: 0, eyes: '弯月', mouth: '微笑', blush: '浅浅', outfit: '围巾', outfitColor: 0, accessory: '无' },
  'gu-chuan': { skin: 0, hair: '短发', hairColor: 0, eyes: '圆眼', mouth: '平直', blush: '无', outfit: '衬衫', outfitColor: 3, accessory: '圆眼镜' },
  'su-mian': { skin: 0, hair: '长直发', hairColor: 0, eyes: '星星', mouth: '猫嘴', blush: '浅浅', outfit: '连帽', outfitColor: 0, accessory: '星发夹' },
}
export const FALLBACK_AVATAR: AvatarConfig = CHARACTER_DEFAULT_AVATAR['lin-zhou']
  ?? { skin: 0, hair: '长直发', hairColor: 0, eyes: '圆眼', mouth: '微笑', blush: '浅浅', outfit: '围巾', outfitColor: 0, accessory: '无' }

/* ========================================================================
 * 第二部分：Layer2D 挂载组件
 * ======================================================================== */

export interface LiveStageProps {
  characterId: string
  config: AvatarConfigV3
  atmosphere?: AtmosphereKey
  talking?: boolean
  parallax?: number
  className?: string
  frameFill?: boolean
}

/** 挂载 Layer2D：大预览（造型小屋）与小头像（聊天头部）共用 */
export function LiveStage({ characterId, config, atmosphere = 'night', talking = false, parallax = 8, className = '', frameFill = false }: LiveStageProps) {
  const holder = useRef<HTMLDivElement>(null)
  const engineRef = useRef<Layer2D | null>(null)
  const [, force] = useState(0)
  useEffect(() => {
    if (!holder.current || !isCharacterId(characterId)) return
    const pack = CHARACTER_PACKS[characterId].find(p => p.id === config.packId) ?? CHARACTER_PACKS[characterId][0]
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    const engine = new Layer2D(holder.current, { pack, config, atmosphere, reducedMotion: reduced, parallax })
    engineRef.current = engine
    force(n => n + 1)
    return () => { engine.dispose(); engineRef.current = null }
    // pack/config 以 setExpression/setTalking 按需同步，避免整树重挂
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characterId])
  useEffect(() => { engineRef.current?.setExpression(config) }, [config])
  useEffect(() => { engineRef.current?.setTalking(talking) }, [talking])
  useEffect(() => { engineRef.current?.setAtmosphere(atmosphere) }, [atmosphere])
  return <div ref={holder} className={'av25-holder ' + (frameFill ? 'av25-fill' : '') + (className ? ' ' + className : '')} />
}

/* ========================================================================
 * 第三部分：造型小屋（捏捏页 v3）
 * ======================================================================== */

interface Api {
  <T>(path: string, data?: unknown, method?: string): Promise<T>
}

export function AvatarScreen({ api, onError, characterId, characterName, theme, onSaved, onClose }: {
  api: Api
  onError: (message: string) => void
  characterId?: string
  characterName: string
  theme?: AtmosphereKey
  onSaved?: (config: AvatarConfigV3) => void
  onClose?: () => void
}) {
  const cid = isCharacterId(characterId) ? characterId : 'lin-zhou'
  const packs = CHARACTER_PACKS[cid]
  const [config, setConfig] = useState<AvatarConfigV3>(() => defaultConfigV3(cid))
  const [loaded, setLoaded] = useState<AvatarConfigV3 | null>(null)
  const [notice, setNotice] = useState('')
  const [shareOpen, setShareOpen] = useState(false)
  const [shareInput, setShareInput] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let active = true
    void api<{ config: Record<string, unknown> | null }>('avatar')
      .then(({ config }) => { if (active && config) { const v3 = config.version === 3 ? coerceV3(config, cid) : migrateToV3(config, cid); setLoaded(v3); setConfig(v3) } })
      .catch(() => {})
    return () => { active = false }
  }, [api, cid])

  const currentPack = packs.find(p => p.id === config.packId) ?? packs[0]
  const dirty = !!loaded && (loaded.packId !== config.packId || loaded.expression !== config.expression)

  const save = async () => {
    if (busy) return
    setBusy(true)
    try {
      await api('avatar', { config }, 'PUT')
      setLoaded(config)
      setNotice('已保存今晚的样子。')
      onSaved?.(config)
    } catch (error) { onError?.((error as Error).message || '保存失败') } finally { setBusy(false) }
  }

  const applyShare = () => {
    const parsed = decodeShareV3(shareInput.trim(), cid)
    if (!parsed) { setNotice('这串形象码好像不对，检查一下再试试。'); return }
    setConfig(parsed)
    setShareOpen(false)
    setShareInput('')
    setNotice('已应用朋友分享的造型。')
  }

  return <section className="avatar-screen">
    <header className="album-actions">
      <button type="button" className="secondary" onClick={onClose}>返回</button>
      <h1>造型小屋 · {characterName}</h1>
      <span className="album-spacer" aria-hidden="true" />
    </header>

    <div className="av25-house-stage" aria-label={`${characterName}的2.5D形象，会眨眼和呼吸`}>
      <LiveStage characterId={cid} config={config} atmosphere={theme} parallax={10} frameFill />
      <p className="av25-hint">TA 会眨眼、呼吸 · 移动指针轻轻摆动 · 换主题换心情滤镜</p>
    </div>

    <div className="av25-actions">
      <button type="button" className="secondary" onClick={() => setShareOpen(true)}>形象码</button>
      {dirty && <span className="av25-dirty">有未保存的调整</span>}
    </div>

    <div className="av25-panels">
      <div className="av25-panel">
        <h2>今晚的心情</h2>
        <div className="av25-chip-row" role="radiogroup" aria-label="心情">
          <button type="button" className={'av25-chip' + (config.expression === 'calm' ? ' active' : '')} role="radio" aria-checked={config.expression === 'calm'}
            onClick={() => setConfig({ ...config, expression: 'calm' })}>平静</button>
          <button type="button" className={'av25-chip' + (config.expression === 'smile' ? ' active' : '')} role="radio" aria-checked={config.expression === 'smile'}
            onClick={() => setConfig({ ...config, expression: 'smile' })}>微笑</button>
        </div>
      </div>

      <div className="av25-panel">
        <h2>造型</h2>
        <div className="av25-pack-list">
          {packs.map(pack => <button type="button" key={pack.id}
            className={'av25-pack' + (pack.id === config.packId ? ' active' : '')}
            aria-pressed={pack.id === config.packId}
            onClick={() => setConfig({ ...config, packId: pack.id })}>
            <span className="av25-pack-name">{pack.name}</span>
            <small>{pack.hint}</small>
          </button>)}
        </div>
        {packs.length < 2 && <p className="av25-more">更多造型正在路上，敬请期待。</p>}
      </div>

      <button type="button" className="av25-save" disabled={busy || (!dirty && !!loaded)} onClick={save}>
        {busy ? '保存中…' : '保存今晚的样子'}
      </button>
    </div>

    {notice && <p className="av25-note" role="status">{notice}</p>}

    {shareOpen && <div className="av3-share" role="dialog" aria-label="形象码">
      <div className="av3-share-card">
        <h2>{characterName}的形象码</h2>
        <p>把这串码发给朋友，TA 输入后可以看到你给 TA 换的造型。</p>
        <textarea readOnly value={encodeShareV3(config)} onFocus={event => event.currentTarget.select()} />
        <div className="av3-share-actions">
          <button type="button" onClick={() => { void navigator.clipboard?.writeText(encodeShareV3(config)).then(() => setNotice('形象码已复制。')); setShareOpen(false) }}>复制</button>
          <button type="button" className="secondary" onClick={() => setShareOpen(false)}>关闭</button>
        </div>
        <hr className="av25-sep" />
        <h2>输入朋友的码</h2>
        <textarea aria-label="形象码" value={shareInput} placeholder="粘贴 WX3- 开头的形象码"
          onChange={event => setShareInput(event.target.value)} />
        <div className="av3-share-actions">
          <button type="button" onClick={applyShare}>应用</button>
          <button type="button" className="secondary" onClick={() => { setShareOpen(false); setShareInput('') }}>取消</button>
        </div>
      </div>
    </div>}
  </section>
}

// 捏捏形象：Schema v2 编辑器（3D 舞台 + 高自由度面板）与 SVG 降级编辑器。
// 3D 部分为全程序化原创人像（avatar3d.ts），无外部素材；SVG 头像保留为无 WebGL 环境的降级渲染。
import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import type { AvatarEngine, EngineTheme, PickRegion } from './avatar3d'
import {
  ACCESSORY_ITEMS, BANGS, BODY_SLIDERS, CHARACTER_DEFAULTS_V2, EYE_SLIDERS, FACE_SLIDERS, FRECKLE_STYLES, HAIR_SLIDERS, HAIR_STYLES, HAIR_SWATCHES, IRIS_COLORS, isWebGLAvailable,
  LIP_SLIDERS, LIP_SWATCHES, NOSE_SLIDERS, OUTFIT_SWATCHES, SKIN_SWATCHES, TOPS, OUTERS,
  applyV1ToV2, clamp, coerceV2, decodeShare, defaultConfigFor, encodeShare, hslToHex, projectV2toV1, randomizeV2,
  type AvatarConfigV2, type HSL, type Option, type RandomMode, type SliderMeta, type Swatch,
} from './avatar-catalog'

/* ========================================================================
 * 第一部分：SVG 降级头像（v1，保持既有行为）
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

export const AVATAR_OPTIONS = {
  skin: ['暖白', '浅麦', '蜜棕'],
  hair: ['长直发', '短发', '卷发', '马尾'],
  hairColor: ['墨夜', '栗棕', '焦糖', '枫木', '雾紫', '银灰'],
  eyes: ['圆眼', '弯月', '星星', '困困'],
  mouth: ['微笑', '小圆', '平直', '猫嘴'],
  blush: ['无', '浅浅', '绯红'],
  outfit: ['圆领', '衬衫', '围巾', '连帽'],
  outfitColor: ['藏蓝', '暗紫', '苔绿', '焦棕', '酒红', '青灰'],
  accessory: ['无', '星发夹', '耳钉', '圆眼镜', '缎带'],
} as const

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

// 每个角色的默认形象（v1 投影：由 v2 默认形象降级而来，保证两套渲染观感一致）
export const CHARACTER_DEFAULT_AVATAR: Record<string, AvatarConfig> = Object.fromEntries(
  Object.entries(CHARACTER_DEFAULTS_V2).map(([id, config]) => [id, projectV2toV1(config)]),
)
export const FALLBACK_AVATAR: AvatarConfig = CHARACTER_DEFAULT_AVATAR['lin-zhou']
  ?? { skin: 0, hair: '长直发', hairColor: 0, eyes: '圆眼', mouth: '微笑', blush: '浅浅', outfit: '围巾', outfitColor: 0, accessory: '无' }

export function mergeAvatar(base: AvatarConfig, override: Partial<AvatarConfig> | null | undefined): AvatarConfig {
  if (!override) return base
  const merged: AvatarConfig = { ...base }
  for (const key of Object.keys(override) as (keyof AvatarConfig)[]) {
    const value = override[key]
    if (typeof value === 'string' || typeof value === 'number') (merged as Record<string, unknown>)[key] = value
  }
  return merged
}

/* ========================================================================
 * 第二部分：3D 捏捏编辑器（Schema v2）
 * ======================================================================== */
type Api = <T>(path: string, data?: unknown, method?: string) => Promise<T>

type SectionId = 'face' | 'eyes' | 'nose-lips' | 'hair' | 'outfit' | 'skin'
const SECTION_TABS: { id: SectionId; name: string }[] = [
  { id: 'face', name: '脸型' }, { id: 'eyes', name: '眉眼' }, { id: 'nose-lips', name: '鼻唇' },
  { id: 'hair', name: '发型' }, { id: 'outfit', name: '穿搭' }, { id: 'skin', name: '肤妆' },
]
const REGION_TO_SECTION: Record<PickRegion, SectionId> = {
  face: 'face', eyes: 'eyes', nose: 'nose-lips', lips: 'nose-lips', hair: 'hair', outfit: 'outfit', accessory: 'outfit',
}

function Slider({ label, hint, value, onChange, onCommit }: { label: string; hint: string; value: number; onChange: (value: number) => void; onCommit: () => void }) {
  return <label className="av3-slider">
    <span className="av3-slider-head"><b>{label}</b><small>{hint}</small><i>{value > 0 ? '+' + value : value}</i></span>
    <input type="range" min={-100} max={100} step={1} value={value} aria-label={label}
      onPointerDown={onCommit}
      onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') onCommit() }}
      onChange={event => onChange(Number(event.target.value))} />
  </label>
}

function ChipRow({ label, items, active, onPick }: { label: string; items: Option[]; active: string; onPick: (id: string) => void }) {
  return <div className="av3-chip-row">
    <span className="av3-chip-label">{label}</span>
    <div className="av3-chips">
      {items.map(item => <button type="button" key={item.id} className={'av3-chip' + (active === item.id ? ' active' : '')}
        aria-pressed={active === item.id} onClick={() => onPick(item.id)}>{item.name}</button>)}
    </div>
  </div>
}

function SwatchRow({ label, swatches, value, onPick }: { label: string; swatches: Swatch[]; value: HSL; onPick: (hsl: HSL) => void }) {
  return <div className="av3-chip-row">
    <span className="av3-chip-label">{label}</span>
    <div className="av3-swatch-row" role="radiogroup" aria-label={label}>
      {swatches.map(swatch => {
        const hex = hslToHex(swatch.hsl)
        const selected = Math.abs(swatch.hsl.h - value.h) < 4 && Math.abs(swatch.hsl.s - value.s) < 4 && Math.abs(swatch.hsl.l - value.l) < 4
        return <button type="button" key={swatch.name + hex} role="radio" aria-checked={selected} title={swatch.name}
          className={'av3-swatch' + (selected ? ' active' : '')} style={{ background: hex }}
          onClick={() => onPick(swatch.hsl)} />
      })}
    </div>
  </div>
}

export function AvatarScreen({ api, onError, characterId, characterName, theme, onSaved, onClose }: {
  api: Api
  onError: (message: string) => void
  characterId: string | undefined
  characterName: string
  theme?: EngineTheme
  onSaved?: (config: AvatarConfigV2) => void
  onClose?: () => void
}) {
  const has3D = useMemo(() => isWebGLAvailable(), [])
  if (!has3D) return <AvatarScreenSVG api={api} onError={onError} characterId={characterId} characterName={characterName} onSaved={onSaved} onClose={onClose} />
  return <AvatarScreen3D api={api} onError={onError} characterId={characterId} characterName={characterName}
    theme={theme ?? 'night'} onSaved={onSaved} onClose={onClose} />
}

function AvatarScreen3D({ api, onError, characterId, characterName, theme, onSaved, onClose }: {
  api: Api
  onError: (message: string) => void
  characterId: string | undefined
  characterName: string
  theme: EngineTheme
  onSaved?: (config: AvatarConfigV2) => void
  onClose?: () => void
}) {
  const base = useMemo(() => defaultConfigFor(characterId), [characterId])
  const [config, setConfig] = useState<AvatarConfigV2>(base)
  const [loaded, setLoaded] = useState(false)
  const [tab, setTab] = useState<SectionId>('face')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [saved, setSaved] = useState(false)
  const [randomMenu, setRandomMenu] = useState(false)
  const [share, setShare] = useState<{ mode: 'out'; code: string } | { mode: 'in'; input: string } | null>(null)
  const past = useRef<AvatarConfigV2[]>([])
  const future = useRef<AvatarConfigV2[]>([])
  const [historyTick, setHistoryTick] = useState(0)
  const [comparing, setComparing] = useState(false)
  const stage = useRef<HTMLDivElement>(null)
  const engine = useRef<AvatarEngine | null>(null)
  const reducedMotion = useMemo(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches, [])

  useEffect(() => {
    void api<{ config: unknown }>('avatar').then(({ config: raw }) => {
      const next = coerceV2(raw) ?? applyV1ToV2(characterId, raw as never)
      setConfig(next)
      past.current = []
      future.current = []
    }).catch(() => {}).finally(() => setLoaded(true))
  }, [api, characterId])

  useEffect(() => {
    if (!stage.current || engine.current || !loaded) return
    let cancelled = false
    void import('./avatar3d').then(({ AvatarEngine: Engine }) => {
      if (cancelled || !stage.current) return
      try {
        engine.current = new Engine(stage.current, config, {
          theme,
          reducedMotion,
          onPick: region => setTab(REGION_TO_SECTION[region] ?? 'face'),
        })
      } catch {
        engine.current = null
      }
    })
    const resize = () => engine.current?.resize()
    window.addEventListener('resize', resize)
    return () => {
      cancelled = true
      window.removeEventListener('resize', resize)
      engine.current?.dispose()
      engine.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded])

  useEffect(() => { engine.current?.setTheme(theme) }, [theme])
  useEffect(() => {
    if (!comparing) engine.current?.setConfig(config)
  }, [config, comparing])

  const pushHistory = (snapshot: AvatarConfigV2) => {
    past.current.push(structuredClone(snapshot))
    if (past.current.length > 50) past.current.shift()
    future.current = []
    setHistoryTick(tick => tick + 1)
  }
  const mutate = (next: AvatarConfigV2, options: { history?: boolean; react?: 'adjust' | 'save' | 'random' } = {}) => {
    if (options.history !== false) pushHistory(config)
    setConfig(next)
    if (options.react) engine.current?.react(options.react)
  }
  /** 离散选择（款式 / 色板 / 配饰）统一入口：默认可撤销 */
  const patch = (mutator: (draft: AvatarConfigV2) => void, options: { history?: boolean } = {}) => {
    if (options.history !== false) pushHistory(config)
    const next = structuredClone(config)
    mutator(next)
    setConfig(next)
  }
  const setSlider = (section: 'face' | 'eyes' | 'nose' | 'lips' | 'hair' | 'body', key: string, value: number) => {
    const next = structuredClone(config)
    ;(next[section] as unknown as Record<string, number>)[key] = value
    setConfig(next)
  }
  const undo = () => {
    const previous = past.current.pop()
    if (!previous) return
    future.current.push(structuredClone(config))
    setConfig(previous)
    setHistoryTick(tick => tick + 1)
  }
  const redo = () => {
    const next = future.current.pop()
    if (!next) return
    past.current.push(structuredClone(config))
    setConfig(next)
    setHistoryTick(tick => tick + 1)
  }

  async function save() {
    if (busy) return
    setBusy(true)
    setNotice('')
    try {
      const result = await api<{ config: unknown }>('avatar', { config }, 'PUT')
      const saved = coerceV2(result.config) ?? config
      setConfig(saved)
      onSaved?.(saved)
      engine.current?.react('save')
      setSaved(true)
      window.setTimeout(() => setSaved(false), 1200)
      setNotice('形象已保存，TA换上了新样子。')
    } catch { onError('保存失败，请重试。') } finally { setBusy(false) }
  }

  function applyRandom(mode: RandomMode) {
    setRandomMenu(false)
    mutate(randomizeV2(config, mode), { react: 'random' })
    setNotice(mode === 'tasteful' ? '按审美权重随机了一套，不满意再摇。' : '换了一套，不满意再摇一次。')
  }

  function showShare() {
    setShare({ mode: 'out', code: encodeShare(config) })
  }
  function importShare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const next = decodeShare(share?.mode === 'in' ? share.input : '')
    if (!next) { setNotice('形象码没有识别成功，检查一下是否完整。'); return }
    mutate(next)
    setShare(null)
    setNotice('已应用形象码里的样子。')
  }
  async function copyShare() {
    if (share?.mode !== 'out') return
    try { await navigator.clipboard.writeText(share.code); setNotice('形象码已复制，发给朋友吧。') }
    catch { setNotice('长按或手动全选复制下面的形象码。') }
  }

  const startCompare = () => {
    if (comparing) return
    setComparing(true)
    engine.current?.setConfig(base)
  }
  const endCompare = () => {
    if (!comparing) return
    setComparing(false)
    engine.current?.setConfig(config)
  }

  const hairSliders: SliderMeta[] = HAIR_SLIDERS
  return <section className="avatar-screen av3">
    <header className="album-actions">
      {onClose && <button type="button" className="secondary" onClick={onClose}>返回</button>}
      <h1>捏一捏 · {characterName}</h1>
    </header>
    <div className={'av3-stage-wrap' + (saved ? ' saved' : '')}>
      <div className="av3-stage" ref={stage} role="img" aria-label={`${characterName}的三维形象，可拖动旋转`}>
        <div className="av3-stage-hint">拖动旋转 · 双指缩放 · 双击回正 · 点五官快速定位</div>
        {comparing && <div className="av3-compare-tag">原样</div>}
        <div className="av3-stage-tools">
          <button type="button" onClick={undo} disabled={!past.current.length} aria-label="撤销">↺</button>
          <button type="button" onClick={redo} disabled={!future.current.length} aria-label="重做">↻</button>
        </div>
      </div>
      <div className="av3-stage-actions">
        <button type="button" className="secondary" onPointerDown={startCompare} onPointerUp={endCompare} onPointerLeave={endCompare}>按住看原样</button>
        <button type="button" className="secondary" onClick={() => { pushHistory(config); setConfig(structuredClone(base)); setNotice('已恢复角色初始样子。') }}>恢复默认</button>
        <button type="button" className="secondary" onClick={showShare}>形象码</button>
      </div>
    </div>
    <div className="av3-sheet">
      <div className="av3-tabs" role="tablist" aria-label="捏捏分区">
        {SECTION_TABS.map(item => <button type="button" role="tab" key={item.id} aria-selected={tab === item.id}
          className={'av3-tab' + (tab === item.id ? ' active' : '')} onClick={() => setTab(item.id)}>{item.name}</button>)}
      </div>
      {tab === 'face' && <div className="av3-panel">
        {FACE_SLIDERS.map(slider => <Slider key={slider.key} label={slider.label} hint={slider.hint}
          value={config.face[slider.key as keyof typeof config.face]} onCommit={() => pushHistory(config)}
          onChange={value => setSlider('face', slider.key, value)} />)}
      </div>}
      {tab === 'eyes' && <div className="av3-panel">
        <ChipRow label="瞳色" items={IRIS_COLORS} active={config.eyes.iris}
          onPick={id => mutate({ ...structuredClone(config), eyes: { ...config.eyes, iris: id } })} />
        {EYE_SLIDERS.map(slider => <Slider key={slider.key} label={slider.label} hint={slider.hint}
          value={config.eyes[slider.key as keyof typeof config.eyes] as number} onCommit={() => pushHistory(config)}
          onChange={value => setSlider('eyes', slider.key, value)} />)}
      </div>}
      {tab === 'nose-lips' && <div className="av3-panel">
        <p className="av3-group-title">鼻</p>
        {NOSE_SLIDERS.map(slider => <Slider key={slider.key} label={slider.label} hint={slider.hint}
          value={config.nose[slider.key as keyof typeof config.nose]} onCommit={() => pushHistory(config)}
          onChange={value => setSlider('nose', slider.key, value)} />)}
        <p className="av3-group-title">唇</p>
        {LIP_SLIDERS.map(slider => <Slider key={slider.key} label={slider.label} hint={slider.hint}
          value={config.lips[slider.key as keyof typeof config.lips]} onCommit={() => pushHistory(config)}
          onChange={value => setSlider('lips', slider.key, value)} />)}
      </div>}
      {tab === 'hair' && <div className="av3-panel">
        <ChipRow label="发型" items={HAIR_STYLES} active={config.hair.style}
          onPick={id => patch(draft => { draft.hair.style = id })} />
        <ChipRow label="刘海" items={BANGS} active={config.hair.bangs}
          onPick={id => patch(draft => { draft.hair.bangs = id })} />
        {HAIR_SLIDERS.map(slider => <Slider key={slider.key} label={slider.label} hint={slider.hint}
          value={config.hair[slider.key as keyof typeof config.hair] as number} onCommit={() => pushHistory(config)}
          onChange={value => setSlider('hair', slider.key, value)} />)}
        <SwatchRow label="发色" swatches={HAIR_SWATCHES} value={config.hair.color}
          onPick={value => patch(draft => { draft.hair.color = value })} />
      </div>}
      {tab === 'outfit' && <div className="av3-panel">
        <ChipRow label="上装" items={TOPS} active={config.outfit.top}
          onPick={id => patch(draft => { draft.outfit.top = id })} />
        <SwatchRow label="上装颜色" swatches={OUTFIT_SWATCHES} value={config.outfit.topColor}
          onPick={value => patch(draft => { draft.outfit.topColor = value })} />
        <ChipRow label="外套" items={OUTERS} active={config.outfit.outer}
          onPick={id => patch(draft => { draft.outfit.outer = id })} />
        {config.outfit.outer !== 'none' && <SwatchRow label="外套颜色" swatches={OUTFIT_SWATCHES} value={config.outfit.outerColor}
          onPick={value => patch(draft => { draft.outfit.outerColor = value })} />}
        <p className="av3-group-title">身形</p>
        {BODY_SLIDERS.map(slider => <Slider key={slider.key} label={slider.label} hint={slider.hint}
          value={config.body[slider.key as keyof typeof config.body]} onCommit={() => pushHistory(config)}
          onChange={value => setSlider('body', slider.key, value)} />)}
        <p className="av3-group-title">配饰（最多三件）</p>
        <div className="av3-chips">
          {ACCESSORY_ITEMS.map(item => {
            const active = config.accessories.includes(item.id)
            return <button type="button" key={item.id} className={'av3-chip' + (active ? ' active' : '')} aria-pressed={active}
              onClick={() => patch(draft => {
                draft.accessories = active ? draft.accessories.filter(entry => entry !== item.id)
                  : draft.accessories.length >= 3 ? draft.accessories : [...draft.accessories, item.id]
              })}>{item.name}</button>
          })}
        </div>
      </div>}
      {tab === 'skin' && <div className="av3-panel">
        <SwatchRow label="肤色" swatches={SKIN_SWATCHES} value={config.skin.tone}
          onPick={value => patch(draft => { draft.skin.tone = value })} />
        <Slider label="腮红" hint="无到微醺" value={config.skin.blush} onCommit={() => pushHistory(config)}
          onChange={value => setConfig(previous => ({ ...previous, skin: { ...previous.skin, blush: clamp(value, 0, 100) } }))} />
        <ChipRow label="雀斑" items={FRECKLE_STYLES} active={config.skin.freckles}
          onPick={id => patch(draft => { draft.skin.freckles = id as typeof config.skin.freckles })} />
        <SwatchRow label="唇色" swatches={LIP_SWATCHES} value={config.skin.lipTint}
          onPick={value => patch(draft => { draft.skin.lipTint = value })} />
      </div>}
      <div className="av3-footer">
        <div className="av3-random">
          <button type="button" onClick={() => setRandomMenu(value => !value)} aria-expanded={randomMenu}>随机一套</button>
          {randomMenu && <div className="av3-random-menu" role="menu">
            <button type="button" role="menuitem" onClick={() => applyRandom('tasteful')}>好看优先</button>
            <button type="button" role="menuitem" onClick={() => applyRandom('face')}>只换五官</button>
            <button type="button" role="menuitem" onClick={() => applyRandom('full')}>放飞自我</button>
          </div>}
        </div>
        <button type="button" className="av3-save" disabled={busy} onClick={() => void save()}>保存形象</button>
      </div>
      {notice && <p role="status">{notice}</p>}
    </div>
    {share?.mode === 'out' && <div className="av3-share" role="dialog" aria-label="形象码">
      <div className="av3-share-card">
        <h2>{characterName}的形象码</h2>
        <p>把这串码发给朋友，TA输入后可以让角色穿成一样。</p>
        <textarea readOnly value={share.code} onFocus={event => event.currentTarget.select()} />
        <div className="av3-share-actions">
          <button type="button" onClick={() => void copyShare()}>复制</button>
          <button type="button" onClick={() => setShare({ mode: 'in', input: '' })}>输入朋友的码</button>
          <button type="button" className="secondary" onClick={() => setShare(null)}>关闭</button>
        </div>
      </div>
    </div>}
    {share?.mode === 'in' && <div className="av3-share" role="dialog" aria-label="输入形象码">
      <form className="av3-share-card" onSubmit={importShare}>
        <h2>输入形象码</h2>
        <textarea value={share.input} aria-label="形象码" placeholder="粘贴 WX2- 开头的形象码"
          onChange={event => setShare({ mode: 'in', input: event.target.value })} />
        <div className="av3-share-actions">
          <button type="submit">应用</button>
          <button type="button" className="secondary" onClick={() => setShare(null)}>取消</button>
        </div>
      </form>
    </div>}
  </section>
}

/* ---------- SVG 降级编辑器（无 WebGL 环境，行为与旧版一致） ---------- */
function AvatarScreenSVG({ api, onError, characterId, characterName, onSaved, onClose }: {
  api: Api
  onError: (message: string) => void
  characterId: string | undefined
  characterName: string
  onSaved?: (config: never) => void
  onClose?: () => void
}) {
  const projected = useMemo(() => projectV2toV1(defaultConfigFor(characterId)), [characterId])
  const [config, setConfig] = useState<AvatarConfig>(projected)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [saved, setSaved] = useState(false)
  const [tab, setTab] = useState<keyof typeof AVATAR_OPTIONS>('hair')

  useEffect(() => {
    void api<{ config: Partial<AvatarConfig> | null }>('avatar').then(({ config: raw }) => {
      if (raw && (raw as { version?: unknown }).version === undefined) setConfig(mergeAvatar(projected, raw))
    }).catch(() => {})
  }, [])

  async function save() {
    if (busy) return
    setBusy(true)
    setNotice('')
    try {
      await api('avatar', { config }, 'PUT')
      setSaved(true)
      window.setTimeout(() => setSaved(false), 1000)
      setNotice('形象已保存（当前设备不支持 3D 展示，已用平铺形象保存）。')
    } catch { onError('保存失败，请重试。') } finally { setBusy(false) }
  }

  function pick(key: keyof typeof AVATAR_OPTIONS, value: string | number) {
    setConfig(previous => ({ ...previous, [key]: value }) as AvatarConfig)
  }

  function randomize() {
    const draw = <T,>(list: readonly T[]) => list[Math.floor(Math.random() * list.length)]
    setConfig({
      skin: Math.floor(Math.random() * AVATAR_OPTIONS.skin.length),
      hair: draw(AVATAR_OPTIONS.hair),
      hairColor: Math.floor(Math.random() * AVATAR_OPTIONS.hairColor.length),
      eyes: draw(AVATAR_OPTIONS.eyes),
      mouth: draw(AVATAR_OPTIONS.mouth),
      blush: draw(AVATAR_OPTIONS.blush),
      outfit: draw(AVATAR_OPTIONS.outfit),
      outfitColor: Math.floor(Math.random() * AVATAR_OPTIONS.outfitColor.length),
      accessory: draw(AVATAR_OPTIONS.accessory),
    })
    setNotice('换了一套，不满意再摇一次。')
  }

  return <section className="avatar-screen">
    <header className="album-actions">
      {onClose && <button type="button" className="secondary" onClick={onClose}>返回</button>}
      <h1>捏一捏 · {characterName}</h1>
    </header>
    <div className={'avatar-stage' + (saved ? ' saved' : '')}>
      <Avatar config={config} size={168} glow />
      <div className="avatar-tabs">
        {(Object.keys(AVATAR_OPTIONS) as (keyof typeof AVATAR_OPTIONS)[]).map(key =>
          <button type="button" key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>{key === 'hair' ? '发型' : key === 'hairColor' ? '发色' : key === 'skin' ? '肤色' : key === 'eyes' ? '眼睛' : key === 'mouth' ? '嘴巴' : key === 'blush' ? '腮红' : key === 'outfit' ? '服装' : key === 'outfitColor' ? '服色' : key === 'accessory' ? '配饰' : key}</button>)}
      </div>
      <div className="avatar-options">
        {AVATAR_OPTIONS[tab].map((option, index) => {
          const selected = typeof config[tab] === 'number' ? config[tab] === index : config[tab] === option
          return <button type="button" key={option} className={'avatar-option' + (selected ? ' active' : '')}
            onClick={() => pick(tab, typeof config[tab] === 'number' ? index : option)}>{option}</button>
        })}
      </div>
      <div className="avatar-actions">
        <button type="button" className="secondary" onClick={() => { setConfig(projected); setNotice('') }}>恢复默认</button>
        <button type="button" className="secondary" onClick={randomize}>随机一套</button>
        <button type="submit" disabled={busy} onClick={() => void save()}>保存形象</button>
      </div>
      {notice && <p role="status">{notice}</p>}
    </div>
  </section>
}

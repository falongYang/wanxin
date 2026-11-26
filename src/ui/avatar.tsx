// 原创分层 SVG 头像系统「捏捏」：全部图形为本项目原创绘制，无外部素材。
// 配置为一个扁平 JSON，服务端仅做形状校验后原样存储。
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'

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

// 每个角色的默认形象
export const CHARACTER_DEFAULT_AVATAR: Record<string, AvatarConfig> = {
  'lin-zhou': { skin: 0, hair: '长直发', hairColor: 1, eyes: '圆眼', mouth: '微笑', blush: '浅浅', outfit: '围巾', outfitColor: 0, accessory: '无' },
  'gu-chuan': { skin: 0, hair: '短发', hairColor: 0, eyes: '困困', mouth: '平直', blush: '无', outfit: '衬衫', outfitColor: 4, accessory: '圆眼镜' },
  'su-mian': { skin: 0, hair: '马尾', hairColor: 4, eyes: '星星', mouth: '小圆', blush: '绯红', outfit: '连帽', outfitColor: 2, accessory: '星发夹' },
}
export const FALLBACK_AVATAR: AvatarConfig = CHARACTER_DEFAULT_AVATAR['lin-zhou']

export function mergeAvatar(base: AvatarConfig, override: Partial<AvatarConfig> | null | undefined): AvatarConfig {
  if (!override) return base
  const merged: AvatarConfig = { ...base }
  for (const key of Object.keys(override) as (keyof AvatarConfig)[]) {
    const value = override[key]
    if (typeof value === 'string' || typeof value === 'number') (merged as Record<string, unknown>)[key] = value
  }
  return merged
}

type Api = <T>(path: string, data?: unknown, method?: string) => Promise<T>

/* ---------- 捏捏编辑器 ---------- */
export function AvatarScreen({ api, onError, characterId, characterName, onSaved, onClose }: {
  api: Api
  onError: (message: string) => void
  characterId: string | undefined
  characterName: string
  onSaved?: (config: AvatarConfig) => void
  onClose?: () => void
}) {
  const base = (characterId && CHARACTER_DEFAULT_AVATAR[characterId]) || FALLBACK_AVATAR
  const [config, setConfig] = useState<AvatarConfig>(base)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [tab, setTab] = useState<keyof typeof AVATAR_OPTIONS>('hair')

  useEffect(() => {
    void api<{ config: Partial<AvatarConfig> | null }>('avatar').then(({ config }) => {
      if (config) setConfig(mergeAvatar(base, config))
    }).catch(() => {})
  }, [])

  async function save() {
    if (busy) return
    setBusy(true)
    setNotice('')
    try {
      await api('avatar', { config }, 'PUT')
      onSaved?.(config)
      setNotice('形象已保存，TA换上了新样子。')
    } catch { onError('保存失败，请重试。') } finally { setBusy(false) }
  }

  function pick(key: keyof typeof AVATAR_OPTIONS, value: string | number) {
    setConfig(previous => ({ ...previous, [key]: value }) as AvatarConfig)
  }

  return <section className="avatar-screen">
    <header className="album-actions">
      {onClose && <button type="button" className="secondary" onClick={onClose}>返回</button>}
      <h1>捏一捏 · {characterName}</h1>
    </header>
    <div className="avatar-stage">
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
      <button type="submit" disabled={busy} onClick={() => void save()}>保存形象</button>
      {notice && <p role="status">{notice}</p>}
    </div>
  </section>
}
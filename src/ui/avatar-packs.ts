// S11 · 2.5D 造型包形象系统 —— 造型包目录与 v3 配置
// 每个造型包 = 一套完整 AI 插画立绘（发型+穿搭+配饰一体化设计），
// 含 open/closed/smile/talk 四帧，支持眨眼/呼吸/视差/说话联动动效。
// 素材由 docs/design/stage11 管线生成，白底抠除后位于 public/avatar-packs/。

export type PackFrame = 'open' | 'closed' | 'smile' | 'talk'
export type CharacterId = 'lin-zhou' | 'gu-chuan' | 'su-mian'

export interface AvatarPack {
  id: string
  name: string
  hint: string
  /** 解锁所需羁绊等级（0 = 默认开放；升级解锁更多造型） */
  level: number
  frames: Record<PackFrame, string>
}

export interface AvatarConfigV3 {
  version: 3
  characterId: CharacterId
  packId: string
  /** 表情选择（编辑器里选的心情），talk 帧由聊天场景自动接管 */
  expression: 'calm' | 'smile'
}

const ASSET_BASE = 'avatar-packs'

function packAsset(character: string, pack: string, frame: PackFrame) {
  return `${ASSET_BASE}/${character}-${pack}-${frame}.png`
}

function buildPack(character: string, id: string, name: string, hint: string, level: number): AvatarPack {
  const frames = {} as AvatarPack['frames']
  for (const frame of ['open', 'closed', 'smile', 'talk'] as PackFrame[]) {
    frames[frame] = packAsset(character, id, frame)
  }
  return { id, name, hint, level, frames }
}

/** 角色造型包目录（支持增量扩充：补素材 + 在此登记即可） */
export const CHARACTER_PACKS: Record<CharacterId, AvatarPack[]> = {
  'lin-zhou': [
    buildPack('linzhou', 'pack1', '深夜电台', '云白针织与暖杏开衫，戴上耳机就有节目感', 0),
    buildPack('linzhou', 'pack2', '海边漫步', '奶白卫衣，耳机挂在脖子上，海风都慢下来', 2),
    buildPack('linzhou', 'pack3', '暖冬炉火', '针织帽与格纹围巾，炉子上的水壶轻轻响', 3),
    buildPack('linzhou', 'pack4', '夏夜风铃', '条纹T恤和小耳钉，晚风穿过风铃的凉夏', 4),
    buildPack('linzhou', 'pack5', '特别节目', '背头白衬衫，今晚的节目单为你加了星', 5),
  ],
  'gu-chuan': [
    buildPack('guchuan', 'pack1', '旧书店', '深棕高领与墨绿马甲，书页间的沉静', 0),
    buildPack('guchuan', 'pack2', '深夜阅读', '灰开衫抱着没读完的旧书，灯下再坐一会儿', 2),
    buildPack('guchuan', 'pack3', '雨天来客', '焦糖风衣与围巾，替你收好滴水的伞', 3),
    buildPack('guchuan', 'pack4', '午后咖啡', '挽起袖口的白衬衫，今天店里的咖啡豆很香', 4),
    buildPack('guchuan', 'pack5', '店休日', '雾灰卫衣与有线耳机，书店休息的日子去散步', 5),
  ],
  'su-mian': [
    buildPack('sunwan', 'pack1', '城市天台', '月白卫衣与灰蓝工装，把星星收进相机', 0),
    buildPack('sunwan', 'pack2', '深夜便利店', '杏色面包羽绒服，关东煮的热气糊住玻璃', 2),
    buildPack('sunwan', 'pack3', '图书馆午睡', '奶咖卫衣与平光镜，在书页间打了个盹', 3),
    buildPack('sunwan', 'pack4', '流星雨之夜', '毛绒外套与绒线手套，等一场说好的流星雨', 4),
    buildPack('sunwan', 'pack5', '春日骑行', '浅青夹克高马尾，风把春天吹到耳边', 5),
  ],
}

export const PACK_FRAME_KEYS: PackFrame[] = ['open', 'closed', 'smile', 'talk']

export function defaultConfigV3(characterId: CharacterId): AvatarConfigV3 {
  return { version: 3, characterId, packId: CHARACTER_PACKS[characterId][0].id, expression: 'calm' }
}

export function isCharacterId(value: unknown): value is CharacterId {
  return value === 'lin-zhou' || value === 'gu-chuan' || value === 'su-mian'
}

/** 服务端/客户端共用的 v3 校验：未知键忽略、packId 必须存在、expression 白名单 */
export function coerceV3(input: unknown, characterId: CharacterId): AvatarConfigV3 {
  const source = (input && typeof input === 'object') ? input as Record<string, unknown> : {}
  const packs = CHARACTER_PACKS[characterId] ?? []
  const packId = typeof source.packId === 'string' && packs.some(p => p.id === source.packId)
    ? source.packId
    : packs[0].id
  const expression = source.expression === 'smile' ? 'smile' : 'calm'
  return { version: 3, characterId, packId, expression }
}

/** 旧配置迁移：v2/v1 捏捏数据 → 该角色默认造型包（3D 滑杆体系退役） */
export function migrateToV3(input: unknown, characterId: CharacterId): AvatarConfigV3 {
  return defaultConfigV3(characterId)
}

/* ---------- 形象码（v3）---------- */

function toBase64Url(text: string) {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(encoded: string) {
  const padded = encoded.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded + '='.repeat((4 - padded.length % 4) % 4))
  const bytes = Uint8Array.from(binary, ch => ch.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

export function encodeShareV3(config: AvatarConfigV3): string {
  return 'WX3-' + toBase64Url(JSON.stringify({
    v: 3, c: config.characterId, p: config.packId, e: config.expression,
  }))
}

export function decodeShareV3(code: string, characterId: CharacterId): AvatarConfigV3 | null {
  if (typeof code !== 'string' || !code.startsWith('WX3-')) return null
  try {
    const parsed = JSON.parse(fromBase64Url(code.slice(4))) as Record<string, unknown>
    if (parsed.v !== 3 || parsed.c !== characterId) return null
    return coerceV3({ packId: parsed.p, expression: parsed.e }, characterId)
  } catch {
    return null
  }
}

/** 表情 → 展示帧：calm 用 open、smile 用 smile；closed/talk 由动效接管 */
export function expressionFrame(config: AvatarConfigV3): 'open' | 'smile' {
  return config.expression === 'smile' ? 'smile' : 'open'
}

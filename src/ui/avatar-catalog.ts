// 捏捏形象 Schema v2 —— 数据层：类型、款式目录、角色默认、随机、分享码与降级投影。
// 全部形象为程序化原创 3D 构建（见 avatar3d.ts），不使用任何外部素材。
export type HSL = { h: number; s: number; l: number }
export type FaceParams = { faceWidth: number; jawWidth: number; jawAngle: number; chinLength: number; cheekBone: number; cheekFat: number }
export type EyeParams = {
  eyeDistance: number; eyeHeight: number; eyeSize: number; eyeTilt: number; lidCrease: number; smileBand: number
  browHeight: number; browSpace: number; browCurve: number; browThick: number; iris: string
}
export type NoseParams = { bridge: number; bridgeWidth: number; tip: number; ala: number; noseLength: number }
export type LipParams = { upperLip: number; lowerLip: number; mouthWidth: number; corner: number; cupidsBow: number }
export type SkinParams = { tone: HSL; blush: number; lipTint: HSL; freckles: 'none' | 'light' | 'dense' }
export type HairParams = { style: string; bangs: string; color: HSL; highlight: number; length: number; volume: number; curl: number }
export type BodyParams = { shoulderWidth: number; neckLength: number; chestDepth: number }
export type OutfitParams = { top: string; topColor: HSL; outer: string; outerColor: HSL }
export type AvatarConfigV2 = {
  version: 2
  face: FaceParams
  eyes: EyeParams
  nose: NoseParams
  lips: LipParams
  skin: SkinParams
  hair: HairParams
  body: BodyParams
  outfit: OutfitParams
  accessories: string[]
}

/* ---------- 款式目录（UI 直接消费） ---------- */
export type Option = { id: string; name: string }

export const HAIR_STYLES: Option[] = [
  { id: 'wavy-mid', name: '微卷中发' }, { id: 'short-clean', name: '利落短发' }, { id: 'wavy-short', name: '蓬松短发' },
  { id: 'long-straight', name: '长直发' }, { id: 'ponytail', name: '低马尾' }, { id: 'half-up', name: '半扎发' },
  { id: 'bob', name: '波波头' }, { id: 'curly', name: '羊毛卷' },
]
export const BANGS: Option[] = [
  { id: 'none', name: '露额' }, { id: 'airy', name: '空气刘海' }, { id: 'curtain', name: '八字刘海' }, { id: 'full', name: '齐刘海' },
]
export const IRIS_COLORS: Option[] = [
  { id: 'dark-brown', name: '黑棕' }, { id: 'brown', name: '深褐' }, { id: 'hazel', name: '琥珀' },
  { id: 'green', name: '碧绿' }, { id: 'grey-blue', name: '雾蓝' }, { id: 'violet', name: '雾紫' },
]
export const TOPS: Option[] = [
  { id: 'knit-round', name: '圆领针织' }, { id: 'turtleneck', name: '高领毛衣' }, { id: 'shirt', name: '立领衬衫' },
  { id: 'hoodie', name: '连帽卫衣' }, { id: 'tee', name: '圆领T恤' }, { id: 'sweater', name: '麻花针织' },
]
export const OUTERS: Option[] = [
  { id: 'none', name: '无外套' }, { id: 'cardigan', name: '开衫' }, { id: 'vest', name: '针织马甲' },
  { id: 'jacket', name: '工装外套' }, { id: 'coat', name: '长风衣' }, { id: 'blazer', name: '小西装' },
]
export const ACCESSORY_ITEMS: Option[] = [
  { id: 'glasses-round', name: '圆框眼镜' }, { id: 'glasses-square', name: '方框眼镜' }, { id: 'earrings', name: '耳钉' },
  { id: 'star-pin', name: '星形发夹' }, { id: 'ribbon', name: '缎带' }, { id: 'headphones', name: '头戴耳机' },
  { id: 'scarf', name: '围巾' }, { id: 'camera', name: '挂饰相机' },
]
export const FRECKLE_STYLES: Option[] = [{ id: 'none', name: '无' }, { id: 'light', name: '浅浅' }, { id: 'dense', name: '明显' }]

/* 预设色板（{名称, HSL}），比 HSL 滑杆更符合移动端首屏体验 */
export type Swatch = { name: string; hsl: HSL }
export const HAIR_SWATCHES: Swatch[] = [
  { name: '墨夜', hsl: { h: 228, s: 26, l: 13 } }, { name: '黑茶', hsl: { h: 210, s: 18, l: 17 } }, { name: '栗棕', hsl: { h: 24, s: 40, l: 23 } },
  { name: '焦糖', hsl: { h: 30, s: 52, l: 38 } }, { name: '枫木', hsl: { h: 18, s: 48, l: 34 } }, { name: '蜜茶', hsl: { h: 36, s: 46, l: 46 } },
  { name: '雾灰', hsl: { h: 228, s: 6, l: 58 } }, { name: '银月', hsl: { h: 220, s: 8, l: 76 } }, { name: '雾紫', hsl: { h: 268, s: 28, l: 40 } },
  { name: '樱粉', hsl: { h: 336, s: 48, l: 62 } }, { name: '海盐青', hsl: { h: 184, s: 36, l: 42 } }, { name: '薄藤', hsl: { h: 300, s: 22, l: 55 } },
]
export const SKIN_SWATCHES: Swatch[] = [
  { name: '暖白', hsl: { h: 28, s: 42, l: 86 } }, { name: '浅麦', hsl: { h: 26, s: 44, l: 78 } }, { name: '蜜杏', hsl: { h: 24, s: 46, l: 70 } },
  { name: '冷白', hsl: { h: 210, s: 22, l: 85 } }, { name: '自然棕', hsl: { h: 22, s: 42, l: 58 } }, { name: '深棕', hsl: { h: 20, s: 40, l: 44 } },
]
export const LIP_SWATCHES: Swatch[] = [
  { name: '豆沙', hsl: { h: 6, s: 42, l: 52 } }, { name: '水红', hsl: { h: 352, s: 52, l: 62 } }, { name: '蜜桃', hsl: { h: 18, s: 56, l: 66 } },
  { name: '裸粉', hsl: { h: 20, s: 36, l: 74 } }, { name: '枫叶', hsl: { h: 12, s: 48, l: 42 } }, { name: '无色', hsl: { h: 14, s: 30, l: 70 } },
]
export const OUTFIT_SWATCHES: Swatch[] = [
  { name: '云白', hsl: { h: 42, s: 24, l: 92 } }, { name: '暖杏', hsl: { h: 30, s: 46, l: 80 } }, { name: '蜜金', hsl: { h: 38, s: 46, l: 64 } },
  { name: '藏蓝', hsl: { h: 222, s: 38, l: 30 } }, { name: '月白', hsl: { h: 210, s: 20, l: 90 } }, { name: '灰蓝', hsl: { h: 204, s: 22, l: 62 } },
  { name: '墨绿', hsl: { h: 158, s: 28, l: 26 } }, { name: '深棕', hsl: { h: 24, s: 38, l: 28 } }, { name: '绛紫', hsl: { h: 276, s: 24, l: 32 } },
  { name: '酒红', hsl: { h: 350, s: 42, l: 34 } }, { name: '樱粉', hsl: { h: 340, s: 44, l: 74 } }, { name: '夜黑', hsl: { h: 228, s: 16, l: 14 } },
]
export const IRIS_HEX: Record<string, string> = {
  'dark-brown': '#3a2c26', brown: '#5b3d28', hazel: '#8a6a3a', green: '#4a6a4e', 'grey-blue': '#6d88a4', violet: '#7a6899',
}

/* ---------- 参数元数据（分区、滑杆） ---------- */
export type SliderMeta = { key: string; label: string; hint: string }
export const FACE_SLIDERS: SliderMeta[] = [
  { key: 'faceWidth', label: '脸宽', hint: '鹅蛋到圆润' }, { key: 'jawWidth', label: '下颌宽', hint: '收窄到舒展' },
  { key: 'jawAngle', label: '下颌角', hint: '尖巧到方正' }, { key: 'chinLength', label: '下巴长度', hint: '短巧到清隽' },
  { key: 'cheekBone', label: '颧骨', hint: '柔和到立体' }, { key: 'cheekFat', label: '脸颊', hint: '清瘦到饱满' },
]
export const EYE_SLIDERS: SliderMeta[] = [
  { key: 'eyeDistance', label: '眼距', hint: '聚拢到舒分' }, { key: 'eyeHeight', label: '眼位高低', hint: '低垂到高挑' },
  { key: 'eyeSize', label: '眼睛大小', hint: '细长到圆润' }, { key: 'eyeTilt', label: '眼尾', hint: '下垂到上扬' },
  { key: 'lidCrease', label: '双眼皮', hint: '内双到明显' }, { key: 'smileBand', label: '卧蚕', hint: '无到笑眼' },
  { key: 'browHeight', label: '眉骨高低', hint: '低平到英气' }, { key: 'browSpace', label: '眉间距', hint: '紧凑到疏朗' },
  { key: 'browCurve', label: '眉形弯度', hint: '平直到弯月' }, { key: 'browThick', label: '眉浓淡', hint: '淡雅到浓密' },
]
export const NOSE_SLIDERS: SliderMeta[] = [
  { key: 'bridge', label: '鼻梁', hint: '低平到挺拔' }, { key: 'bridgeWidth', label: '鼻梁宽窄', hint: '纤细到大气' },
  { key: 'tip', label: '鼻头', hint: '精巧到饱满' }, { key: 'ala', label: '鼻翼', hint: '收紧到舒展' },
  { key: 'noseLength', label: '鼻长', hint: '娇短到修长' },
]
export const LIP_SLIDERS: SliderMeta[] = [
  { key: 'upperLip', label: '上唇厚', hint: '纤薄到丰盈' }, { key: 'lowerLip', label: '下唇厚', hint: '纤薄到丰盈' },
  { key: 'mouthWidth', label: '嘴宽', hint: '樱桃到大方' }, { key: 'corner', label: '嘴角', hint: '清冷到含笑' },
  { key: 'cupidsBow', label: '唇峰', hint: '柔和到立体' },
]
export const HAIR_SLIDERS: SliderMeta[] = [
  { key: 'length', label: '发长', hint: '利落到及肩下' }, { key: 'volume', label: '蓬松度', hint: '服帖到蓬松' },
  { key: 'curl', label: '卷度', hint: '直发到卷曲' }, { key: 'highlight', label: '挑染', hint: '无到浅一度' },
]
export const BODY_SLIDERS: SliderMeta[] = [
  { key: 'shoulderWidth', label: '肩宽', hint: '窄肩到舒展' }, { key: 'neckLength', label: '颈长', hint: '短颈到天鹅颈' },
  { key: 'chestDepth', label: '身量', hint: '轻薄到厚实' },
]

/* ---------- 三角色默认形象（按已定稿设计稿：林舟A / 顾川A / 孙晚B） ---------- */
const merge = <T extends object>(defaults: T, override: Partial<T> | undefined): T =>
  ({ ...defaults, ...(override ?? {}) }) as T
const DEFAULT_SKIN: SkinParams = { tone: { h: 28, s: 42, l: 86 }, blush: 30, lipTint: { h: 6, s: 32, l: 58 }, freckles: 'none' }
const DEFAULT_HAIR: HairParams = { style: 'wavy-mid', bangs: 'airy', color: { h: 228, s: 26, l: 13 }, highlight: 0, length: 0, volume: 0, curl: 0 }
const DEFAULT_OUTFIT: OutfitParams = { top: 'knit-round', topColor: { h: 42, s: 24, l: 92 }, outer: 'none', outerColor: { h: 222, s: 38, l: 30 } }

const base = (over: {
  face?: Partial<FaceParams>; eyes?: Partial<EyeParams>; nose?: Partial<NoseParams>; lips?: Partial<LipParams>
  skin?: Partial<SkinParams>; hair?: Partial<HairParams>; body?: Partial<BodyParams>; outfit?: Partial<OutfitParams>; accessories?: string[]
}): AvatarConfigV2 => ({
  version: 2,
  face: merge<FaceParams>({ faceWidth: 0, jawWidth: 0, jawAngle: 0, chinLength: 0, cheekBone: 0, cheekFat: 0 }, over.face),
  eyes: merge<EyeParams>({
    eyeDistance: 0, eyeHeight: 0, eyeSize: 0, eyeTilt: 0, lidCrease: 0, smileBand: 0,
    browHeight: 0, browSpace: 0, browCurve: 0, browThick: 0, iris: 'dark-brown',
  }, over.eyes),
  nose: merge<NoseParams>({ bridge: 0, bridgeWidth: 0, tip: 0, ala: 0, noseLength: 0 }, over.nose),
  lips: merge<LipParams>({ upperLip: 0, lowerLip: 0, mouthWidth: 0, corner: 0, cupidsBow: 0 }, over.lips),
  skin: merge<SkinParams>({ ...DEFAULT_SKIN, tone: { ...DEFAULT_SKIN.tone }, lipTint: { ...DEFAULT_SKIN.lipTint } },
    { ...over.skin, tone: over.skin?.tone && { ...over.skin.tone }, lipTint: over.skin?.lipTint && { ...over.skin.lipTint } } as Partial<SkinParams>),
  hair: merge<HairParams>({ ...DEFAULT_HAIR, color: { ...DEFAULT_HAIR.color } },
    { ...over.hair, color: over.hair?.color && { ...over.hair.color } } as Partial<HairParams>),
  body: merge<BodyParams>({ shoulderWidth: 0, neckLength: 0, chestDepth: 0 }, over.body),
  outfit: merge<OutfitParams>({ ...DEFAULT_OUTFIT, topColor: { ...DEFAULT_OUTFIT.topColor }, outerColor: { ...DEFAULT_OUTFIT.outerColor } },
    { ...over.outfit, topColor: over.outfit?.topColor && { ...over.outfit.topColor }, outerColor: over.outfit?.outerColor && { ...over.outfit.outerColor } } as Partial<OutfitParams>),
  accessories: over.accessories ?? [],
})

export const CHARACTER_DEFAULTS_V2: Record<string, AvatarConfigV2> = {
  // 林舟：云白针织 + 暖杏开衫 + 头戴耳机，黑棕微卷中发，温柔弯眉
  'lin-zhou': base({
    face: { faceWidth: -12, jawWidth: -2, jawAngle: 12, chinLength: 14, cheekBone: 8, cheekFat: -12 },
    eyes: { eyeSize: 6, eyeTilt: -2, lidCrease: 12, smileBand: 14, browCurve: 10, browThick: 8, iris: 'dark-brown' },
    nose: { bridge: 22, bridgeWidth: -8, tip: -2, ala: -6, noseLength: 10 },
    lips: { upperLip: -6, lowerLip: -2, mouthWidth: -4, corner: 18, cupidsBow: 2 },
    skin: { tone: { h: 28, s: 42, l: 86 }, blush: 8, lipTint: { h: 6, s: 30, l: 66 } },
    hair: { style: 'wavy-mid', bangs: 'airy', color: { h: 222, s: 22, l: 15 }, length: -24, volume: 6, curl: 14 },
    body: { shoulderWidth: -4, neckLength: 8, chestDepth: -8 },
    outfit: { top: 'knit-round', topColor: { h: 42, s: 24, l: 92 }, outer: 'cardigan', outerColor: { h: 30, s: 46, l: 80 } },
    accessories: ['headphones'],
  }),
  // 顾川：深棕高领 + 墨绿马甲 + 金丝圆眼镜，黑发利落，清冷书卷
  'gu-chuan': base({
    face: { faceWidth: -8, jawWidth: -16, jawAngle: 8, chinLength: 16, cheekBone: 10, cheekFat: -14 },
    eyes: { eyeSize: -8, eyeTilt: 4, lidCrease: 6, smileBand: 0, browHeight: 8, browSpace: -4, browCurve: -14, browThick: 6, iris: 'brown' },
    nose: { bridge: 20, bridgeWidth: -6, tip: -6, ala: -8, noseLength: 14 },
    lips: { upperLip: -4, lowerLip: -2, mouthWidth: 4, corner: -16, cupidsBow: 0 },
    skin: { tone: { h: 210, s: 22, l: 84 }, blush: 12, lipTint: { h: 14, s: 30, l: 70 } },
    hair: { style: 'short-clean', bangs: 'none', color: { h: 228, s: 26, l: 13 }, length: -20, volume: -6, curl: 0 },
    body: { shoulderWidth: 6, neckLength: 10, chestDepth: 0 },
    outfit: { top: 'turtleneck', topColor: { h: 24, s: 38, l: 28 }, outer: 'vest', outerColor: { h: 158, s: 28, l: 26 } },
    accessories: ['glasses-round'],
  }),
  // 孙晚：月白连帽卫衣 + 灰蓝工装 + 星形发夹，长直发八字刘海，清冷灵动
  'su-mian': base({
    face: { faceWidth: -10, jawWidth: -18, jawAngle: -8, chinLength: 4, cheekBone: 4, cheekFat: -4 },
    eyes: { eyeSize: 16, eyeTilt: 8, lidCrease: 18, smileBand: 10, browCurve: 14, browThick: -10, iris: 'dark-brown' },
    nose: { bridge: 12, bridgeWidth: -12, tip: -8, ala: -8, noseLength: 8 },
    lips: { upperLip: 4, lowerLip: 10, mouthWidth: -12, corner: 10, cupidsBow: 10 },
    skin: { tone: { h: 210, s: 24, l: 87 }, blush: 42, lipTint: { h: 352, s: 42, l: 60 } },
    hair: { style: 'long-straight', bangs: 'curtain', color: { h: 228, s: 26, l: 12 }, length: 20, volume: 6, curl: 0 },
    body: { shoulderWidth: -14, neckLength: 6, chestDepth: -8 },
    outfit: { top: 'hoodie', topColor: { h: 210, s: 20, l: 90 }, outer: 'jacket', outerColor: { h: 204, s: 22, l: 62 } },
    accessories: ['star-pin', 'camera'],
  }),
}
export const FALLBACK_V2: AvatarConfigV2 = CHARACTER_DEFAULTS_V2['lin-zhou']

/* ---------- 工具 ---------- */
export const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))

export function hslToHex({ h, s, l }: HSL): string {
  const hh = ((h % 360) + 360) % 360 / 360, ss = clamp(s, 0, 100) / 100, ll = clamp(l, 0, 100) / 100
  const q = ll < .5 ? ll * (1 + ss) : ll + ss - ll * ss, p = 2 * ll - q
  const channel = (t: number) => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  const to255 = (v: number) => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, '0')
  return '#' + to255(channel(hh + 1 / 3)) + to255(channel(hh)) + to255(channel(hh - 1 / 3))
}

export function defaultConfigFor(characterId: string | undefined): AvatarConfigV2 {
  return structuredClone(CHARACTER_DEFAULTS_V2[characterId ?? ''] ?? FALLBACK_V2)
}

/** 把任意输入整形成合法 v2（未知键丢弃、数值截断），用于导入分享码与读取服务端配置。 */
export function coerceV2(input: unknown): AvatarConfigV2 | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const raw = input as Record<string, unknown>
  if (raw.version !== 2) return null
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(clamp(v, -100, 100)) : 0)
  const hsl = (v: unknown, fb: HSL): HSL =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? {
          h: Math.round(clamp((v as HSL).h ?? fb.h, 0, 360)), s: Math.round(clamp((v as HSL).s ?? fb.s, 0, 100)),
          l: Math.round(clamp((v as HSL).l ?? fb.l, 0, 100)),
        }
      : { ...fb }
  const id = (v: unknown, list: Option[], fb: string) => (typeof v === 'string' && list.some(item => item.id === v) ? v : fb)
  const d = FALLBACK_V2
  const section = (name: string): Record<string, unknown> => {
    const value = raw[name]
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  }
  const face = section('face'), eyes = section('eyes'), nose = section('nose'), lips = section('lips')
  const skin = section('skin'), hair = section('hair'), body = section('body'), outfit = section('outfit')
  const accessories = Array.isArray(raw.accessories)
    ? raw.accessories.filter(item => typeof item === 'string' && ACCESSORY_ITEMS.some(option => option.id === item)).slice(0, 3)
    : []
  return {
    version: 2,
    face: {
      faceWidth: num(face.faceWidth), jawWidth: num(face.jawWidth), jawAngle: num(face.jawAngle),
      chinLength: num(face.chinLength), cheekBone: num(face.cheekBone), cheekFat: num(face.cheekFat),
    },
    eyes: {
      eyeDistance: num(eyes.eyeDistance), eyeHeight: num(eyes.eyeHeight), eyeSize: num(eyes.eyeSize), eyeTilt: num(eyes.eyeTilt),
      lidCrease: num(eyes.lidCrease), smileBand: num(eyes.smileBand), browHeight: num(eyes.browHeight), browSpace: num(eyes.browSpace),
      browCurve: num(eyes.browCurve), browThick: num(eyes.browThick), iris: id(eyes.iris, IRIS_COLORS, 'dark-brown'),
    },
    nose: { bridge: num(nose.bridge), bridgeWidth: num(nose.bridgeWidth), tip: num(nose.tip), ala: num(nose.ala), noseLength: num(nose.noseLength) },
    lips: {
      upperLip: num(lips.upperLip), lowerLip: num(lips.lowerLip), mouthWidth: num(lips.mouthWidth),
      corner: num(lips.corner), cupidsBow: num(lips.cupidsBow),
    },
    skin: {
      tone: hsl(skin.tone, d.skin.tone), blush: Math.round(clamp(num(skin.blush), 0, 100)),
      lipTint: hsl(skin.lipTint, d.skin.lipTint),
      freckles: id(skin.freckles, FRECKLE_STYLES, 'none') as SkinParams['freckles'],
    },
    hair: {
      style: id(hair.style, HAIR_STYLES, 'wavy-mid'), bangs: id(hair.bangs, BANGS, 'none'),
      color: hsl(hair.color, d.hair.color), highlight: num(hair.highlight),
      length: num(hair.length), volume: num(hair.volume), curl: num(hair.curl),
    },
    body: { shoulderWidth: num(body.shoulderWidth), neckLength: num(body.neckLength), chestDepth: num(body.chestDepth) },
    outfit: {
      top: id(outfit.top, TOPS, 'knit-round'), topColor: hsl(outfit.topColor, d.outfit.topColor),
      outer: id(outfit.outer, OUTERS, 'none'), outerColor: hsl(outfit.outerColor, d.outfit.outerColor),
    },
    accessories,
  }
}

/* ---------- 随机三档 ---------- */
export type RandomMode = 'full' | 'face' | 'tasteful'
export function randomizeV2(current: AvatarConfigV2, mode: RandomMode): AvatarConfigV2 {
  const next = structuredClone(current)
  const rand = (spread: number) => Math.round((Math.random() * 2 - 1) * spread)
  const pick = <T,>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)]
  if (mode === 'face') {
    // 只换五官，保留发色/服装/肤色
    next.face = { faceWidth: rand(40), jawWidth: rand(40), jawAngle: rand(40), chinLength: rand(30), cheekBone: rand(35), cheekFat: rand(35) }
    next.eyes = { ...next.eyes, eyeDistance: rand(30), eyeHeight: rand(24), eyeSize: rand(40), eyeTilt: rand(28), lidCrease: rand(40), smileBand: rand(50), browHeight: rand(30), browSpace: rand(24), browCurve: rand(40), browThick: rand(30) }
    next.nose = { bridge: rand(40), bridgeWidth: rand(36), tip: rand(30), ala: rand(30), noseLength: rand(28) }
    next.lips = { upperLip: rand(30), lowerLip: rand(36), mouthWidth: rand(30), corner: rand(40), cupidsBow: rand(30) }
    return next
  }
  if (mode === 'tasteful') {
    // 官方审美权重：围绕 0 的小幅扰动，款式从目录随机，颜色从色板随机
    const jitter = (spread: number) => Math.round((Math.random() * 2 - 1) * spread)
    for (const section of [next.face, next.nose] as Array<Record<string, number>>) {
      for (const key of Object.keys(section)) section[key] = jitter(18)
    }
    for (const key of ['upperLip', 'lowerLip', 'mouthWidth', 'corner', 'cupidsBow'] as const) next.lips[key] = jitter(20)
    for (const key of ['eyeDistance', 'eyeHeight', 'eyeSize', 'eyeTilt', 'lidCrease', 'smileBand', 'browHeight', 'browSpace', 'browCurve', 'browThick'] as const) next.eyes[key] = jitter(22)
    next.eyes.iris = pick(IRIS_COLORS).id
    next.hair.style = pick(HAIR_STYLES).id
    next.hair.bangs = pick(BANGS).id
    next.hair.color = { ...pick(HAIR_SWATCHES).hsl }
    next.hair.length = jitter(40); next.hair.volume = jitter(30); next.hair.curl = jitter(40); next.hair.highlight = Math.random() < .3 ? jitter(30) : 0
    next.skin.tone = { ...pick(SKIN_SWATCHES).hsl }
    next.skin.blush = 20 + Math.floor(Math.random() * 30)
    next.skin.lipTint = { ...pick(LIP_SWATCHES).hsl }
    next.outfit.top = pick(TOPS).id
    next.outfit.topColor = { ...pick(OUTFIT_SWATCHES).hsl }
    next.outfit.outer = pick(OUTERS).id
    next.outfit.outerColor = { ...pick(OUTFIT_SWATCHES).hsl }
    next.accessories = ACCESSORY_ITEMS.filter(() => Math.random() < .25).slice(0, 2).map(item => item.id)
    return next
  }
  // full：自由发挥（仍有软约束范围）
  const faceNext = randomizeV2(next, 'face')
  return randomizeV2(faceNext, 'tasteful')
}

export function isWebGLAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas')
    return !!(canvas.getContext('webgl2') || canvas.getContext('webgl'))
  } catch { return false }
}

/* ---------- 形象分享码 ---------- */
export function encodeShare(config: AvatarConfigV2): string {
  const json = JSON.stringify(config)
  const bytes = new TextEncoder().encode(json)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return 'WX2-' + btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
export function decodeShare(code: string): AvatarConfigV2 | null {
  try {
    const trimmed = code.trim()
    if (!trimmed.startsWith('WX2-')) return null
    const normalized = trimmed.slice(4).replace(/-/g, '+').replace(/_/g, '/')
    const binary = atob(normalized + '='.repeat((4 - normalized.length % 4) % 4))
    const bytes = Uint8Array.from(binary, ch => ch.charCodeAt(0))
    return coerceV2(JSON.parse(new TextDecoder().decode(bytes)))
  } catch { return null }
}

/* ---------- 旧版 v1（SVG）配置 → v2 有损迁移：老用户形象不丢 ---------- */
type V1Config = { skin?: number; hair?: string; hairColor?: number; eyes?: string; mouth?: string; blush?: string; outfit?: string; outfitColor?: number; accessory?: string }
const V1_HAIR_TO_V2: Record<string, { style: string; bangs: string; length: number; curl: number }> = {
  长直发: { style: 'long-straight', bangs: 'airy', length: 30, curl: 0 },
  短发: { style: 'short-clean', bangs: 'none', length: -20, curl: 0 },
  卷发: { style: 'curly', bangs: 'airy', length: 10, curl: 60 },
  马尾: { style: 'ponytail', bangs: 'airy', length: 10, curl: 0 },
}
const V1_OUTFIT_TO_V2: Record<string, { top: string; outer: string }> = {
  圆领: { top: 'knit-round', outer: 'none' }, 衬衫: { top: 'shirt', outer: 'none' },
  围巾: { top: 'knit-round', outer: 'none' }, 连帽: { top: 'hoodie', outer: 'none' },
}
const V1_ACCESSORY_TO_V2: Record<string, string> = { 星发夹: 'star-pin', 耳钉: 'earrings', 圆眼镜: 'glasses-round', 缎带: 'ribbon' }

export function applyV1ToV2(characterId: string | undefined, override: Partial<V1Config> | null | undefined): AvatarConfigV2 {
  const config = defaultConfigFor(characterId)
  if (!override) return config
  if (typeof (override as { version?: unknown }).version === 'number') return config
  if (override.skin != null && Number.isInteger(override.skin)) {
    config.skin.tone = { ...(SKIN_SWATCHES[override.skin % SKIN_SWATCHES.length]?.hsl ?? config.skin.tone) }
  }
  if (typeof override.hair === 'string' && V1_HAIR_TO_V2[override.hair]) {
    Object.assign(config.hair, V1_HAIR_TO_V2[override.hair])
  }
  if (override.hairColor != null && Number.isInteger(override.hairColor)) {
    const table = [HAIR_SWATCHES[0], HAIR_SWATCHES[1], HAIR_SWATCHES[2], HAIR_SWATCHES[3], HAIR_SWATCHES[4], HAIR_SWATCHES[7]]
    config.hair.color = { ...(table[override.hairColor % table.length]?.hsl ?? config.hair.color) }
  }
  if (typeof override.outfit === 'string' && V1_OUTFIT_TO_V2[override.outfit]) {
    const mapped = V1_OUTFIT_TO_V2[override.outfit]
    config.outfit.top = mapped.top
    config.outfit.outer = mapped.outer
  }
  if (override.outfitColor != null && Number.isInteger(override.outfitColor)) {
    config.outfit.topColor = { ...(OUTFIT_SWATCHES[override.outfitColor % OUTFIT_SWATCHES.length]?.hsl ?? config.outfit.topColor) }
  }
  if (typeof override.accessory === 'string') {
    const mapped = V1_ACCESSORY_TO_V2[override.accessory]
    config.accessories = mapped ? [mapped] : config.accessories
  }
  if (override.blush === '绯红') config.skin.blush = 80
  else if (override.blush === '浅浅') config.skin.blush = 40
  else if (override.blush === '无') config.skin.blush = 0
  if (override.mouth === '微笑') config.lips.corner = 30
  return config
}

/* ---------- v2 → v1（SVG）降级投影：无 WebGL 环境也能看到大致一致的形象 ---------- */
export function projectV2toV1(config: AvatarConfigV2): {
  skin: number; hair: string; hairColor: number; eyes: string; mouth: string; blush: string; outfit: string; outfitColor: number; accessory: string
} {
  const nearest = (list: Swatch[], target: HSL, fallbackIndex: number) => {
    let best = fallbackIndex, bestDistance = Infinity
    list.forEach((swatch, index) => {
      const dh = Math.min(Math.abs(swatch.hsl.h - target.h), 360 - Math.abs(swatch.hsl.h - target.h))
      const distance = dh + Math.abs(swatch.hsl.s - target.s) * .4 + Math.abs(swatch.hsl.l - target.l)
      if (distance < bestDistance) { bestDistance = distance; best = index }
    })
    return best
  }
  const styleMap: Record<string, string> = {
    'wavy-mid': '长直发', 'long-straight': '长直发', 'ponytail': '马尾', 'half-up': '马尾', 'curly': '卷发',
    'wavy-short': '卷发', 'short-clean': '短发', bob: '短发',
  }
  const outfitMap: Record<string, string> = {
    'knit-round': '圆领', turtleneck: '圆领', shirt: '衬衫', hoodie: '连帽', tee: '圆领', sweater: '围巾',
  }
  const accessoryMap: Record<string, string> = { 'star-pin': '星发夹', earrings: '耳钉', 'glasses-round': '圆眼镜', 'glasses-square': '圆眼镜', ribbon: '缎带', headphones: '缎带', scarf: '围巾', camera: '星发夹' }
  const accessory = config.accessories.map(item => accessoryMap[item]).find(Boolean) ?? '无'
  return {
    skin: nearest(SKIN_SWATCHES, config.skin.tone, 0),
    hair: styleMap[config.hair.style] ?? '长直发',
    hairColor: nearest(HAIR_SWATCHES, config.hair.color, 0),
    eyes: config.eyes.smileBand > 10 ? '弯月' : config.eyes.eyeSize > 12 ? '星星' : config.eyes.eyeTilt < -8 ? '困困' : '圆眼',
    mouth: config.lips.corner > 8 ? '微笑' : config.lips.upperLip > 6 && config.lips.lowerLip > 6 ? '小圆' : config.lips.corner < -8 ? '平直' : '微笑',
    blush: config.skin.blush > 60 ? '绯红' : config.skin.blush > 15 ? '浅浅' : '无',
    outfit: outfitMap[config.outfit.top] ?? '圆领',
    outfitColor: nearest(OUTFIT_SWATCHES, config.outfit.topColor, 0),
    accessory,
  }
}

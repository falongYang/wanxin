// S11 · Layer2D —— 2.5D 插画形象引擎（无 WebGL 依赖）
// 帧动效：眨眼（open/closed 随机切换）/ 呼吸 / 指针视差 / 说话联动（talk 帧）
// 全站头像快照：canvas 方形裁切合成 dataURL
import type { PackFrame, AvatarPack, AvatarConfigV3 } from './avatar-packs'
import { expressionFrame } from './avatar-packs'

export type AtmosphereKey = 'night' | 'morning' | 'sakura' | 'cream' | 'mint'

/** 主题氛围滤镜（作用于人物层，不影响页面底色） */
const ATMOSPHERES: Record<AtmosphereKey, string> = {
  night: 'none',
  morning: 'sepia(.14) saturate(1.05)',
  sakura: 'saturate(1.04) hue-rotate(-4deg)',
  cream: 'sepia(.1) saturate(1.06)',
  mint: 'hue-rotate(3deg) saturate(1.02)',
}

export interface Layer2DOptions {
  pack: AvatarPack
  config: AvatarConfigV3
  atmosphere?: AtmosphereKey
  reducedMotion?: boolean
  /** 指针视差幅度（px），0 关闭 */
  parallax?: number
}

export class Layer2D {
  private container: HTMLElement
  private options: Layer2DOptions
  private frameImg!: HTMLImageElement
  private closedImg!: HTMLImageElement
  private figure!: HTMLDivElement
  private blinkTimer: ReturnType<typeof setTimeout> | null = null
  private talking = false
  private raf = 0
  private disposed = false
  private loaded = new Set<PackFrame>()
  private currentFrame: PackFrame = 'open'

  constructor(container: HTMLElement, options: Layer2DOptions) {
    this.container = container
    this.options = options
    container.classList.add('av25-stage')
    this.build()
  }

  private build() {
    this.figure = document.createElement('div')
    this.figure.className = 'av25-figure' + (this.options.reducedMotion ? '' : ' av25-breathe')
    const { frames } = this.options.pack
    this.frameImg = this.loadFrame(expressionFrame(this.options.config), frames[expressionFrame(this.options.config)])
    this.closedImg = this.loadFrame('closed', frames.closed)
    this.closedImg.classList.add('av25-blink-frame')
    this.figure.append(this.frameImg, this.closedImg)
    this.container.append(this.figure)
    this.applyAtmosphere(this.options.atmosphere ?? 'night')
    if (!this.options.reducedMotion) {
      this.scheduleBlink()
      if (this.options.parallax !== 0) this.attachParallax()
    }
  }

  private loadFrame(frame: PackFrame, src: string) {
    const img = document.createElement('img')
    img.className = 'av25-frame'
    img.alt = ''
    img.draggable = false
    img.src = src
    img.addEventListener('load', () => this.loaded.add(frame), { once: true })
    return img
  }

  private scheduleBlink() {
    if (this.disposed) return
    this.blinkTimer = setTimeout(() => {
      if (this.disposed) return
      this.container.classList.add('av25-blinking')
      setTimeout(() => {
        if (this.disposed) return
        this.container.classList.remove('av25-blinking')
        this.scheduleBlink()
      }, 130)
    }, 2200 + Math.random() * 3600)
  }

  private attachParallax() {
    const range = this.options.parallax ?? 8
    const onMove = (event: PointerEvent) => {
      const rect = this.container.getBoundingClientRect()
      const dx = (event.clientX - rect.left) / rect.width - .5
      const dy = (event.clientY - rect.top) / rect.height - .5
      this.figure.style.translate = `${(dx * -range).toFixed(1)}px ${(dy * -range * .55).toFixed(1)}px`
      this.figure.style.rotate = `${(dx * 1.2).toFixed(2)}deg`
    }
    const onLeave = () => {
      this.figure.style.translate = '0 0'
      this.figure.style.rotate = '0deg'
    }
    this.container.addEventListener('pointermove', onMove)
    this.container.addEventListener('pointerleave', onLeave)
    this.cleanupParallax = () => {
      this.container.removeEventListener('pointermove', onMove)
      this.container.removeEventListener('pointerleave', onLeave)
    }
  }
  private cleanupParallax: () => void = () => {}

  /** 表情切换：calm → open / smile → smile（说话状态下记忆并稍后应用） */
  setExpression(config: AvatarConfigV3) {
    this.options.config = config
    if (!this.talking) this.show(expressionFrame(config))
  }

  /** 聊天说话联动：true 切 talk 帧，false 回表情帧 */
  setTalking(talking: boolean) {
    this.talking = talking
    this.show(talking ? 'talk' : expressionFrame(this.options.config))
  }

  setAtmosphere(key: AtmosphereKey) {
    this.options.atmosphere = key
    this.applyAtmosphere(key)
  }

  private applyAtmosphere(key: AtmosphereKey) {
    this.figure.style.filter = ATMOSPHERES[key] ?? 'none'
  }

  private show(frame: PackFrame) {
    if (this.currentFrame === frame) return
    this.currentFrame = frame
    const src = this.options.pack.frames[frame]
    if (this.frameImg.src !== new URL(src, location.href).href) this.frameImg.src = src
  }

  /** 方形头像快照：取立绘上半身居中裁切 */
  snapshot(size = 256): string | null {
    const source = this.frameImg
    if (!source.naturalWidth) return null
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    const w = source.naturalWidth, h = source.naturalHeight
    // 裁切窗：宽 = 原宽，高 = 原宽（正方形），纵向取头部区域（上留 4%，人物主体在上半）
    const cropY = Math.round(h * 0.04)
    const cropH = Math.min(h - cropY, w)
    ctx.drawImage(source, 0, cropY, w, cropH, 0, 0, size, size)
    return canvas.toDataURL('image/png')
  }

  /** 等待当前帧加载完成（保存/快照前调用） */
  ready(): Promise<void> {
    if (this.frameImg.complete) return Promise.resolve()
    return new Promise(resolve => {
      this.frameImg.addEventListener('load', () => resolve(), { once: true })
      this.frameImg.addEventListener('error', () => resolve(), { once: true })
    })
  }

  dispose() {
    this.disposed = true
    if (this.blinkTimer) clearTimeout(this.blinkTimer)
    cancelAnimationFrame(this.raf)
    this.cleanupParallax()
    this.container.classList.remove('av25-stage', 'av25-blinking')
    this.figure.remove()
  }
}

/* ---------- 快照合成（全站头像，无需挂载编辑器实例） ---------- */

const snapshotCache = new Map<string, string>()

/** 从造型包素材直接合成方形头像快照（玄关/聊天/朋友圈通用） */
export function renderPackSnapshot(pack: AvatarPack, config: AvatarConfigV3, size = 256, atmosphere: AtmosphereKey = 'night'): Promise<string> {
  const frame = expressionFrame(config)
  const key = pack.id + ':' + frame + ':' + size + ':' + atmosphere
  const cached = snapshotCache.get(key)
  if (cached) return Promise.resolve(cached)
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const ctx = canvas.getContext('2d')
      if (!ctx) return resolve('')
      const w = img.naturalWidth, h = img.naturalHeight
      const cropY = Math.round(h * 0.04)
      const cropH = Math.min(h - cropY, w)
      ctx.filter = ATMOSPHERES[atmosphere] !== 'none' ? ATMOSPHERES[atmosphere] : 'none'
      ctx.drawImage(img, 0, cropY, w, cropH, 0, 0, size, size)
      const url = canvas.toDataURL('image/png')
      snapshotCache.set(key, url)
      resolve(url)
    }
    img.onerror = () => resolve('')
    img.src = pack.frames[frame]
  })
}

// S11 素材白底抠除管线：docs/design/stage11/*.png → public/avatar-packs/ 透明 PNG
// 用法：node scripts/assets/cutout-stage11.mjs
import { PNG } from 'pngjs'
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { join, basename } from 'node:path'

const SRC = 'docs/design/stage11'
const OUT = 'public/avatar-packs'
const TARGET_WIDTH = 720
// 白色判定：RGB 各通道 >= 242 视为白底候选
const WHITE = 242

function loadPng(file) {
  return PNG.sync.read(readFileSync(file))
}

// flood-fill from 边缘：只清除与画面边缘连通的白色区域（保护角色内部白色服装）
function cutoutWhite(png) {
  const { width: w, height: h, data } = png
  const visited = new Uint8Array(w * h)
  const queue = []
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return
    const p = y * w + x
    if (visited[p]) return
    const i = p * 4
    if (data[i] >= WHITE && data[i + 1] >= WHITE && data[i + 2] >= WHITE) {
      visited[p] = 1
      queue.push(p)
    }
  }
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1) }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y) }
  while (queue.length) {
    const p = queue.pop()
    const x = p % w, y = (p - x) / w
    push(x - 1, y); push(x + 1, y); push(x, y - 1); push(x, y + 1)
  }
  // 被标记的边缘白区 → 透明
  for (let p = 0; p < w * h; p++) {
    if (visited[p]) data[p * 4 + 3] = 0
  }
  // 边缘收缩：清除与透明像素相邻的近白像素（去白边）
  const shrink = []
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x
      if (data[p * 4 + 3] === 0) continue
      const nearTransparent =
        (x > 0 && data[(p - 1) * 4 + 3] === 0) || (x < w - 1 && data[(p + 1) * 4 + 3] === 0) ||
        (y > 0 && data[(p - w) * 4 + 3] === 0) || (y < h - 1 && data[(p + w) * 4 + 3] === 0)
      if (nearTransparent && data[p * 4] >= 232 && data[p * 4 + 1] >= 232 && data[p * 4 + 2] >= 232) shrink.push(p)
    }
  }
  for (const p of shrink) data[p * 4 + 3] = 0
  return png
}

function scaleTo(png, targetWidth) {
  const { width: w, height: h } = png
  if (w <= targetWidth) return png
  const nw = targetWidth, nh = Math.round(h * (nw / w))
  const out = new PNG({ width: nw, height: nh })
  for (let y = 0; y < nh; y++) {
    for (let x = 0; x < nw; x++) {
      // 最近邻采样（插画硬边缘，最近邻可接受）
      const sx = Math.min(w - 1, Math.floor(x * w / nw))
      const sy = Math.min(h - 1, Math.floor(y * h / nh))
      const si = (sy * w + sx) * 4, di = (y * nw + x) * 4
      out.data[di] = png.data[si]
      out.data[di + 1] = png.data[si + 1]
      out.data[di + 2] = png.data[si + 2]
      out.data[di + 3] = png.data[si + 3]
    }
  }
  return out
}

mkdirSync(OUT, { recursive: true })
const files = readdirSync(SRC).filter(f => f.endsWith('.png'))
let total = 0
for (const file of files) {
  let png = loadPng(join(SRC, file))
  png = cutoutWhite(png)
  png = scaleTo(png, TARGET_WIDTH)
  const out = join(OUT, basename(file))
  writeFileSync(out, PNG.sync.write(png))
  const kb = Math.round(statSync(out).size / 1024)
  console.log(`${file} -> ${kb}KB`)
  total++
}
console.log(`done: ${total} files`)

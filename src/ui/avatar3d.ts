// 捏捏形象 3D 引擎：全程序化参数化人像（半身），无外部素材。
// 依赖 three.js（MIT，体积较大，经动态 import 按需加载）。对外暴露：AvatarEngine / renderSnapshot。
// isWebGLAvailable 与类型定义在 avatar-catalog.ts / avatar3d 类型层，避免主包引入 three。
import * as THREE from 'three'
import {
  clamp, hslToHex, type AvatarConfigV2, type HSL, IRIS_HEX,
} from './avatar-catalog'

/* ---------- 小工具 ---------- */
const gauss = (x: number, mu: number, sigma: number) => Math.exp(-((x - mu) ** 2) / (2 * sigma * sigma))
const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = clamp((x - edge0) / (edge1 - edge0 || 1), 0, 1)
  return t * t * (3 - 2 * t)
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const hash2 = (x: number, y: number) => {
  const value = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453
  return value - Math.floor(value)
}
const darken = (hex: string, factor: number) => {
  const color = new THREE.Color(hex)
  return '#' + color.lerp(new THREE.Color('#241a12'), 1 - factor).getHexString()
}
const lighten = (hex: string, amount: number) => {
  const color = new THREE.Color(hex)
  return '#' + color.lerp(new THREE.Color('#ffffff'), amount).getHexString()
}
const hsl = (value: HSL) => new THREE.Color(hslToHex(value))

export type PickRegion = 'face' | 'eyes' | 'nose' | 'lips' | 'hair' | 'outfit' | 'accessory'
export type EngineTheme = 'night' | 'morning' | 'sakura' | 'cream' | 'mint'
type Lighting = {
  key: [string, number, THREE.Vector3]; fill: [string, number, THREE.Vector3]; rim: [string, number, THREE.Vector3]
  hemi: [string, string, number]
}
const THEME_LIGHTS: Record<EngineTheme, Lighting> = {
  night: {
    key: ['#ffe9c9', 1.85, new THREE.Vector3(1.6, 1.9, 2.4)], fill: ['#a9bfec', .5, new THREE.Vector3(-2.2, .4, 1.6)],
    rim: ['#d9bc84', 1.0, new THREE.Vector3(-.7, 1.4, -2.4)], hemi: ['#22314f', '#0a0f1c', .7],
  },
  morning: {
    key: ['#fff3dc', 2.0, new THREE.Vector3(1.6, 2, 2.4)], fill: ['#cfe0ef', .55, new THREE.Vector3(-2.2, .5, 1.8)],
    rim: ['#ffe8bd', .65, new THREE.Vector3(-.8, 1.4, -2.4)], hemi: ['#e8e2d2', '#b7a98c', .85],
  },
  sakura: {
    key: ['#ffe4ea', 1.8, new THREE.Vector3(1.6, 1.9, 2.4)], fill: ['#d9a8c4', .55, new THREE.Vector3(-2.2, .5, 1.6)],
    rim: ['#f2b7c8', .95, new THREE.Vector3(-.7, 1.4, -2.4)], hemi: ['#4a2a42', '#170f18', .68],
  },
  cream: {
    key: ['#ffedd2', 1.9, new THREE.Vector3(1.6, 2, 2.4)], fill: ['#e8d8bf', .55, new THREE.Vector3(-2.2, .5, 1.8)],
    rim: ['#e8b98a', .75, new THREE.Vector3(-.8, 1.4, -2.4)], hemi: ['#f6efe3', '#c9b694', .9],
  },
  mint: {
    key: ['#f8f2e4', 1.9, new THREE.Vector3(1.6, 2, 2.4)], fill: ['#bfe8de', .55, new THREE.Vector3(-2.2, .5, 1.8)],
    rim: ['#7fd8c6', .85, new THREE.Vector3(-.8, 1.4, -2.4)], hemi: ['#f0f2e4', '#c9b8a8', .9],
  },
}

/* ---------- 发丝 / 织物纹理（Canvas 程序生成，避免外部图片） ---------- */
function strandTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 128; canvas.height = 128
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 128, 128)
  for (let i = 0; i < 46; i++) {
    const x = Math.random() * 128
    ctx.strokeStyle = Math.random() < .5 ? 'rgba(0,0,0,.16)' : 'rgba(255,255,255,.18)'
    ctx.lineWidth = .6 + Math.random() * 1.6
    ctx.beginPath()
    ctx.moveTo(x, -4)
    ctx.bezierCurveTo(x + (Math.random() * 10 - 5), 42, x + (Math.random() * 10 - 5), 86, x + (Math.random() * 8 - 4), 132)
    ctx.stroke()
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(3, 2)
  return texture
}
function knitTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 64; canvas.height = 64
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 64, 64)
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    ctx.strokeStyle = 'rgba(0,0,0,.13)'
    ctx.lineWidth = 2.4
    ctx.beginPath()
    ctx.arc(x * 8 + 4, y * 8 + 4, 3.2, Math.PI * .15, Math.PI * .85)
    ctx.stroke()
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(7, 5)
  return texture
}

/* ---------- 头部形变：单位球 → 参数化头型 ---------- */
type HeadPicks = {
  faceWidth: number; jawWidth: number; jawAngle: number; chinLength: number; cheekBone: number; cheekFat: number
  bridge: number; bridgeWidth: number; tip: number; ala: number; noseLength: number
  eyeDistance: number; eyeHeight: number; eyeSize: number
}
const SKULL = { rx: 0.74, ry: 0.96, rz: 0.80 }

function headPoint(nx: number, ny: number, nz: number, p: HeadPicks): THREE.Vector3 {
  let x = nx * SKULL.rx * (1 + p.faceWidth * 0.0018)
  let y = ny * SKULL.ry
  let z = nz * SKULL.rz
  const taperT = clamp((0.06 - ny) / 1.06, 0, 1)
  x *= lerp(1, 0.60 + p.jawWidth * 0.0018, Math.pow(taperT, 1.5))
  z *= lerp(1, 0.9, Math.pow(taperT, 1.7))
  const jawCorner = gauss(ny, -0.36, 0.20) * clamp(nz + .25, 0, 1)
  x *= 1 + p.jawAngle * 0.0016 * jawCorner
  if (y < -0.42) {
    const c = clamp((-0.42 - y) / 0.54, 0, 1)
    y -= p.chinLength * 0.0016 * c
    const point = clamp((-y - 0.62) / 0.34, 0, 1)
    x *= 1 - 0.28 * point
    z *= 1 - 0.22 * point
  }
  const cheek = gauss(ny, 0.02, 0.15) * gauss(nz, 0.42, 0.34)
  x += Math.sign(nx) * p.cheekBone * 0.0016 * cheek
  z += p.cheekBone * 0.0006 * cheek
  const fat = gauss(ny, -0.30, 0.17) * gauss(nz, 0.40, 0.36)
  x += Math.sign(nx) * p.cheekFat * 0.0012 * fat
  z += p.cheekFat * 0.0008 * fat
  const span = 0.42 * (1 + p.noseLength * 0.0010)
  const ridgeU = (0.26 - ny) / span
  if (ridgeU > -0.08 && ridgeU < 1.12) {
    const ridge = Math.sin(Math.PI * clamp(ridgeU, 0, 1))
    const lateral = gauss(Math.abs(nx), 0, 0.075 + p.bridgeWidth * 0.00030) * clamp(nz, 0, 1)
    // 基础鼻型 + 参数微调：bridge=0 也有自然鼻梁，避免「没鼻子」
    z += Math.max(0.010, 0.075 + p.bridge * 0.0009) * ridge * lateral
    const tipG = gauss(ny, 0.26 - span * 0.82, 0.08) * gauss(nx, 0, 0.080)
    z += Math.max(0.04, 0.19 + p.tip * 0.0012) * tipG
    const wingG = gauss(ny, 0.26 - span * 0.74, 0.06) * gauss(Math.abs(nx), 0.05, 0.055)
    x += Math.sign(nx) * (0.030 + p.ala * 0.0005) * wingG
    z += (0.014 + p.ala * 0.00025) * wingG
    // 鼻下小阴影凹陷：紧贴鼻头底边的窄缝
    z -= 0.008 * gauss(ny, 0.26 - span * 0.82 + 0.085, 0.04) * gauss(nx, 0, 0.09) * clamp(nz, 0, 1)
  }
  // 眉骨：轻微凸起，让额头到眼窝有过渡
  z += 0.014 * gauss(ny, 0.40, 0.11) * gauss(nx, 0, 0.52) * clamp(nz, 0, 1)
  const ex = 0.205 + p.eyeDistance * 0.0010
  const ey = 0.10 + p.eyeHeight * 0.0009
  const socket = Math.min(1, gauss(nx, ex, 0.13) + gauss(nx, -ex, 0.13))
  z -= (0.02 + p.eyeSize * 0.00008) * gauss(ny, ey, 0.13) * clamp(nz, 0, 1) * socket
  return new THREE.Vector3(x, y, z)
}

function headGeometry(p: HeadPicks): THREE.BufferGeometry {
  const geometry = new THREE.SphereGeometry(1, 64, 48)
  const position = geometry.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < position.count; i++) {
    const nx = position.getX(i), ny = position.getY(i), nz = position.getZ(i)
    const point = headPoint(nx, ny, nz, p)
    position.setXYZ(i, point.x, point.y, point.z)
  }
  position.needsUpdate = true
  geometry.computeVertexNormals()
  return geometry
}

/* ---------- 参数曲面工具 ---------- */
function paramSurface(fn: (u: number, v: number) => THREE.Vector3, uSeg: number, vSeg: number): THREE.BufferGeometry {
  const positions: number[] = [], indices: number[] = [], uvs: number[] = []
  for (let iv = 0; iv <= vSeg; iv++) for (let iu = 0; iu <= uSeg; iu++) {
    const point = fn(iu / uSeg, iv / vSeg)
    positions.push(point.x, point.y, point.z)
    uvs.push(iu / uSeg, iv / vSeg)
  }
  for (let iv = 0; iv < vSeg; iv++) for (let iu = 0; iu < uSeg; iu++) {
    const a = iv * (uSeg + 1) + iu, b = a + 1, c = a + uSeg + 1, d = c + 1
    indices.push(a, c, b, b, c, d)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

/** 沿折线扫掠的变半径管（发型束 / 挂绳等） */
function tubeAlong(points: THREE.Vector3[], radii: number[], radialSegments = 8): THREE.BufferGeometry {
  const positions: number[] = [], indices: number[] = []
  const rings = points.length
  for (let i = 0; i < rings; i++) {
    const prev = points[Math.max(0, i - 1)], next = points[Math.min(rings - 1, i + 1)]
    const tangent = next.clone().sub(prev).normalize()
    const side = Math.abs(tangent.y) > .9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)
    const binormal = new THREE.Vector3().crossVectors(tangent, side).normalize()
    const normal = new THREE.Vector3().crossVectors(binormal, tangent).normalize()
    const r = radii[Math.min(i, radii.length - 1)]
    for (let s = 0; s <= radialSegments; s++) {
      const angle = (s / radialSegments) * Math.PI * 2
      const point = points[i].clone()
        .addScaledVector(binormal, Math.cos(angle) * r)
        .addScaledVector(normal, Math.sin(angle) * r)
      positions.push(point.x, point.y, point.z)
    }
  }
  for (let i = 0; i < rings - 1; i++) for (let s = 0; s < radialSegments; s++) {
    const a = i * (radialSegments + 1) + s, b = a + 1, c = a + radialSegments + 1, d = c + 1
    indices.push(a, c, b, b, c, d)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

/* ---------- 头发构建 ---------- */
const HAIR_SKULL = { x: 0.775, y: 1.0, z: 0.845 }

function hairCap(material: THREE.Material, frontLine: number, backLine: number): THREE.Mesh {
  const uSeg = 44, vSeg = 18
  const geometry = paramSurface((u, v) => {
    const phi = u * Math.PI * 2
    const dirX = Math.sin(phi), dirZ = Math.cos(phi)
    const frontness = smoothstep(-0.25, 0.65, dirZ)
    const lineY = lerp(backLine, frontLine, frontness)
    const thetaMax = Math.acos(clamp(lineY, -1, 1))
    const theta = v * (thetaMax + 0.06)
    const thetaClamped = Math.min(theta, thetaMax)
    const shell = lerp(1.075, 1.018, smoothstep(0, thetaMax, thetaClamped)) + v * 0.010
    const y = Math.cos(thetaClamped) * HAIR_SKULL.y * shell
    const radial = Math.sin(thetaClamped) * shell
    const noise = (hash2(phi * 23.7, thetaClamped * 31.3) - 0.5) * 0.014 * smoothstep(0.4, 1.2, thetaClamped)
    return new THREE.Vector3(dirX * HAIR_SKULL.x * radial * (1 + noise), y, dirZ * HAIR_SKULL.z * radial * (1 + noise))
  }, uSeg, vSeg)
  return new THREE.Mesh(geometry, material)
}

function hairBand(material: THREE.Material, phiFrom: number, phiTo: number, cutAt: (phi: number) => number, topY = 0.62): THREE.Mesh {
  const geometry = paramSurface((u, v) => {
    const phi = lerp(phiFrom, phiTo, u)
    const cut = cutAt(phi)
    const y = lerp(topY, cut, v)
    const shell = 1.012 + v * 0.05 + (hash2(u * 41.3, v * 29.7) - 0.5) * 0.02
    const dirX = Math.sin(phi), dirZ = Math.cos(phi)
    const shrink = smoothstep(0.55, 0.62, y) * 0.06
    const rx = HAIR_SKULL.x * (shell - shrink), rz = HAIR_SKULL.z * (shell - shrink)
    const ny = y / HAIR_SKULL.y
    const planar = Math.sqrt(Math.max(0.02, 1 - ny * ny))
    return new THREE.Vector3(dirX * rx * planar, y, dirZ * rz * planar)
  }, 22, 8)
  return new THREE.Mesh(geometry, material)
}

function backShell(material: THREE.Material, options: { top: number; drop: number; outR: number; curl: number; volume: number; tuck?: boolean }): THREE.Mesh {
  const { top, drop, outR, curl, volume } = options
  const profile: THREE.Vector2[] = [
    new THREE.Vector2(0.56, top), new THREE.Vector2(0.66, top - 0.22),
    new THREE.Vector2(outR * (1 + volume * 0.0009), top - drop * 0.55),
    new THREE.Vector2(outR * (0.96 + volume * 0.0006), top - drop * 0.86),
    new THREE.Vector2(outR * (options.tuck ? 0.7 : 0.9), top - drop),
  ]
  const geometry = new THREE.LatheGeometry(profile, 34, Math.PI * 0.62, Math.PI * 0.76)
  const position = geometry.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), y = position.getY(i), z = position.getZ(i)
    const t = clamp((top - y) / Math.max(0.2, drop), 0, 1)
    const wave = Math.sin(y * 7.5 + Math.atan2(x, z) * 2) * curl * 0.0011 * t
    const scale = 1 + wave
    position.setXYZ(i, x * HAIR_SKULL.x * 1.06 * scale, y, z * HAIR_SKULL.z * 1.06 * scale)
  }
  position.needsUpdate = true
  geometry.computeVertexNormals()
  return new THREE.Mesh(geometry, material)
}

function sideStrand(material: THREE.Material, side: number, from: THREE.Vector3, to: THREE.Vector3, r0: number, r1: number): THREE.Mesh {
  const mid = from.clone().lerp(to, 0.55).add(new THREE.Vector3(side * 0.05, 0.02, -0.06))
  const geometry = tubeAlong([from, mid, to], [r0, (r0 + r1) / 2, r1], 7)
  return new THREE.Mesh(geometry, material)
}

function buildHair(config: AvatarConfigV2, material: THREE.Material): { group: THREE.Group; swayTargets: THREE.Object3D[] } {
  const group = new THREE.Group()
  const swayTargets: THREE.Object3D[] = []
  const { style, bangs, length, volume, curl } = config.hair
  const drop = (base: number) => base + length * 0.005
  const lineFront = bangs === 'full' ? 0.54 : 0.50
  let capFront = lineFront, capBack = -0.08
  const addShell = (options: Parameters<typeof backShell>[1]) => {
    const shell = backShell(material, options)
    group.add(shell); swayTargets.push(shell)
  }
  const addStrands = (toY: number, r = 0.05) => {
    for (const side of [-1, 1]) {
      const strand = sideStrand(material, side, new THREE.Vector3(side * 0.60, 0.42, 0.44), new THREE.Vector3(side * 0.70, toY, 0.28), r, r * 0.6)
      group.add(strand)
    }
  }
  switch (style) {
    case 'short-clean':
      capBack = 0.02
      group.add(hairCap(material, capFront, capBack))
      addShell({ top: 0.36, drop: drop(0.34), outR: 0.78, curl: curl * 0.3, volume: volume * 0.6 })
      break
    case 'wavy-short':
      capBack = -0.02
      group.add(hairCap(material, capFront, capBack))
      addShell({ top: 0.40, drop: drop(0.6), outR: 0.86, curl: curl * 0.5, volume })
      addStrands(-0.30, 0.045)
      break
    case 'long-straight':
      capBack = -0.12
      group.add(hairCap(material, capFront, capBack))
      addShell({ top: 0.42, drop: drop(1.85), outR: 0.98, curl: curl * 0.6, volume })
      addStrands(-0.85)
      break
    case 'ponytail': {
      capBack = -0.06
      group.add(hairCap(material, capFront, capBack))
      addShell({ top: 0.38, drop: drop(0.5), outR: 0.9, curl: 0, volume })
      const tie = new THREE.Mesh(new THREE.TorusGeometry(0.10, 0.035, 8, 16), material)
      tie.position.set(0, 0.40, -0.80); tie.rotation.x = Math.PI / 2 + 0.35
      group.add(tie)
      const tailDrop = 0.9 + length * 0.005
      const tail = new THREE.Mesh(tubeAlong([
        new THREE.Vector3(0, 0.40, -0.86), new THREE.Vector3(0, -0.02, -1.06),
        new THREE.Vector3(0, -0.5 - tailDrop * 0.3, -0.98), new THREE.Vector3(0, -0.85 - tailDrop * 0.6, -0.74),
      ], [0.235, 0.20, 0.135, 0.07], 9), material)
      group.add(tail); swayTargets.push(tail)
      addStrands(-0.30)
      break
    }
    case 'half-up': {
      capBack = -0.10
      group.add(hairCap(material, capFront, capBack))
      const bun = new THREE.Mesh(new THREE.SphereGeometry(0.19, 18, 14), material)
      bun.scale.set(1, 0.78, 0.92); bun.position.set(0, 0.66, -0.42)
      group.add(bun)
      const tie = new THREE.Mesh(new THREE.TorusGeometry(0.105, 0.028, 8, 16), material)
      tie.position.set(0, 0.52, -0.46); tie.rotation.x = 1.15
      group.add(tie)
      addShell({ top: 0.42, drop: drop(1.15), outR: 0.95, curl: curl * 0.7, volume })
      addStrands(-0.72)
      break
    }
    case 'bob':
      capBack = -0.20
      group.add(hairCap(material, capFront, capBack))
      addShell({ top: 0.44, drop: drop(0.78), outR: 1.0, curl: curl * 0.4, volume: volume + 8, tuck: true })
      addStrands(-0.52, 0.055)
      break
    case 'curly': {
      capBack = -0.04
      const cap = hairCap(material, capFront, capBack)
      const position = cap.geometry.attributes.position as THREE.BufferAttribute
      for (let i = 0; i < position.count; i++) {
        const x = position.getX(i), y = position.getY(i), z = position.getZ(i)
        const bump = (hash2(x * 40, z * 40) - 0.5) * smoothstep(0.3, -0.1, y) * 0.085
        const scale = 1 + bump
        position.setXYZ(i, x * scale, y, z * scale)
      }
      position.needsUpdate = true; cap.geometry.computeVertexNormals()
      group.add(cap)
      for (let i = 0; i < 10; i++) {
        const phi = (i / 10) * Math.PI * 2
        const puff = new THREE.Mesh(new THREE.SphereGeometry(0.13 + hash2(i, 3) * 0.05, 12, 10), material)
        puff.position.set(Math.sin(phi) * 0.74, 0.02 - hash2(i, 7) * 0.3, Math.cos(phi) * 0.74 * (Math.cos(phi) < 0 ? 1 : 0.35))
        group.add(puff)
      }
      addShell({ top: 0.34, drop: drop(0.55), outR: 0.92, curl: 30, volume: volume + 10 })
      break
    }
    default: // wavy-mid
      capBack = -0.10
      group.add(hairCap(material, capFront, capBack))
      addShell({ top: 0.42, drop: drop(1.05), outR: 0.92, curl, volume })
  }
  // 刘海
  const bangsGroup = new THREE.Group()
  if (bangs === 'full') {
    bangsGroup.add(hairBand(material, -1.05, 1.05, phi => 0.15 + 0.022 * Math.cos(phi * 2) + Math.max(0, length) * 0.0004))
  } else if (bangs === 'airy') {
    const cuts = [0.22, 0.27, 0.21]
    for (const [index, range] of [[-0.52, -0.30], [-0.11, 0.11], [0.30, 0.52]].entries()) {
      const band = hairBand(material, range[0], range[1], phi => cuts[index] + 0.05 * Math.cos(phi * 3) + 0.022 * Math.sin(phi * 7.3) + 0.02 * Math.sin(phi * 31) + 0.012 * Math.sin(phi * 53))
      bangsGroup.add(band); swayTargets.push(band)
    }
  } else if (bangs === 'curtain') {
    for (const side of [-1, 1]) {
      const band = hairBand(material, side < 0 ? -1.35 : 0.30, side < 0 ? -0.30 : 1.35, phi => {
        const t = smoothstep(0.30, 1.35, Math.abs(phi))
        return lerp(0.34, 0.04 + Math.max(0, length) * 0.0003, t)
      })
      bangsGroup.add(band)
    }
  }
  group.add(bangsGroup)
  if (config.hair.highlight > 0) {
    const highlightMat = material.clone()
    ;(highlightMat as THREE.MeshStandardMaterial).color = hsl(config.hair.color).lerp(new THREE.Color('#f4e6c8'), config.hair.highlight * 0.004)
    for (const side of [-1, 1]) {
      const strand = sideStrand(highlightMat, side, new THREE.Vector3(side * 0.5, 0.55, 0.5), new THREE.Vector3(side * 0.62, 0.0, 0.35), 0.022, 0.012)
      group.add(strand)
    }
  }
  return { group, swayTargets }
}

/* ---------- 五官与身体 ---------- */
type AvatarParts = {
  root: THREE.Group
  head: THREE.Group
  headMesh: THREE.Mesh
  eyeGroups: { group: THREE.Group; gaze: THREE.Group; lid: THREE.Object3D; smileBand: THREE.Object3D }[]
  brows: THREE.Object3D[]
  browMaterial: THREE.MeshStandardMaterial
  lashMaterial: THREE.MeshStandardMaterial
  lipGroup: THREE.Group
  mouthLine: THREE.Mesh
  hair: THREE.Group
  hairSway: THREE.Object3D[]
  bust: THREE.Group
  glasses: THREE.Group | null
  freckles: THREE.InstancedMesh | null
  blushDiscs: THREE.Mesh[]
  skinMaterial: THREE.MeshStandardMaterial
  hairMaterial: THREE.MeshStandardMaterial
  lipMaterial: THREE.MeshStandardMaterial
  outfitMaterials: THREE.MeshStandardMaterial[]
  headBaseP: HeadPicks
}

const disposeDeep = (object: THREE.Object3D) => {
  object.traverse(node => {
    const mesh = node as THREE.Mesh
    if (mesh.geometry) mesh.geometry.dispose()
    const material = (mesh as unknown as { material?: THREE.Material | THREE.Material[] }).material
    if (Array.isArray(material)) material.forEach(item => item.dispose())
    else if (material) material.dispose()
  })
}

function garmentLathe(color: THREE.Color, texture: THREE.CanvasTexture, scaleR = 1, yOffset = 0): THREE.Mesh {
  const profile: THREE.Vector2[] = [
    new THREE.Vector2(0.34, 0.30 + yOffset), new THREE.Vector2(0.46, 0.24 + yOffset),
    new THREE.Vector2(0.76, 0.02 + yOffset), new THREE.Vector2(1.06 * scaleR, -0.12 + yOffset),
    new THREE.Vector2(1.22 * scaleR, -0.42 + yOffset), new THREE.Vector2(1.13 * scaleR, -0.68 + yOffset),
    new THREE.Vector2(1.02 * scaleR, -1.05 + yOffset),
    new THREE.Vector2(0.60 * scaleR, -1.06 + yOffset),
  ]
  const material = new THREE.MeshStandardMaterial({ color, roughness: .78, metalness: .02, side: THREE.DoubleSide, map: texture })
  const mesh = new THREE.Mesh(new THREE.LatheGeometry(profile, 44), material)
  mesh.scale.set(1, 1, 0.86)
  return mesh
}

function roundedRectShape(w: number, h: number, r: number): THREE.Shape {
  const shape = new THREE.Shape()
  shape.moveTo(-w / 2 + r, -h / 2)
  shape.lineTo(w / 2 - r, -h / 2)
  shape.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r)
  shape.lineTo(w / 2, h / 2 - r)
  shape.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2)
  shape.lineTo(-w / 2 + r, h / 2)
  shape.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r)
  shape.lineTo(-w / 2, -h / 2 + r)
  shape.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2)
  return shape
}

function starShape(radius: number): THREE.Shape {
  const shape = new THREE.Shape()
  for (let i = 0; i < 10; i++) {
    const angle = (i / 10) * Math.PI * 2 - Math.PI / 2
    const r = i % 2 === 0 ? radius : radius * 0.42
    const x = Math.cos(angle) * r, y = Math.sin(angle) * r
    if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y)
  }
  shape.closePath()
  return shape
}

function buildBust(config: AvatarConfigV2, skinMaterial: THREE.MeshStandardMaterial, knit: THREE.CanvasTexture, materials: THREE.MeshStandardMaterial[]): THREE.Group {
  const group = new THREE.Group()
  const { top, outer } = config.outfit
  const shoulder = 1 + config.body.shoulderWidth * 0.0009
  const topColor = hsl(config.outfit.topColor)
  const outerColor = hsl(config.outfit.outerColor)
  const chest = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), skinMaterial)
  chest.scale.set(0.33, 0.28, 0.24); chest.position.set(0, 0.32, 0.02)
  group.add(chest)
  const topMesh = garmentLathe(topColor, knit, shoulder)
  group.add(topMesh); materials.push(topMesh.material as THREE.MeshStandardMaterial)
  if (top === 'turtleneck') {
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.345, 0.375, 0.5, 20), new THREE.MeshStandardMaterial({ color: topColor, roughness: .82 }))
    collar.position.set(0, 0.32, 0)
    group.add(collar); materials.push(collar.material as THREE.MeshStandardMaterial)
    const fold = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.032, 8, 22), (collar.material as THREE.MeshStandardMaterial))
    fold.rotation.x = Math.PI / 2; fold.position.set(0, 0.55, 0)
    group.add(fold)
  } else if (top === 'hoodie') {
    const hood = new THREE.Mesh(new THREE.SphereGeometry(0.5, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.55),
      new THREE.MeshStandardMaterial({ color: topColor, roughness: .82, side: THREE.DoubleSide }))
    hood.scale.set(1.12, 0.78, 0.9); hood.position.set(0, 0.36, -0.30); hood.rotation.x = -0.55
    group.add(hood); materials.push(hood.material as THREE.MeshStandardMaterial)
    const stringMaterial = new THREE.MeshStandardMaterial({ color: topColor.clone().lerp(new THREE.Color('#8a6423'), .35), roughness: .8 })
    for (const side of [-1, 1]) {
      const string = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.34, 8), stringMaterial)
      string.position.set(side * 0.09, 0.22, 0.315)
      group.add(string)
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6), stringMaterial)
      tip.position.set(side * 0.09, 0.05, 0.315)
      group.add(tip)
    }
  } else if (top === 'shirt') {
    const wingMaterial = new THREE.MeshStandardMaterial({ color: topColor.clone().lerp(new THREE.Color('#ffffff'), .4), roughness: .6 })
    for (const side of [-1, 1]) {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.13, 0.02), wingMaterial)
      wing.position.set(side * 0.11, 0.43, 0.26); wing.rotation.set(0.5, side * 0.5, side * 0.25)
      group.add(wing)
    }
    materials.push(wingMaterial)
    const buttonMaterial = new THREE.MeshStandardMaterial({ color: '#d9bc84', roughness: .4, metalness: .3 })
    for (let i = 0; i < 3; i++) {
      const button = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), buttonMaterial)
      button.position.set(0, 0.28 - i * 0.22, 0.315)
      group.add(button)
    }
  } else if (top === 'sweater') {
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.315, 0.05, 8, 22), topMesh.material as THREE.MeshStandardMaterial)
    collar.rotation.x = Math.PI / 2; collar.position.set(0, 0.44, 0)
    group.add(collar)
  }
  if (outer !== 'none') {
    const outerMesh = garmentLathe(outerColor, knit, shoulder * 1.05, 0.04)
    outerMesh.scale.multiplyScalar(1.05)
    group.add(outerMesh); materials.push(outerMesh.material as THREE.MeshStandardMaterial)
    if (outer === 'vest' || outer === 'cardigan') {
      const inset = new THREE.Mesh(new THREE.ShapeGeometry((() => {
        const shape = new THREE.Shape()
        shape.moveTo(-0.17, 0.42); shape.lineTo(0.17, 0.42); shape.lineTo(0.05, -0.15); shape.lineTo(-0.05, -0.15)
        shape.closePath()
        return shape
      })()), topMesh.material as THREE.MeshStandardMaterial)
      inset.position.set(0, 0, 0.30)
      group.add(inset)
    }
    if (outer === 'cardigan') {
      const buttonMaterial = new THREE.MeshStandardMaterial({ color: '#d9bc84', roughness: .4, metalness: .3 })
      for (let i = 0; i < 3; i++) {
        const button = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6), buttonMaterial)
        button.position.set(0, 0.24 - i * 0.24, 0.325)
        group.add(button)
      }
    }
    if (outer === 'jacket') {
      const zip = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.62, 0.016), new THREE.MeshStandardMaterial({ color: '#b98f56', roughness: .4, metalness: .5 }))
      zip.position.set(0, 0.06, 0.34)
      group.add(zip)
      for (const side of [-1, 1]) {
        const pocket = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.1, 0.012), outerMesh.material as THREE.MeshStandardMaterial)
        pocket.position.set(side * 0.30, -0.02, 0.30)
        group.add(pocket)
      }
    }
    if (outer === 'coat' || outer === 'blazer') {
      const lapelMaterial = outerMesh.material as THREE.MeshStandardMaterial
      for (const side of [-1, 1]) {
        const lapel = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.30, 0.018), lapelMaterial)
        lapel.position.set(side * 0.13, 0.30, 0.315)
        lapel.rotation.set(0.08, side * 0.45, side * 0.35)
        group.add(lapel)
      }
      const collar = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.045, 8, 22, Math.PI * 1.4), lapelMaterial)
      collar.position.set(0, 0.42, 0.04); collar.rotation.set(Math.PI / 2, 0, Math.PI * 0.8)
      group.add(collar)
    }
  }
  return group
}

function buildAccessories(config: AvatarConfigV2, eyePositions: { x: number; y: number }, skinHex: string, materials: THREE.MeshStandardMaterial[]): { group: THREE.Group; glasses: THREE.Group | null } {
  const group = new THREE.Group()
  let glasses: THREE.Group | null = null
  const gold = () => new THREE.MeshStandardMaterial({ color: '#d9bc84', roughness: .35, metalness: .5 })
  const darkMetal = () => new THREE.MeshStandardMaterial({ color: '#2c2c34', roughness: .5, metalness: .2 })
  const silver = () => new THREE.MeshStandardMaterial({ color: '#dfe4ee', roughness: .3, metalness: .6 })
  const register = (mesh: THREE.Mesh) => { group.add(mesh); materials.push(mesh.material as THREE.MeshStandardMaterial); return mesh }
  for (const id of config.accessories) {
    if (id === 'glasses-round' || id === 'glasses-square') {
      const glassesGroup = new THREE.Group()
      glasses = glassesGroup
      const frameMaterial = id === 'glasses-round' ? gold() : darkMetal()
      const lensGeometry = id === 'glasses-round'
        ? new THREE.TorusGeometry(0.155, 0.011, 8, 26)
        : new THREE.ExtrudeGeometry(roundedRectShape(0.27, 0.19, 0.04), { depth: 0.016, bevelEnabled: false })
      for (const side of [-1, 1]) {
        const lens = new THREE.Mesh(lensGeometry, frameMaterial)
        lens.position.set(side * (eyePositions.x + 0.01), eyePositions.y, 0.86)
        if (id === 'glasses-square') lens.position.z = 0.84
        glassesGroup.add(lens)
      }
      const bridge = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, eyePositions.x * 2 - 0.24, 6), frameMaterial)
      bridge.rotation.z = Math.PI / 2
      bridge.position.set(0, eyePositions.y + 0.03, 0.87)
      glassesGroup.add(bridge)
      for (const side of [-1, 1]) {
        const temple = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.55, 6), frameMaterial)
        temple.rotation.z = Math.PI / 2 - 0.12
        temple.position.set(side * 0.78, eyePositions.y + 0.02, 0.42)
        temple.rotation.y = side * 0.86
        glassesGroup.add(temple)
      }
      group.add(glassesGroup)
    } else if (id === 'earrings') {
      for (const side of [-1, 1]) {
        const earring = new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 8), gold())
        earring.position.set(side * 0.72, -0.16, -0.05)
        register(earring)
      }
    } else if (id === 'star-pin') {
      const pin = new THREE.Mesh(new THREE.ExtrudeGeometry(starShape(0.085), { depth: 0.018, bevelEnabled: false }), silver())
      pin.position.set(0.52, 0.58, 0.42); pin.rotation.set(0.35, 0.55, 0.25)
      register(pin)
    } else if (id === 'ribbon') {
      const ribbonMaterial = new THREE.MeshStandardMaterial({ color: '#e88a9a', roughness: .55 })
      for (const side of [-1, 1]) {
        const petal = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.065, 0.02), ribbonMaterial)
        petal.position.set(0.47 + side * 0.075, 0.63 + side * 0.01, 0.45)
        petal.rotation.z = side * 0.55
        register(petal)
      }
      const knot = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), ribbonMaterial)
      knot.position.set(0.47, 0.63, 0.47)
      register(knot)
    } else if (id === 'headphones') {
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.90, 0.042, 10, 26, Math.PI), darkMetal())
      band.rotation.set(0, 0, 0)
      band.position.set(0, 0.08, 0)
      register(band)
      for (const side of [-1, 1]) {
        const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.155, 0.155, 0.085, 20), darkMetal())
        cup.rotation.z = Math.PI / 2
        cup.position.set(side * 0.86, 0.02, -0.02)
        register(cup)
        const rim = new THREE.Mesh(new THREE.TorusGeometry(0.155, 0.012, 8, 22), gold())
        rim.rotation.y = Math.PI / 2
        rim.position.set(side * 0.905, 0.02, -0.02)
        register(rim)
      }
    } else if (id === 'scarf') {
      const scarfMaterial = new THREE.MeshStandardMaterial({ color: '#d9bc84', roughness: .85 })
      const wrap = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.088, 10, 24), scarfMaterial)
      wrap.rotation.x = Math.PI / 2 - 0.08
      wrap.position.set(0, -0.86, 0.02)
      register(wrap)
      const tail = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.44, 0.05), scarfMaterial)
      tail.position.set(0.17, -1.14, 0.40); tail.rotation.z = 0.14
      register(tail)
    } else if (id === 'camera') {
      const bodyMaterial = new THREE.MeshStandardMaterial({ color: '#3a3f52', roughness: .6 })
      const cameraBody = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.115, 0.07), bodyMaterial)
      cameraBody.position.set(0.33, -0.12, 0.46); cameraBody.rotation.y = -0.35
      register(cameraBody)
      const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.05, 16), silver())
      lens.rotation.x = Math.PI / 2
      lens.position.set(0.29, -0.11, 0.53); lens.rotation.y = -0.35
      register(lens)
      const strap = new THREE.Mesh(tubeAlong([
        new THREE.Vector3(-0.62, 0.34, 0.42), new THREE.Vector3(0.1, 0.02, 0.62), new THREE.Vector3(0.52, -0.38, 0.40),
      ], [0.014, 0.013, 0.012], 6), new THREE.MeshStandardMaterial({ color: '#4a443a', roughness: .8 }))
      register(strap)
    }
  }
  return { group, glasses }
}

function buildFaceFeatures(config: AvatarConfigV2, parts: { skinMaterial: THREE.MeshStandardMaterial; hairMaterial: THREE.MeshStandardMaterial; lipMaterial: THREE.MeshStandardMaterial }): {
  eyes: { group: THREE.Group; gaze: THREE.Group; lid: THREE.Object3D; smileBand: THREE.Object3D }[]
  brows: THREE.Object3D[]
  browMaterial: THREE.MeshStandardMaterial
  lashMaterial: THREE.MeshStandardMaterial
  lipGroup: THREE.Group
  mouthLine: THREE.Mesh
  blushDiscs: THREE.Mesh[]
  freckles: THREE.InstancedMesh | null
} {
  const { eyes, nose, lips, skin } = config
  const skinHex = '#' + parts.skinMaterial.color.getHexString()
  const eyeGroups: ReturnType<typeof buildFaceFeatures>['eyes'] = []
  const ex = 0.30 + eyes.eyeDistance * 0.0010
  const ey = 0.10 + eyes.eyeHeight * 0.0009
  const eyeR = 0.134 * (1 + eyes.eyeSize * 0.0016)
  // 巩膜/虹膜加少量自发光：夜景主题光照弱，避免眼白发灰、眼珠黑成无层次色块
  const whiteMaterial = new THREE.MeshStandardMaterial({ color: '#fbf9f4', roughness: .16, emissive: '#5a564e', emissiveIntensity: .55 })
  const irisColor = IRIS_HEX[eyes.iris] ?? IRIS_HEX['dark-brown']
  const irisMaterial = new THREE.MeshStandardMaterial({
    color: irisColor, roughness: .25,
    emissive: new THREE.Color(irisColor).multiplyScalar(0.42),
  })
  const pupilMaterial = new THREE.MeshStandardMaterial({ color: '#14100e', roughness: .2 })
  const highlightMaterial = new THREE.MeshBasicMaterial({ color: '#ffffff' })
  const lidMaterial = new THREE.MeshStandardMaterial({ color: parts.skinMaterial.color.clone().multiplyScalar(.97), roughness: .55 })
  const lowerLidMaterial = new THREE.MeshStandardMaterial({ color: parts.skinMaterial.color.clone().multiplyScalar(1.03), roughness: .4 })
  const lashMaterial = new THREE.MeshStandardMaterial({ color: darken(hslToHex(config.hair.color), .25), roughness: .5 })
  for (const side of [-1, 1]) {
    const group = new THREE.Group()
    group.position.set(side * ex, ey, 0.555)
    group.rotation.z = -side * eyes.eyeTilt * 0.0022
    const eyeball = new THREE.Mesh(new THREE.SphereGeometry(eyeR, 26, 20), whiteMaterial)
    group.add(eyeball)
    const gaze = new THREE.Group()
    const irisMesh = new THREE.Mesh(new THREE.SphereGeometry(eyeR * 0.56, 18, 12), irisMaterial)
    irisMesh.scale.z = 0.55; irisMesh.position.z = eyeR * 0.80
    gaze.add(irisMesh)
    const pupilMesh = new THREE.Mesh(new THREE.SphereGeometry(eyeR * 0.30, 12, 8), pupilMaterial)
    pupilMesh.scale.z = 0.5; pupilMesh.position.z = eyeR * 0.96
    gaze.add(pupilMesh)
    const sparkMesh = new THREE.Mesh(new THREE.SphereGeometry(eyeR * 0.06, 8, 6), highlightMaterial)
    sparkMesh.position.set(eyeR * 0.13, eyeR * 0.14, eyeR * 1.14)
    gaze.add(sparkMesh)
    group.add(gaze)
    const lid = new THREE.Group()
    const lidShell = new THREE.Mesh(new THREE.SphereGeometry(eyeR * 1.12, 24, 10, 0, Math.PI * 2, 0, 1.14), lidMaterial)
    lidShell.scale.z = 0.96
    lidShell.userData.noShadow = true
    lid.add(lidShell)
    // 眼睫/眼线沿盖沿面（cap 极角 1.14 处的边缘圆环）放置，随眨眼一起开合；
    // 盖沿（含 -0.18 仰角后与竖直方向夹角≈0.96）略高于虹膜上缘（0.56r），
    // 露出细窄上下月牙，避免“瞪眼/黑斑”两个极端
    const lash = new THREE.Mesh(new THREE.TorusGeometry(eyeR * 1.01, eyeR * 0.05, 6, 18, Math.PI * 0.9), lashMaterial)
    lash.rotation.set(Math.PI / 2 - 1.14, 0, Math.PI * 0.05)
    lash.position.set(0, Math.cos(1.14) * eyeR * 1.12, Math.sin(1.14) * eyeR * 1.12 * 0.96)
    lash.userData.noShadow = true
    lid.add(lash)
    lid.rotation.x = -0.18
    group.add(lid)
    const lowerLid = new THREE.Mesh(new THREE.SphereGeometry(eyeR * 1.04, 20, 8, 0, Math.PI * 2, 0, 0.56), lowerLidMaterial)
    lowerLid.rotation.x = Math.PI - 0.64
    lowerLid.scale.z = 0.92
    lowerLid.userData.noShadow = true
    group.add(lowerLid)
    const smileBand = new THREE.Mesh(new THREE.SphereGeometry(eyeR * 0.55, 12, 8), new THREE.MeshStandardMaterial({
      color: lighten(skinHex, .12), roughness: .6, transparent: true, opacity: clamp(eyes.smileBand * 0.008, 0, .8),
    }))
    smileBand.userData.noShadow = true
    smileBand.scale.set(1.15, 0.28, 0.5)
    smileBand.position.set(0, -eyeR * 0.80, eyeR * 0.58)
    group.add(smileBand)
    eyeGroups.push({ group, gaze, lid, smileBand })
  }
  const brows: THREE.Object3D[] = []
  const browMaterial = new THREE.MeshStandardMaterial({ color: darken(hslToHex(config.hair.color), .72), roughness: .55 })
  const browR = 0.017 * (1 + eyes.browThick * 0.0009)
  const by = 0.30 + eyes.browHeight * 0.0005
  const bx = 0.27 + eyes.browSpace * 0.0009
  for (const side of [-1, 1]) {
    const brow = new THREE.Group()
    const curveLift = 0.028 + eyes.browCurve * 0.0006
    const arch = new THREE.CatmullRomCurve3([
      new THREE.Vector3(side * 0.015, 0.002, 0.02),
      new THREE.Vector3(side * 0.10, 0.018 + curveLift * 0.7, 0.02),
      new THREE.Vector3(side * 0.19, 0.012 + curveLift, 0.018),
      new THREE.Vector3(side * 0.31, -0.004 + curveLift * 0.3, 0.014),
    ])
    brow.add(new THREE.Mesh(new THREE.TubeGeometry(arch, 20, browR, 7), browMaterial))
    brow.position.set(side * bx, by, 0.64)
    brow.rotation.y = -side * 0.16
    brows.push(brow)
  }
  const lipGroup = new THREE.Group()
  lipGroup.position.set(0, -0.38, 0.685)
  lipGroup.rotation.x = 0.28
  const lipHex = hsl(config.skin.lipTint)
  const mw = 0.095 * (1 + lips.mouthWidth * 0.0007)
  const upperMaterial = parts.lipMaterial
  for (const side of [-1, 1]) {
    const upper = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 12), upperMaterial)
    upper.scale.set(mw * 0.58, 0.026 * (1 + lips.upperLip * 0.0013), 0.026)
    upper.position.set(side * mw * 0.52, 0.010, 0.004)
    upper.rotation.z = side * (0.16 + lips.cupidsBow * 0.0020)
    lipGroup.add(upper)
  }
  // 唇峰四点：中心浅凹 + 两侧峰
  const notch = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshStandardMaterial({ color: skinHex, roughness: .6 }))
  notch.scale.set(0.028, 0.014, 0.016)
  notch.position.set(0, 0.020, 0.006)
  lipGroup.add(notch)
  const lower = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 12), upperMaterial)
  lower.scale.set(mw * 1.18, 0.030 * (1 + lips.lowerLip * 0.0015), 0.030)
  lower.position.set(0, -0.022, 0.008)
  lipGroup.add(lower)
  const lineMaterial = new THREE.MeshStandardMaterial({ color: darken(skinHex, .45), roughness: .5 })
  const cornerY = lips.corner * 0.00046
  const mouthLine = new THREE.Mesh(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(-mw, 0.004, 0.020), new THREE.Vector3(0, cornerY, 0.023), new THREE.Vector3(mw, 0.004, 0.020),
  ), 14, 0.005, 6), lineMaterial)
  lipGroup.add(mouthLine)
  const blushDiscs: THREE.Mesh[] = []
  const blushOpacity = clamp(skin.blush * 0.007, 0, .65)
  if (blushOpacity > 0.02) {
    const blushMaterial = new THREE.MeshStandardMaterial({ color: '#f0958c', transparent: true, opacity: blushOpacity, roughness: .8 })
    for (const side of [-1, 1]) {
      const disc = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), blushMaterial)
      disc.scale.set(0.115, 0.062, 0.024)
      disc.position.set(side * 0.40, -0.10, 0.60)
      disc.rotation.y = side * 0.42
      blushDiscs.push(disc)
    }
  }
  let freckles: THREE.InstancedMesh | null = null
  if (skin.freckles !== 'none') {
    const count = skin.freckles === 'dense' ? 26 : 13
    freckles = new THREE.InstancedMesh(new THREE.SphereGeometry(0.011, 6, 4), new THREE.MeshStandardMaterial({ color: darken(skinHex, .55), roughness: .8 }), count)
    const matrix = new THREE.Matrix4()
    for (let i = 0; i < count; i++) {
      const side = i % 2 === 0 ? -1 : 1
      const u = hash2(i, 11), v = hash2(i, 23)
      const fx = side * (0.22 + u * 0.34)
      const fy = -0.16 + v * 0.22
      const fz = 0.80 * Math.sqrt(Math.max(0.1, 1 - fx * fx - fy * fy)) * 0.92
      matrix.setPosition(fx, fy, fz)
      freckles.setMatrixAt(i, matrix)
    }
    freckles.instanceMatrix.needsUpdate = true
  }
  // 五官小件（眉/睫/唇/唇线）禁投影：低模卡通下它们的实时阴影全是噪点，会糊在眼下与嘴周
  for (const brow of brows) brow.traverse(node => { node.userData.noShadow = true })
  lipGroup.traverse(node => { node.userData.noShadow = true })
  return { eyes: eyeGroups, brows, browMaterial, lashMaterial, lipGroup, mouthLine, blushDiscs, freckles }
}

/* ---------- 组装 ---------- */
function enableShadows(root: THREE.Object3D) {
  root.traverse(node => {
    const mesh = node as THREE.Mesh
    if (!mesh.geometry) return
    const material = (mesh as unknown as { material?: THREE.Material | THREE.Material[] }).material
    const basic = material instanceof THREE.MeshBasicMaterial
    const transparent = Array.isArray(material) ? material.some(m => m.transparent) : !!material?.transparent
    if (basic || transparent || node.userData.noShadow) { mesh.castShadow = false; mesh.receiveShadow = true; return }
    mesh.castShadow = true
    mesh.receiveShadow = true
  })
}
function buildAvatar(config: AvatarConfigV2): { root: THREE.Group; parts: AvatarParts } {
  const root = new THREE.Group()
  const knit = knitTexture()
  const skinHex = hslToHex(config.skin.tone)
  const skinMaterial = new THREE.MeshPhysicalMaterial({
    color: skinHex, roughness: .68, metalness: 0,
    sheen: .38, sheenRoughness: .8, sheenColor: new THREE.Color(skinHex).lerp(new THREE.Color('#ffe9dd'), .5),
    // 暖红自发光底：冷色主题光下肤色仍有血色，不至发灰发白
    emissive: '#4a2e26', emissiveIntensity: .07,
  })
  const hairMaterial = new THREE.MeshStandardMaterial({
    color: hsl(config.hair.color), roughness: .58, metalness: .01, side: THREE.DoubleSide, map: strandTexture(),
  })
  const lipMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(hslToHex(config.skin.lipTint)).lerp(new THREE.Color(skinHex), .3), roughness: .45, metalness: 0,
  })
  const outfitMaterials: THREE.MeshStandardMaterial[] = []
  const headPicks: HeadPicks = {
    faceWidth: config.face.faceWidth, jawWidth: config.face.jawWidth, jawAngle: config.face.jawAngle,
    chinLength: config.face.chinLength, cheekBone: config.face.cheekBone, cheekFat: config.face.cheekFat,
    bridge: config.nose.bridge, bridgeWidth: config.nose.bridgeWidth, tip: config.nose.tip,
    ala: config.nose.ala, noseLength: config.nose.noseLength,
    eyeDistance: config.eyes.eyeDistance, eyeHeight: config.eyes.eyeHeight, eyeSize: config.eyes.eyeSize,
  }
  const head = new THREE.Group()
  head.position.y = 0
  head.scale.setScalar(0.90)
  const headMesh = new THREE.Mesh(headGeometry(headPicks), skinMaterial)
  headMesh.userData.pick = 'face'
  head.add(headMesh)
  const earMaterial = skinMaterial
  for (const side of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), earMaterial)
    ear.scale.set(0.085, 0.16, 0.07)
    ear.position.set(side * 0.72, -0.03, -0.08)
    ear.rotation.y = -side * 0.3
    ear.userData.pick = 'face'
    head.add(ear)
  }
  const features = buildFaceFeatures(config, { skinMaterial, hairMaterial, lipMaterial })
  for (const entry of features.eyes) {
    entry.group.traverse(node => { node.userData.pick = 'eyes' })
    head.add(entry.group)
  }
  for (const brow of features.brows) {
    brow.traverse(node => { node.userData.pick = 'eyes' })
    head.add(brow)
  }
  features.lipGroup.traverse(node => { node.userData.pick = 'lips' })
  head.add(features.lipGroup)
  for (const disc of features.blushDiscs) head.add(disc)
  if (features.freckles) { features.freckles.userData.pick = 'face'; head.add(features.freckles) }
  const hair = buildHair(config, hairMaterial)
  // 头发不投影：程序化发丝在实时阴影下会在眼下、脸颊出颗粒状脏阴影
  hair.group.traverse(node => { node.userData.pick = 'hair'; node.userData.noShadow = true })
  head.add(hair.group)
  const eyePositions = { x: 0.205 + config.eyes.eyeDistance * 0.0010, y: 0.10 + config.eyes.eyeHeight * 0.0009 }
  const accessoryGroup = buildAccessories(config, eyePositions, skinHex, outfitMaterials)
  accessoryGroup.group.traverse(node => { node.userData.pick = 'accessory' })
  head.add(accessoryGroup.group)
  root.add(head)
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.345, 0.385, 0.86 + config.body.neckLength * 0.0009, 18), skinMaterial)
  neck.position.y = -1.13
  neck.userData.pick = 'face'
  root.add(neck)
  const bust = new THREE.Group()
  bust.position.y = -1.26
  bust.add(buildBust(config, skinMaterial, knit, outfitMaterials))
  bust.traverse(node => { if (!node.userData.pick) node.userData.pick = 'outfit' })
  root.add(bust)
  const parts: AvatarParts = {
    root, head, headMesh,
    eyeGroups: features.eyes, brows: features.brows, browMaterial: features.browMaterial, lashMaterial: features.lashMaterial,
    lipGroup: features.lipGroup, mouthLine: features.mouthLine,
    hair: hair.group, hairSway: hair.swayTargets, bust, glasses: accessoryGroup.glasses,
    freckles: features.freckles, blushDiscs: features.blushDiscs,
    skinMaterial, hairMaterial, lipMaterial, outfitMaterials, headBaseP: headPicks,
  }
  applyFeatures(parts, config)
  // 阴影：鼻、下颌、发丝的自然投影靠主光源实时阴影
  enableShadows(root)
  return { root, parts }
}

/** 只更新形变与部件位置（滑杆拖动路径，不重建款式网格） */
function applyFeatures(parts: AvatarParts, config: AvatarConfigV2) {
  const p: HeadPicks = {
    faceWidth: config.face.faceWidth, jawWidth: config.face.jawWidth, jawAngle: config.face.jawAngle,
    chinLength: config.face.chinLength, cheekBone: config.face.cheekBone, cheekFat: config.face.cheekFat,
    bridge: config.nose.bridge, bridgeWidth: config.nose.bridgeWidth, tip: config.nose.tip,
    ala: config.nose.ala, noseLength: config.nose.noseLength,
    eyeDistance: config.eyes.eyeDistance, eyeHeight: config.eyes.eyeHeight, eyeSize: config.eyes.eyeSize,
  }
  const geometry = parts.headMesh.geometry as THREE.SphereGeometry
  const position = geometry.attributes.position as THREE.BufferAttribute
  const source = new THREE.SphereGeometry(1, 64, 48)
  const srcPos = source.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < position.count; i++) {
    const point = headPoint(srcPos.getX(i), srcPos.getY(i), srcPos.getZ(i), p)
    position.setXYZ(i, point.x, point.y, point.z)
  }
  position.needsUpdate = true
  geometry.computeVertexNormals()
  source.dispose()
  parts.headBaseP = p
  /* 自适应贴合：扫描变形后的头部表面，把五官贴在真实曲面上，消除「浮贴感」 */
  const surfaceZ = (xTarget: number, yTarget: number, span: number) => {
    let best = 0
    for (let i = 0; i < position.count; i++) {
      if (Math.abs(position.getX(i) - xTarget) < span && Math.abs(position.getY(i) - yTarget) < span) {
        const z = position.getZ(i)
        if (z > best) best = z
      }
    }
    return best
  }
  const { eyes } = config
  const ex = 0.205 + eyes.eyeDistance * 0.0010
  const ey = 0.10 + eyes.eyeHeight * 0.0009
  const eyeR = 0.134 * (1 + eyes.eyeSize * 0.0016)
  for (let index = 0; index < parts.eyeGroups.length; index++) {
    const side = index === 0 ? -1 : 1
    const entry = parts.eyeGroups[index]
    entry.group.position.set(side * ex, ey, surfaceZ(side * ex, ey, 0.07) - eyeR * 0.36)
    entry.group.rotation.z = -side * eyes.eyeTilt * 0.0022
    const smileMesh = entry.smileBand as THREE.Mesh
    const material = smileMesh.material as THREE.MeshStandardMaterial
    material.opacity = clamp(eyes.smileBand * 0.008, 0, .8)
    material.needsUpdate = true
  }
  const bx = 0.24 + eyes.browSpace * 0.0009
  const by = 0.30 + eyes.browHeight * 0.0005
  for (let index = 0; index < parts.brows.length; index++) {
    const side = index === 0 ? -1 : 1
    const brow = parts.brows[index]
    brow.position.set(side * bx, by, surfaceZ(side * bx, by, 0.07) - 0.012)
  }
  parts.lipGroup.position.set(0, -0.38, surfaceZ(0, -0.38, 0.10) - 0.016)
  for (let index = 0; index < parts.blushDiscs.length; index++) {
    const side = index === 0 ? -1 : 1
    parts.blushDiscs[index].position.set(side * 0.40, -0.10, surfaceZ(side * 0.40, -0.10, 0.08) - 0.004)
  }
  if (parts.freckles) {
    const matrix = new THREE.Matrix4()
    const count = parts.freckles.count
    for (let i = 0; i < count; i++) {
      const side2 = i % 2 === 0 ? -1 : 1
      const fx = side2 * (0.22 + hash2(i, 11) * 0.34)
      const fy = -0.16 + hash2(i, 23) * 0.22
      matrix.setPosition(fx, fy, surfaceZ(fx, fy, 0.06) + 0.002)
      parts.freckles.setMatrixAt(i, matrix)
    }
    parts.freckles.instanceMatrix.needsUpdate = true
  }
  if (parts.glasses) {
    const eyeZ = surfaceZ(ex, ey, 0.07)
    parts.glasses.position.z = eyeZ - 0.72
  }
  // 嘴角曲线随 corner 参数重建（14 段小管，成本可忽略）
  const cornerY = config.lips.corner * 0.00046
  const mw = 0.095 * (1 + config.lips.mouthWidth * 0.0007)
  const oldGeometry = parts.mouthLine.geometry
  parts.mouthLine.geometry = new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(-mw, 0.004, 0.020), new THREE.Vector3(0, cornerY, 0.023), new THREE.Vector3(mw, 0.004, 0.020),
  ), 14, 0.005, 6)
  oldGeometry.dispose()
  // 腮红透明度增量更新
  const blushOpacity = clamp(config.skin.blush * 0.007, 0, .65)
  for (const disc of parts.blushDiscs) {
    const material = disc.material as THREE.MeshStandardMaterial
    material.opacity = blushOpacity
    material.needsUpdate = true
  }
}

/* ---------- 引擎 ---------- */
// 基础视线：默认相机为 3/4 侧视角（yaw≈0.35），瞳孔需要朝相机方向回望，
// 否则两眼直视正前方会显得发愣；pointer 交互后叠加偏移，离开画面回落到此值
const BASE_LOOK = new THREE.Vector2(-0.5, -0.06)
export class AvatarEngine {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera: THREE.PerspectiveCamera
  private rig = new THREE.Group()
  private lights: THREE.Group = new THREE.Group()
  private parts: AvatarParts | null = null
  private container: HTMLElement
  private raf = 0
  private clock = new THREE.Clock()
  private yaw = 0.35
  private pitch = 0.02
  private yawTarget = 0.35
  private distance = 5.15
  private distanceTarget = 5.15
  private look = new THREE.Vector2(BASE_LOOK.x, BASE_LOOK.y)
  private lookTarget = new THREE.Vector2(BASE_LOOK.x, BASE_LOOK.y)
  private dragging = false
  private lastPointer: { x: number; y: number } | null = null
  private tapStart: { x: number; y: number; t: number } | null = null
  private pinchStart: number | null = null
  private pointers = new Map<number, { x: number; y: number }>()
  private blinkAt = 1.2
  private blinkPhase = -1
  private wideBoost = 0
  private config: AvatarConfigV2
  private theme: EngineTheme
  private reducedMotion: boolean
  private onPick?: (region: PickRegion) => void
  private disposed = false

  constructor(container: HTMLElement, config: AvatarConfigV2, options: { theme?: EngineTheme; onPick?: (region: PickRegion) => void; reducedMotion?: boolean } = {}) {
    this.container = container
    this.config = config
    this.theme = options.theme ?? 'night'
    this.onPick = options.onPick
    this.reducedMotion = options.reducedMotion ?? false
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.12
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    container.appendChild(this.renderer.domElement)
    this.renderer.domElement.style.touchAction = 'none'
    this.renderer.domElement.style.display = 'block'
    this.camera = new THREE.PerspectiveCamera(34, 1, 0.1, 30)
    this.scene.add(this.rig)
    this.scene.add(this.lights)
    this.applyTheme(this.theme)
    const built = buildAvatar(config)
    this.parts = built.parts
    this.applyStyleTags()
    this.rig.add(built.root)
    this.attachEvents()
    this.resize()
    this.loop()
  }

  private applyTheme(theme: EngineTheme) {
    const lighting = THEME_LIGHTS[theme]
    this.lights.clear()
    const key = new THREE.DirectionalLight(lighting.key[0], lighting.key[1])
    key.position.copy(lighting.key[2])
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    key.shadow.camera.near = 0.5
    key.shadow.camera.far = 14
    key.shadow.camera.left = -3
    key.shadow.camera.right = 3
    key.shadow.camera.top = 3
    key.shadow.camera.bottom = -3
    key.shadow.bias = -0.0008
    key.shadow.normalBias = 0.06
    key.shadow.radius = 2.5
    const fill = new THREE.DirectionalLight(lighting.fill[0], lighting.fill[1])
    fill.position.copy(lighting.fill[2])
    const rim = new THREE.DirectionalLight(lighting.rim[0], lighting.rim[1])
    rim.position.copy(lighting.rim[2])
    const hemi = new THREE.HemisphereLight(lighting.hemi[0], lighting.hemi[1], lighting.hemi[2])
    this.lights.add(key, fill, rim, hemi)
  }

  setTheme(theme: EngineTheme) { this.theme = theme; this.applyTheme(theme) }

  setConfig(config: AvatarConfigV2) {
    this.config = config
    if (!this.parts) return
    const styleChanged =
      config.hair.style !== this.parts.hair.userData.style || config.hair.bangs !== this.parts.hair.userData.bangs ||
      config.outfit.top !== this.parts.bust.userData.top || config.outfit.outer !== this.parts.bust.userData.outer ||
      config.skin.freckles !== this.parts.bust.userData.freckles ||
      JSON.stringify(config.accessories) !== this.parts.hair.userData.accessories
    // 颜色与形变永远可增量更新
    const skinHex = hslToHex(config.skin.tone)
    const hairHex = hslToHex(config.hair.color)
    this.parts.skinMaterial.color.set(skinHex)
    this.parts.hairMaterial.color.set(hairHex)
    this.parts.lipMaterial.color.set(hslToHex(config.skin.lipTint))
    this.parts.browMaterial.color.set(darken(hairHex, .72))
    this.parts.lashMaterial.color.set(darken(hairHex, .25))
    if (styleChanged) this.rebuild()
    else applyFeatures(this.parts, config)
  }

  private rebuild() {
    if (!this.parts) return
    const old = this.parts.root
    this.rig.remove(old)
    disposeDeep(old)
    const built = buildAvatar(this.config)
    this.parts = built.parts
    this.applyStyleTags()
    this.rig.add(built.root)
  }

  private applyStyleTags() {
    if (!this.parts) return
    this.parts.hair.userData.style = this.config.hair.style
    this.parts.hair.userData.bangs = this.config.hair.bangs
    this.parts.bust.userData.top = this.config.outfit.top
    this.parts.bust.userData.outer = this.config.outfit.outer
    this.parts.bust.userData.freckles = this.config.skin.freckles
    this.parts.hair.userData.accessories = JSON.stringify(this.config.accessories)
  }

  react(kind: 'adjust' | 'save' | 'random') {
    if (this.reducedMotion) return
    if (kind === 'adjust') this.blinkPhase = 0
    if (kind === 'save') { this.blinkPhase = 0; this.blinkAt = 0.5 }
    if (kind === 'random') { this.wideBoost = 1; this.blinkPhase = 0 }
  }

  private attachEvents() {
    const element = this.renderer.domElement
    element.addEventListener('pointerdown', this.onPointerDown)
    element.addEventListener('pointermove', this.onPointerMove)
    element.addEventListener('pointerup', this.onPointerUp)
    element.addEventListener('pointercancel', this.onPointerUp)
    element.addEventListener('pointerleave', this.onPointerLeave)
    element.addEventListener('dblclick', this.onDoubleTap)
  }

  private onPointerDown = (event: PointerEvent) => {
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    this.tapStart = { x: event.clientX, y: event.clientY, t: performance.now() }
    if (this.pointers.size === 2) {
      const points = [...this.pointers.values()]
      this.pinchStart = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y)
    }
    this.lastPointer = { x: event.clientX, y: event.clientY }
    this.dragging = true
    try { (event.target as HTMLElement).setPointerCapture?.(event.pointerId) } catch { /* 环境不支持时忽略捕获失败 */ }
  }

  private onPointerMove = (event: PointerEvent) => {
    if (this.pointers.has(event.pointerId)) this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    const rect = this.renderer.domElement.getBoundingClientRect()
    this.lookTarget.set(
      BASE_LOOK.x + clamp(((event.clientX - rect.left) / rect.width - 0.5) * 2, -1, 1),
      BASE_LOOK.y + clamp(((event.clientY - rect.top) / rect.height - 0.5) * 2, -1, 1),
    )
    if (this.pointers.size === 2 && this.pinchStart != null) {
      const points = [...this.pointers.values()]
      const current = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y)
      this.distanceTarget = clamp(this.distanceTarget * (this.pinchStart / Math.max(1, current)), 3.0, 6.4)
      this.pinchStart = current
      return
    }
    if (!this.dragging || !this.lastPointer) return
    const dx = event.clientX - this.lastPointer.x
    const dy = event.clientY - this.lastPointer.y
    this.lastPointer = { x: event.clientX, y: event.clientY }
    this.yawTarget = clamp(this.yawTarget + dx * 0.011, -Math.PI * 1.2, Math.PI * 1.2)
    this.pitch = clamp(this.pitch - dy * 0.006, -0.42, 0.5)
  }

  private onPointerUp = (event: PointerEvent) => {
    this.pointers.delete(event.pointerId)
    if (this.pointers.size < 2) this.pinchStart = null
    this.dragging = this.pointers.size > 0
    const start = this.tapStart
    this.tapStart = null
    if (!start) return
    const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y)
    if (moved < 8 && performance.now() - start.t < 320) this.pickAt(event.clientX, event.clientY)
  }

  private onPointerLeave = () => {
    this.dragging = false
    this.lookTarget.set(BASE_LOOK.x, BASE_LOOK.y)
  }

  private onDoubleTap = () => {
    this.yawTarget = 0.35
    this.pitch = 0.02
    this.distanceTarget = 5.15
  }

  private pickAt(clientX: number, clientY: number) {
    if (!this.parts || !this.onPick) return
    const rect = this.renderer.domElement.getBoundingClientRect()
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    )
    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(ndc, this.camera)
    const hits = raycaster.intersectObject(this.parts.root, true)
    const hit = hits.find(item => (item.object.userData.pick as string | undefined))
    if (!hit || !this.onPick) return
    const tag = hit.object.userData.pick as PickRegion
    if (tag === 'face' || tag === 'accessory') {
      const local = this.parts.root.worldToLocal(hit.point.clone())
      if (Math.abs(local.x) < 0.22 && local.y > -0.30 && local.y < 0.16) this.onPick('nose')
      else if (local.y <= -0.30 && local.y > -0.62 && Math.abs(local.x) < 0.4) this.onPick('lips')
      else this.onPick('face')
      return
    }
    this.onPick(tag)
  }

  resize() {
    const width = this.container.clientWidth || 320
    const height = this.container.clientHeight || 360
    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / Math.max(1, height)
    this.camera.updateProjectionMatrix()
  }

  private loop = () => {
    if (this.disposed) return
    this.raf = requestAnimationFrame(this.loop)
    const delta = this.clock.getDelta()
    const time = this.clock.elapsedTime
    if (!this.parts) return
    this.yaw += (this.yawTarget - this.yaw) * Math.min(1, delta * 9)
    this.distance += (this.distanceTarget - this.distance) * Math.min(1, delta * 8)
    this.rig.rotation.y = this.yaw
    this.rig.rotation.x = this.pitch * 0.6
    this.look.lerp(this.lookTarget, this.reducedMotion ? 1 : 0.055)
    const lookX = this.look.x * (this.dragging ? 0 : 1)
    const lookY = this.look.y * (this.dragging ? 0 : 1)
    // 视线朝向是“姿态”而非动画：reduced-motion 下也应用，避免默认发愣
    for (const entry of this.parts.eyeGroups) {
      entry.gaze.rotation.y = lookX * 0.36
      entry.gaze.rotation.x = lookY * 0.22
    }
    if (!this.reducedMotion) {
      this.parts.head.rotation.y = lookX * 0.30 + Math.sin(time * 0.5) * 0.012
      this.parts.head.rotation.x = lookY * 0.14 + Math.sin(time * 0.8) * 0.006
      this.parts.root.position.y = Math.sin(time * 1.05) * 0.008
      this.parts.bust.scale.y = 1 + Math.sin(time * 1.05) * 0.006
      const sway = Math.sin(time * 1.4) * 0.013
      for (const target of this.parts.hairSway) target.rotation.z = sway
      this.blinkAt -= delta
      if (this.blinkAt <= 0 && this.blinkPhase < 0) { this.blinkPhase = 0; this.blinkAt = 2.2 + Math.random() * 3.6 }
      if (this.blinkPhase >= 0) {
        this.blinkPhase += delta * 9
        const closed = this.blinkPhase < 1 ? this.blinkPhase : this.blinkPhase < 1.5 ? 1 : Math.max(0, 2.5 - this.blinkPhase)
        for (const entry of this.parts.eyeGroups) entry.lid.rotation.x = lerp(-0.18, 1.31, clamp(closed, 0, 1))
        if (this.blinkPhase > 2.5) { this.blinkPhase = -1; for (const entry of this.parts.eyeGroups) entry.lid.rotation.x = -0.18 }
      }
      if (this.wideBoost > 0) {
        this.wideBoost = Math.max(0, this.wideBoost - delta * 1.6)
        const wide = 1 + this.wideBoost * 0.14
        for (const entry of this.parts.eyeGroups) entry.group.scale.setScalar(wide)
      }
    }
    this.camera.position.set(0, 0.02, this.distance)
    this.camera.lookAt(0, -0.30, 0)
    this.renderer.render(this.scene, this.camera)
  }

  snapshot(size = 256): string {
    const width = this.container.clientWidth || 320
    const height = this.container.clientHeight || 360
    const yaw = this.rig.rotation.y
    const pitch = this.rig.rotation.x
    this.rig.rotation.y = 0.28
    this.rig.rotation.x = 0.02
    for (const entry of this.parts?.eyeGroups ?? []) entry.lid.rotation.x = -0.18
    this.renderer.setSize(size, size, false)
    this.camera.aspect = 1
    this.camera.position.set(0, 0.10, 2.72)
    this.camera.lookAt(0, -0.02, 0)
    this.renderer.render(this.scene, this.camera)
    const url = this.renderer.domElement.toDataURL('image/png')
    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / Math.max(1, height)
    this.camera.updateProjectionMatrix()
    this.camera.position.set(0, 0.02, this.distance)
    this.camera.lookAt(0, -0.30, 0)
    this.rig.rotation.y = yaw
    this.rig.rotation.x = pitch
    return url
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    const element = this.renderer.domElement
    element.removeEventListener('pointerdown', this.onPointerDown)
    element.removeEventListener('pointermove', this.onPointerMove)
    element.removeEventListener('pointerup', this.onPointerUp)
    element.removeEventListener('pointercancel', this.onPointerUp)
    element.removeEventListener('pointerleave', this.onPointerLeave)
    element.removeEventListener('dblclick', this.onDoubleTap)
    if (this.parts) disposeDeep(this.parts.root)
    this.renderer.dispose()
    element.remove()
  }
}

/* ---------- 独立快照渲染（全站头像） ---------- */
const snapshotCache = new Map<string, string>()
export function renderSnapshot(config: AvatarConfigV2, size = 256, theme: EngineTheme = 'night', cacheKey?: string): string {
  const key = cacheKey ?? JSON.stringify(config) + ':' + theme + ':' + size
  const cached = snapshotCache.get(key)
  if (cached) return cached
  const container = document.createElement('div')
  container.style.width = size + 'px'
  container.style.height = size + 'px'
  container.style.position = 'fixed'
  container.style.left = '-9999px'
  document.body.appendChild(container)
  let url = ''
  try {
    const engine = new AvatarEngine(container, config, { theme, reducedMotion: true })
    engine.resize()
    url = engine.snapshot(size)
    engine.dispose()
  } catch { url = '' }
  container.remove()
  if (url) snapshotCache.set(key, url)
  return url
}

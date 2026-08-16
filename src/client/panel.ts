/**
 * @dsh-external/dsh-voxel-2d — 粒子化建模渲染 + 体素化工作流面板。
 *
 * 新建模渲染方式（转述包落地）：
 * - 粒子模糊云是终态：不聚焦，模糊后停留并呼吸浮动；
 * - 网格凝固保留：由 SDF 凝固成实体网格（Three.js MarchingCubes 实现）；
 * - 艺术风格策略：写实 / 像素复古 / 黏土手办 / 水彩手绘。
 *
 * 工作流（精细模 → 体素化 → 三转二检查 → 素体 → 再精细 → 比对迭代）：
 * - “体素化并检查”：把当前 SDF 精细模体素化写入宿主世界，并跑三视图/不变量校验；
 * - “修复为素体”：调用宿主 autoFix 生成物理完整的素体；
 * - “素体→精细模”：把当前素体方块读回，生成体素方块精细模；
 * - “比对”：与初始体素化结果做差异统计。
 */
import * as THREE from 'three'
import { MarchingCubes } from 'three/examples/jsm/objects/MarchingCubes.js'

const API_BASE = '/@dsh-external/dsh-voxel-2d/api'
const GRID = 16
const MC_RES = 28

interface Block { x: number; y: number; z: number; t: string }
interface VoxelState {
  name: string
  size: { x: number; y: number; z: number }
  version: number
  blocks: number
  blocksList: Block[]
  worlds: string[]
  currentWorld: string
}
interface ValidateResult {
  ok: boolean
  blocks: number
  checks: Array<{ name: string; pass: boolean; detail: string }>
  fixes: string[]
  before: number
  after: number
}

// ── 小工具 ────────────────────────────────────────────────────────
function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, unknown> = {},
  children: Array<HTMLElement | string> | HTMLElement | string = [],
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  const kids = Array.isArray(children) ? children : [children]
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue
    if (k === 'class') el.className = String(v)
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v)
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener)
    else el.setAttribute(k, String(v))
  }
  for (const c of kids) el.append(typeof c === 'string' ? document.createTextNode(c) : c)
  return el
}

async function api<T = any>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(API_BASE + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) throw new Error('HTTP ' + res.status)
  return res.json() as Promise<T>
}

// ── 精细模 SDF（回转体罐子/烛台轮廓） ─────────────────────────────
// [r, y] 轮廓点：下底收口、鼓腹、束腰、罐口。
const PROFILE: Array<[number, number]> = [
  [0.0, 0.0],
  [0.55, 0.0],
  [0.95, 0.12],
  [1.05, 0.45],
  [0.85, 0.95],
  [0.72, 1.35],
  [0.88, 1.75],
  [0.82, 2.05],
  [0.42, 2.2],
  [0.0, 2.3],
]

function sdLathe(p: THREE.Vector3): number {
  const r = Math.hypot(p.x, p.z)
  const y = p.y
  let minDist = Infinity
  for (let i = 0; i < PROFILE.length - 1; i++) {
    const [r0, y0] = PROFILE[i]
    const [r1, y1] = PROFILE[i + 1]
    const dx = r1 - r0
    const dy = y1 - y0
    const len2 = dx * dx + dy * dy
    let t = len2 === 0 ? 0 : ((r - r0) * dx + (y - y0) * dy) / len2
    t = Math.max(0, Math.min(1, t))
    const px = r0 + dx * t
    const py = y0 + dy * t
    minDist = Math.min(minDist, Math.hypot(r - px, y - py))
  }
  let inside = false
  if (y >= PROFILE[0][1] && y <= PROFILE[PROFILE.length - 1][1]) {
    let rad = 0
    for (let i = 0; i < PROFILE.length - 1; i++) {
      const [r0, y0] = PROFILE[i]
      const [r1, y1] = PROFILE[i + 1]
      if (y >= y0 && y <= y1) {
        const t = (y - y0) / ((y1 - y0) || 1)
        rad = r0 + (r1 - r0) * t
        break
      }
    }
    if (r <= rad) inside = true
  }
  return inside ? -minDist : minDist
}

function buildSolidMesh(): THREE.Mesh {
  const mc = new MarchingCubes(MC_RES, new THREE.MeshStandardMaterial(), false, true)
  mc.isolation = 0
  const scaleX = 2.6
  const scaleY = 3.0
  const scaleZ = 2.6
  for (let i = 0; i < MC_RES; i++) {
    for (let j = 0; j < MC_RES; j++) {
      for (let k = 0; k < MC_RES; k++) {
        const nx = i / (MC_RES - 1)
        const ny = j / (MC_RES - 1)
        const nz = k / (MC_RES - 1)
        const p = new THREE.Vector3((nx - 0.5) * scaleX, (ny - 0.42) * scaleY, (nz - 0.5) * scaleZ)
        mc.setCell(i, j, k, -sdLathe(p) * 6)
      }
    }
  }
  mc.update()
  const geo = mc.geometry
  geo.computeVertexNormals()
  const colors = new Float32Array((geo.attributes.position.count || 0) * 3)
  const pos = geo.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i)
    const t = THREE.MathUtils.clamp((y / MC_RES - 0.35) * 1.4, 0, 1)
    const c = new THREE.Color(0xc8793a).lerp(new THREE.Color(0xe8ddc4), t)
    colors[i * 3] = c.r
    colors[i * 3 + 1] = c.g
    colors[i * 3 + 2] = c.b
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.42, metalness: 0.05, vertexColors: true })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.scale.setScalar(1 / MC_RES * 7)
  mesh.position.y = -0.2
  return mesh
}

function buildParticles(mesh: THREE.Mesh): THREE.Points {
  const pos = (mesh.geometry.attributes.position as THREE.BufferAttribute)
  const count = Math.min(4000, pos.count)
  const positions = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    const src = i % pos.count
    positions[i * 3] = pos.getX(src)
    positions[i * 3 + 1] = pos.getY(src)
    positions[i * 3 + 2] = pos.getZ(src)
    const c = new THREE.Color(0xe8b98a).lerp(new THREE.Color(0xfff2dd), Math.random() * 0.5)
    colors[i * 3] = c.r
    colors[i * 3 + 1] = c.g
    colors[i * 3 + 2] = c.b
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  const mat = new THREE.PointsMaterial({ size: 0.08, vertexColors: true, transparent: true, opacity: 0.95, sizeAttenuation: true })
  const points = new THREE.Points(geo, mat)
  points.scale.copy(mesh.scale)
  points.position.copy(mesh.position)
  return points
}

function voxelizeSDF(): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = []
  const scaleX = 2.6
  const scaleY = 3.0
  const scaleZ = 2.6
  for (let x = 0; x < GRID; x++) {
    for (let y = 0; y < GRID; y++) {
      for (let z = 0; z < GRID; z++) {
        const nx = (x + 0.5) / GRID
        const ny = (y + 0.5) / GRID
        const nz = (z + 0.5) / GRID
        const p = new THREE.Vector3((nx - 0.5) * scaleX, (ny - 0.42) * scaleY, (nz - 0.5) * scaleZ)
        if (sdLathe(p) < 0) out.push([x, y, z])
      }
    }
  }
  return out
}

function makeVoxelGroup(blocks: Block[]): THREE.Group {
  const g = new THREE.Group()
  const mat = new THREE.MeshStandardMaterial({ color: 0xc8793a, roughness: 0.55, metalness: 0.02 })
  const geo = new THREE.BoxGeometry(0.9, 0.9, 0.9)
  for (const b of blocks) {
    const m = new THREE.Mesh(geo, mat)
    m.position.set(b.x - (GRID - 1) / 2, b.y - GRID / 2 + 0.5, b.z - (GRID - 1) / 2)
    m.scale.setScalar(0.5)
    g.add(m)
  }
  return g
}

// ── 艺术风格策略 ──────────────────────────────────────────────────
type StyleDef = {
  r: number
  m: number
  f: boolean
  rim: number
  fn: (r: number, g: number, b: number) => [number, number, number]
}

const STYLES: StyleDef[] = [
  { r: 0.42, m: 0.05, f: false, rim: 0, fn: (r, g, b) => [r, g, b] },
  { r: 0.6, m: 0, f: true, rim: 0, fn: (r, g, b) => [Math.round(4 * r) / 4, Math.round(4 * g) / 4, Math.round(4 * b) / 4] },
  { r: 0.95, m: 0, f: false, rim: 0, fn: (r, g, b) => { const l = (r + g + b) / 3; const mx = (x: number) => Math.min(1, 0.3 * x + 0.7 * l + 0.07); return [mx(r), mx(g), mx(b)] } },
  { r: 0.55, m: 0, f: false, rim: 0.38, fn: (r, g, b) => { const l = (r + g + b) / 3; const mx = (x: number) => Math.min(1, 0.6 * x + 0.4 * l + 0.04); return [mx(r), mx(g), mx(b)] } },
]

// ── 面板主体 ──────────────────────────────────────────────────────
export function mountPanel(): HTMLElement {
  const root = h('div', { style: { fontFamily: 'ui-sans-serif, system-ui, sans-serif', fontSize: 13, color: 'var(--dsh-text, #444)' } })

  const styleTag = document.createElement('style')
  styleTag.textContent = `
.v2d-root2 { box-sizing: border-box; }
.v2d-root2 * { box-sizing: border-box; }
.v2d-root2 .head { display:flex; align-items:center; gap:10px; flex-wrap:wrap; padding:8px 12px; border:1px solid var(--dsh-border, rgba(128,128,128,.35)); border-radius:10px; margin-bottom:8px; background:var(--dsh-card, rgba(128,128,128,.06)); }
.v2d-root2 .title { font-weight:700; font-size:14px; }
.v2d-root2 .status { opacity:.8; font-family:ui-monospace, monospace; font-size:12px; }
.v2d-root2 .toolbar { display:flex; gap:6px; align-items:center; flex-wrap:wrap; margin-bottom:8px; }
.v2d-root2 button { padding:5px 11px; border-radius:999px; border:1px solid var(--dsh-border, rgba(128,128,128,.35)); background:var(--dsh-card, rgba(128,128,128,.08)); color:inherit; cursor:pointer; font-size:12px; }
.v2d-root2 button.primary { background:#4f7cff; border-color:transparent; color:#fff; }
.v2d-root2 button.on { opacity:1; background:#c8793a; color:#fff; border-color:#f0b27a; }
.v2d-root2 #styles { margin-top:8px; display:flex; gap:6px; flex-wrap:wrap; }
.v2d-root2 #styles button { padding:5px 11px; border-radius:999px; border:1px solid rgba(255,255,255,.22); background:rgba(20,26,42,.55); color:#e8ddc4; cursor:pointer; font-size:12px; opacity:.7; }
.v2d-root2 #styles button.on { opacity:1; background:#c8793a; color:#fff; border-color:#f0b27a; }
.v2d-root2 .canvas-wrap { border:1px solid var(--dsh-border, rgba(128,128,128,.35)); border-radius:10px; padding:10px; background:var(--dsh-card, rgba(128,128,128,.04)); }
.v2d-root2 canvas { display:block; width:100%; height:420px; border-radius:8px; background:rgba(0,0,0,.05); cursor:grab; }
.v2d-root2 canvas:active { cursor:grabbing; }
.v2d-root2 .report { margin-top:8px; padding:8px 10px; border:1px solid var(--dsh-border, rgba(128,128,128,.35)); border-radius:8px; background:var(--dsh-card, rgba(128,128,128,.04)); white-space:pre-wrap; font-family:ui-monospace, monospace; font-size:12px; max-height:220px; overflow:auto; }
.v2d-root2 .stages { display:flex; gap:4px; margin:6px 0 8px; flex-wrap:wrap; }
.v2d-root2 .ph { padding:3px 8px; border-radius:999px; background:rgba(128,128,128,.12); font-size:11px; }
.v2d-root2 .ph.active { background:#4f7cff; color:#fff; }
`
  document.head.append(styleTag)

  const header = h('div', { class: 'head' }, [
    h('span', { class: 'title' }, '🧠 粒子化建模 · 模糊云 → 艺术风格凝固'),
    h('span', { class: 'status' }, 'pipeline ready'),
  ])
  const statusEl = header.children[1] as HTMLElement

  const stageBar = h('div', { class: 'stages' })
  const STAGE_NAMES = ['① 粒子采样', '② 扩散', '③ 模糊云', '④ 云停留呼吸', '⑤ 网格凝固']
  const stageEls = STAGE_NAMES.map((name) => h('span', { class: 'ph' }, name))
  for (const el of stageEls) stageBar.append(el)

  const stylesBar = h('div', { id: 'styles' })
  const STYLE_NAMES = ['写实', '像素复古', '黏土手办', '水彩手绘']
  const styleBtns = STYLE_NAMES.map((name, i) => h('button', { 'data-s': i, class: i === 0 ? 'on' : '' }, name))
  for (const b of styleBtns) stylesBar.append(b)

  const toolbar = h('div', { class: 'toolbar' }, [
    h('button', { class: 'primary', id: 'voxelize' }, '② 体素化并检查'),
    h('button', { id: 'autofix' }, '③ 修复为素体'),
    h('button', { id: 'rebuild' }, '④ 素体→精细模'),
    h('button', { id: 'compare' }, '⑤ 比对'),
    h('button', { id: 'restart' }, '↻ 重跑管线'),
  ])

  const canvasWrap = h('div', { class: 'canvas-wrap' })
  const canvas = h('canvas') as HTMLCanvasElement
  canvasWrap.append(canvas)

  const report = h('div', { class: 'report' }, '等待操作…')

  root.append(header, stageBar, stylesBar, toolbar, canvasWrap, report)

  // ── Three.js 场景 ──────────────────────────────────────────────
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.setSize(canvas.clientWidth || 640, canvas.clientHeight || 420, false)
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.5

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x141a2a)
  const camera = new THREE.PerspectiveCamera(45, (canvas.clientWidth || 640) / (canvas.clientHeight || 420), 0.1, 100)
  camera.position.set(6, 4, 7)
  camera.lookAt(0, 0, 0)

  scene.add(new THREE.HemisphereLight(0xfff2dd, 0x443322, 1.5))
  const dir = new THREE.DirectionalLight(0xffeedd, 1.6)
  dir.position.set(4, 6, 3)
  scene.add(dir)
  const point = new THREE.PointLight(0xffc9a0, 1.2)
  point.position.set(-3, 2, -2)
  scene.add(point)
  scene.add(new THREE.AmbientLight(0xffffff, 0.25))

  const solidMesh = buildSolidMesh()
  const points = buildParticles(solidMesh)
  scene.add(solidMesh)
  scene.add(points)
  solidMesh.visible = false

  // 风格切换
  const baseColors = (solidMesh.geometry.attributes.color as THREE.BufferAttribute).array.slice()
  const styleMaterials = STYLES.map((t) => {
    const m = new THREE.MeshStandardMaterial({ roughness: t.r, metalness: t.m, vertexColors: true, flatShading: t.f })
    if (t.rim > 0) {
      m.onBeforeCompile = (sh) => {
        sh.fragmentShader = sh.fragmentShader.replace(
          '#include <normal_fragment_begin>',
          `#include <normal_fragment_begin>
{float fr=pow(1.-abs(dot(normalize(normal),normalize(vViewPosition))),2.);diffuseColor.rgb*=1.-${t.rim}*fr;}`
        )
      }
    }
    return m
  })
  const applyStyle = (s: number) => {
    const t = STYLES[s]
    const attr = solidMesh.geometry.attributes.color as THREE.BufferAttribute
    for (let v = 0; v < attr.count; v++) {
      const c = t.fn(baseColors[3 * v], baseColors[3 * v + 1], baseColors[3 * v + 2])
      attr.array[3 * v] = c[0]
      attr.array[3 * v + 1] = c[1]
      attr.array[3 * v + 2] = c[2]
    }
    attr.needsUpdate = true
    solidMesh.material = styleMaterials[s]
    styleBtns.forEach((b, i) => b.classList.toggle('on', i === s))
  }
  stylesBar.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null
    if (b) applyStyle(Number(b.dataset.s))
  })
  applyStyle(0)

  // 简单轨道拖拽
  let dragging = false
  let lastX = 0
  let lastY = 0
  const sph = new THREE.Spherical().setFromVector3(camera.position)
  canvas.addEventListener('mousedown', (e) => { dragging = true; lastX = e.clientX; lastY = e.clientY })
  window.addEventListener('mouseup', () => { dragging = false })
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return
    const dx = e.clientX - lastX
    const dy = e.clientY - lastY
    lastX = e.clientX
    lastY = e.clientY
    sph.theta -= dx * 0.01
    sph.phi = Math.max(0.2, Math.min(Math.PI - 0.2, sph.phi - dy * 0.01))
    camera.position.setFromSpherical(sph)
    camera.lookAt(0, 0, 0)
  })
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault()
    sph.radius = Math.max(3, Math.min(16, sph.radius * (e.deltaY > 0 ? 1.08 : 0.92)))
    camera.position.setFromSpherical(sph)
    camera.lookAt(0, 0, 0)
  }, { passive: false })

  // 管线阶段
  const basePositions = (points.geometry.attributes.position as THREE.BufferAttribute).array.slice()
  let stage = 0
  let stageStart = performance.now()
  let voxelCoords: Array<[number, number, number]> = []
  let lastHostBlocks: Block[] = []

  const setStage = (s: number) => {
    stage = s
    stageStart = performance.now()
    stageEls.forEach((el, i) => el.classList.toggle('active', i === s))
    statusEl.textContent = STAGE_NAMES[s] + (s === 4 ? '（网格凝固）' : '')
  }

  const advancePipeline = (now: number) => {
    const dur = stage === 3 ? 8000 : stage === 4 ? 9000 : 4000
    if (now - stageStart > dur) {
      setStage((stage + 1) % 5)
    }
    const t = Math.min(1, (now - stageStart) / dur)
    const pos = points.geometry.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < pos.count; i++) {
      const bx = basePositions[i * 3]
      const by = basePositions[i * 3 + 1]
      const bz = basePositions[i * 3 + 2]
      let off = 0
      if (stage === 0) off = 0.02 * t
      else if (stage === 1) off = 0.05 + 0.35 * t
      else if (stage === 2) off = 0.4
      else if (stage === 3) off = 0.4 + 0.07 * Math.sin(now / 480)
      else off = 0
      const ang = i * 127.37
      pos.array[i * 3] = bx + Math.sin(ang) * off
      pos.array[i * 3 + 1] = by + Math.cos(ang * 1.7) * off
      pos.array[i * 3 + 2] = bz + Math.sin(ang * 0.9 + 1.3) * off
    }
    pos.needsUpdate = true
    points.visible = stage < 4
    solidMesh.visible = stage === 4
  }

  const animate = () => {
    requestAnimationFrame(animate)
    const now = performance.now()
    advancePipeline(now)
    renderer.render(scene, camera)
  }
  animate()

  // ── 工作流操作 ─────────────────────────────────────────────────
  const setReport = (text: string) => { report.textContent = text }

  toolbar.querySelector('#voxelize')!.addEventListener('click', async () => {
    try {
      setReport('体素化中…')
      voxelCoords = voxelizeSDF()
      await api('/resize', { size: GRID })
      await api('/clear')
      await api('/coords', { coords: voxelCoords.map(([x, y, z]) => [x, y, z]) })
      const state = await api<VoxelState>('/state')
      const valid = await api<{ ok: boolean; blocks: number; checks: Array<{ name: string; pass: boolean; detail: string }> }>('/validate', { house: false })
      lastHostBlocks = state.blocksList || []
      setReport(
        `体素化完成：${voxelCoords.length} 块精细模体素\n` +
        `宿主世界：${state.blocks} 块\n` +
        valid.checks.map((c) => (c.pass ? '✓ ' : '✗ ') + c.name + '：' + c.detail).join('\n')
      )
    } catch (e) {
      setReport('体素化失败：' + String(e))
    }
  })

  toolbar.querySelector('#autofix')!.addEventListener('click', async () => {
    try {
      const r = await api<ValidateResult>('/validate', { house: false, autoFix: true })
      const state = await api<VoxelState>('/state')
      lastHostBlocks = state.blocksList || []
      setReport(
        `素体修复完成：${r.before} → ${r.after} 块\n` +
        (r.fixes.length ? r.fixes.map((f) => '  - ' + f).join('\n') : '无需修复') +
        `\n校验：${r.ok ? '✅ 通过' : '❌ 仍有缺陷'}`
      )
    } catch (e) {
      setReport('素体修复失败：' + String(e))
    }
  })

  toolbar.querySelector('#rebuild')!.addEventListener('click', async () => {
    try {
      const state = await api<VoxelState>('/state')
      lastHostBlocks = state.blocksList || []
      // 移除旧的体素精细模
      for (const child of [...solidMesh.children]) if ((child as THREE.Object3D).userData?.voxelRebuild) solidMesh.remove(child)
      const group = makeVoxelGroup(lastHostBlocks)
      group.userData.voxelRebuild = true
      solidMesh.add(group)
      setReport(`已从素体读取 ${lastHostBlocks.length} 块，生成体素精细模（叠加在场景中）`)
    } catch (e) {
      setReport('素体→精细模失败：' + String(e))
    }
  })

  toolbar.querySelector('#compare')!.addEventListener('click', async () => {
    try {
      const state = await api<VoxelState>('/state')
      const hostSet = new Set((state.blocksList || []).map((b) => b.x + ',' + b.y + ',' + b.z))
      const origSet = new Set(voxelCoords.map(([x, y, z]) => x + ',' + y + ',' + z))
      let same = 0
      for (const k of origSet) if (hostSet.has(k)) same++
      const onlyOrig = origSet.size - same
      const onlyHost = hostSet.size - same
      setReport(
        `比对：初始体素 ${origSet.size} 块，当前素体 ${hostSet.size} 块\n` +
        `一致 ${same} 块\n仅在初始：${onlyOrig} 块\n仅在当前素体：${onlyHost} 块\n` +
        (onlyOrig + onlyHost === 0 ? '✅ 完全一致' : '❌ 有差异，可继续体素化/修复迭代')
      )
    } catch (e) {
      setReport('比对失败：' + String(e))
    }
  })

  toolbar.querySelector('#restart')!.addEventListener('click', () => {
    // 清除叠加的体素精细模
    for (const child of [...solidMesh.children]) if ((child as THREE.Object3D).userData?.voxelRebuild) solidMesh.remove(child)
    setStage(0)
    setReport('管线已重跑')
  })

  setStage(0)

  return root
}

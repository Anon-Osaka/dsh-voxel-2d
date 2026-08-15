/**
 * dsh-voxel-2d — 客户端视觉工作台。
 * 四页签：3D 等距视图（拖拽旋转/滚轮缩放）/ Y 层切片（点击编辑）/
 * 正交三视图（违规高亮）/ 校验报告（确定性不变量 + 自动修复）。
 * 数据全部经宿主 API（/@dsh-external/dsh-voxel-2d/api）读写同一世界。
 */
const API_BASE = '/@dsh-external/dsh-voxel-2d/api'

interface Block {
  x: number
  y: number
  z: number
  t: string
}

interface BState {
  name: string
  size: { x: number; y: number; z: number }
  version: number
  blocks: number
  bbox: string | null
  layers: { y: number; count: number }[]
  slices: { y: number; rows: string[] }[]
  views: { TOP: string[]; FRONT: string[]; SIDE: string[] }
  consistency: {
    checked: { TOP: number; FRONT: number; SIDE: number }
    violations: { view: string; cell: number[]; reason: string }[]
    doorAgree: boolean | null
  }
  blocksList: Block[]
  palette: Record<string, string>
  demos: string[]
}

interface ValidateResult {
  ok: boolean
  report: {
    ok: boolean
    blocks: number
    checks: { name: string; pass: boolean; detail: string }[]
    floating: { count: number }
    floorHoles: { count: number }
    doorGap1: { count: number }
    interiorFill: { count: number }
    layers: { y: number; count: number }[]
  }
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
    else if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v as EventListener)
    } else el.setAttribute(k, String(v))
  }
  for (const c of kids) el.append(typeof c === 'string' ? document.createTextNode(c) : c)
  return el
}

function shade(hex: string, f: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) return hex
  const n = parseInt(m[1], 16)
  const r = Math.min(255, Math.round(((n >> 16) & 255) * f))
  const g = Math.min(255, Math.round(((n >> 8) & 255) * f))
  const b = Math.min(255, Math.round((n & 255) * f))
  return `rgb(${r},${g},${b})`
}

async function api(path: string, body?: unknown): Promise<{ ok: boolean; state?: BState; [k: string]: unknown }> {
  const res = await fetch(API_BASE + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) throw new Error('HTTP ' + res.status)
  return res.json()
}

const CSS_ID = 'dsh-voxel-2d-style'
function injectCss(): void {
  if (document.getElementById(CSS_ID)) return
  const style = document.createElement('style')
  style.id = CSS_ID
  style.textContent = `
.v2d-root { font-family: ui-sans-serif, system-ui, "Segoe UI", sans-serif; font-size: 13px; color: var(--dsh-text, #444); }
.v2d-root * { box-sizing: border-box; }
.v2d-header { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 8px 12px; border: 1px solid var(--dsh-border, rgba(128,128,128,.35)); border-radius: 10px; margin-bottom: 8px; background: var(--dsh-card, rgba(128,128,128,.06)); }
.v2d-title { font-weight: 700; font-size: 14px; }
.v2d-meta { opacity: .75; font-family: ui-monospace, monospace; font-size: 12px; }
.v2d-dot { width: 8px; height: 8px; border-radius: 50%; background: #7ed07e; display: inline-block; }
.v2d-dot.off { background: #e5484d; }
.v2d-tabs { display: flex; gap: 4px; margin-bottom: 8px; flex-wrap: wrap; }
.v2d-tab { padding: 5px 14px; border: 1px solid var(--dsh-border, rgba(128,128,128,.35)); border-radius: 999px; cursor: pointer; background: transparent; color: inherit; }
.v2d-tab.active { background: var(--dsh-accent, #4f7cff); border-color: transparent; color: #fff; }
.v2d-toolbar { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; margin-bottom: 8px; }
.v2d-btn { padding: 4px 10px; border: 1px solid var(--dsh-border, rgba(128,128,128,.4)); border-radius: 6px; cursor: pointer; background: var(--dsh-card, rgba(128,128,128,.08)); color: inherit; }
.v2d-btn:hover { filter: brightness(1.12); }
.v2d-btn.primary { background: #4f7cff; border-color: transparent; color: #fff; }
.v2d-btn.danger { background: #e5484d; border-color: transparent; color: #fff; }
.v2d-select, .v2d-input { padding: 3px 6px; border: 1px solid var(--dsh-border, rgba(128,128,128,.4)); border-radius: 6px; background: var(--dsh-card, rgba(128,128,128,.08)); color: inherit; }
.v2d-pane { border: 1px solid var(--dsh-border, rgba(128,128,128,.35)); border-radius: 10px; padding: 10px; background: var(--dsh-card, rgba(128,128,128,.04)); min-height: 120px; }
.v2d-canvas-wrap { position: relative; }
.v2d-canvas { display: block; width: 100%; height: 400px; cursor: grab; border-radius: 8px; background: var(--dsh-canvas-bg, rgba(0,0,0,.03)); }
.v2d-canvas:active { cursor: grabbing; }
.v2d-hint { position: absolute; right: 10px; bottom: 8px; opacity: .55; font-size: 11px; pointer-events: none; }
.v2d-layerbar { display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 8px; }
.v2d-layerbtn { padding: 3px 9px; border: 1px solid var(--dsh-border, rgba(128,128,128,.35)); border-radius: 6px; cursor: pointer; background: transparent; color: inherit; font-family: ui-monospace, monospace; }
.v2d-layerbtn.active { background: #4f7cff; color: #fff; border-color: transparent; }
.v2d-gridcanvas { image-rendering: pixelated; cursor: pointer; border-radius: 6px; }
.v2d-views { display: flex; gap: 14px; flex-wrap: wrap; }
.v2d-viewblock { text-align: center; }
.v2d-viewblock .v2d-label { font-weight: 600; margin-bottom: 4px; font-family: ui-monospace, monospace; }
.v2d-viewblock .v2d-sub { opacity: .7; font-size: 11px; margin-top: 4px; }
.v2d-check { display: flex; gap: 8px; padding: 6px 8px; border-radius: 8px; margin-bottom: 6px; align-items: baseline; background: var(--dsh-card, rgba(128,128,128,.05)); }
.v2d-check .mark { font-weight: 800; }
.v2d-check.pass .mark { color: #2e9e5b; }
.v2d-check.fail .mark { color: #e5484d; }
.v2d-check .name { font-weight: 600; min-width: 90px; }
.v2d-check .detail { opacity: .8; }
.v2d-fixes { margin-top: 8px; }
.v2d-fixes li { margin-bottom: 2px; }
.v2d-legend { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 8px; opacity: .85; }
.v2d-swatch { display: inline-flex; align-items: center; gap: 4px; }
.v2d-swatch i { width: 10px; height: 10px; border-radius: 3px; display: inline-block; border: 1px solid rgba(0,0,0,.25); }
.v2d-footer { margin-top: 8px; opacity: .55; font-size: 11px; }
.v2d-hist { display: flex; align-items: flex-end; gap: 3px; height: 40px; margin-top: 6px; }
.v2d-hist i { width: 14px; background: #4f7cff88; border-radius: 2px 2px 0 0; }
`
  document.head.append(style)
}

// ── 等距 3D 渲染 ──────────────────────────────────────────────────
interface Cam {
  yaw: number
  pitch: number
  zoom: number
}

function drawIso(canvas: HTMLCanvasElement, state: BState, cam: Cam): void {
  const dpr = window.devicePixelRatio || 1
  const w = canvas.clientWidth
  const h = canvas.clientHeight
  if (w === 0 || h === 0) return
  const pw = Math.round(w * dpr)
  const ph = Math.round(h * dpr)
  if (canvas.width !== pw || canvas.height !== ph) {
    canvas.width = pw
    canvas.height = ph
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)

  const W = state.size.x
  const H = state.size.y
  const D = state.size.z
  const u = Math.min(w / (W + D + 1), h / (W + D + 1)) * 1.15 * cam.zoom
  const v = u * 1.28
  const th = (cam.yaw * Math.PI) / 180
  const cosT = Math.cos(th)
  const sinT = Math.sin(th)
  const cosP = Math.cos((cam.pitch * Math.PI) / 180)

  const proj = (x: number, y: number, z: number): [number, number] => {
    const xr = x * cosT - z * sinT
    const zr = x * sinT + z * cosT
    const sx = (xr - zr) * u
    const sy = ((xr + zr) * u * 0.5 - y * v) * cosP
    return [sx, sy]
  }
  // 朝向相机的视轴（场景绕 Y 旋转后，相机轴 = R(-θ)·(1,1,-1)）
  const ax = cosT - sinT
  const az = cosT + sinT
  const [ox, oy] = proj(W / 2, H * 0.42, D / 2)
  const tx = w / 2 - ox
  const ty = h / 2 - oy
  const px = (x: number, y: number, z: number): [number, number] => {
    const [sx, sy] = proj(x, y, z)
    return [sx + tx, sy + ty]
  }
  const poly = (pts: Array<[number, number]>, fill: string, stroke = 'rgba(0,0,0,.28)'): void => {
    ctx.beginPath()
    ctx.moveTo(pts[0][0], pts[0][1])
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1])
    ctx.closePath()
    ctx.fillStyle = fill
    ctx.fill()
    ctx.strokeStyle = stroke
    ctx.lineWidth = 0.75
    ctx.stroke()
  }

  // 地面菱形网格
  ctx.strokeStyle = 'rgba(128,128,128,.20)'
  ctx.lineWidth = 1
  for (let x = 0; x <= W; x++) {
    poly([px(x, 0, 0), px(x, 0, D)], 'transparent', 'rgba(128,128,128,.20)')
  }
  for (let z = 0; z <= D; z++) {
    poly([px(0, 0, z), px(W, 0, z)], 'transparent', 'rgba(128,128,128,.20)')
  }

  if (state.blocksList.length === 0) {
    ctx.fillStyle = 'rgba(128,128,128,.6)'
    ctx.font = '13px ui-monospace, monospace'
    ctx.textAlign = 'center'
    ctx.fillText('空世界 — 在「Y 层切片」页签绘制，或载入演示', w / 2, h / 2)
    return
  }

  const depth = (b: Block): number => b.x * ax + b.y + b.z * az
  const blocks = [...state.blocksList].sort((a, b) => depth(a) - depth(b))

  for (const b of blocks) {
    const base = state.palette[b.t] ?? '#9aa3ad'
    const x = b.x, y = b.y, z = b.z
    const x1 = x + 1, y1 = y + 1, z1 = z + 1
    // 顶面（+y 恒可见）
    poly([px(x, y1, z), px(x1, y1, z), px(x1, y1, z1), px(x, y1, z1)], shade(base, 1.0))
    if (ax > 0) {
      poly([px(x1, y, z), px(x1, y1, z), px(x1, y1, z1), px(x1, y, z1)], shade(base, 0.78))
    } else {
      poly([px(x, y, z), px(x, y1, z), px(x, y1, z1), px(x, y, z1)], shade(base, 0.78))
    }
    if (az > 0) {
      poly([px(x, y, z1), px(x1, y, z1), px(x1, y1, z1), px(x, y1, z1)], shade(base, 0.6))
    } else {
      poly([px(x, y, z), px(x1, y, z), px(x1, y1, z), px(x, y1, z)], shade(base, 0.6))
    }
  }
}

// ── 面板主体 ──────────────────────────────────────────────────────
export function mountPanel(): HTMLElement {
  injectCss()
  let state: BState | null = null
  let lastVersion = -1
  let online = false
  let validateResult: ValidateResult | null = null
  let currentTab = '3d'
  let selLayer = 0
  let selType = 'stone'
  const cam: Cam = { yaw: 0, pitch: 28, zoom: 1 }

  const refs: Record<string, HTMLElement> = {}

  // ── 各页签渲染 ─────────────────────────────────────────────
  const renderHeader = (): void => {
    const s = refs
    const name = s.name as HTMLElement
    name.textContent = state ? `🧊 ${state.name}` : '🧊 体素 3D→2D 工作台'
    const meta = s.meta as HTMLElement
    meta.textContent = state
      ? `${state.size.x}×${state.size.y}×${state.size.z} · ${state.blocks} 块 · ${state.bbox ?? '空'} · v${state.version}`
      : '连接中…'
    ;(s.dot as HTMLElement).className = 'v2d-dot' + (online ? '' : ' off')
  }

  // 页签显隐（先声明，renderAll 依赖）
  const panes: Array<[string, HTMLElement]> = []
  const syncTabs = (): void => {
    for (const [id, pane] of panes) {
      pane.style.display = id === currentTab ? '' : 'none'
    }
  }

  const render3d = (): void => {
    if (currentTab !== '3d' || !state) return
    const s = refs
    drawIso(s.canvas3d as HTMLCanvasElement, state, cam)
  }

  const renderSlices = (): void => {
    if (currentTab !== 'slice' || !state) return
    const s = refs
    const bar = s.layerbar as HTMLElement
    bar.innerHTML = ''
    const H = state.size.y
    for (let y = H - 1; y >= 0; y--) {
      const cnt = state.layers.find((l) => l.y === y)?.count ?? 0
      bar.append(h('button', {
        class: 'v2d-layerbtn' + (y === selLayer ? ' active' : ''),
        onclick: () => { selLayer = y; renderSlices() },
      }, `y${y}·${cnt}`))
    }
    drawSliceGrid(s.sliceCanvas as HTMLCanvasElement, state, selLayer)
  }

  const renderViews = (): void => {
    if (currentTab !== 'views' || !state) return
    const s = refs
    drawViewGrid(s.viewTop as HTMLCanvasElement, state, 'TOP')
    drawViewGrid(s.viewFront as HTMLCanvasElement, state, 'FRONT')
    drawViewGrid(s.viewSide as HTMLCanvasElement, state, 'SIDE')
    const c = state.consistency
    ;(s.viewInfo as HTMLElement).textContent =
      `检查 TOP=${c.checked.TOP} FRONT=${c.checked.FRONT} SIDE=${c.checked.SIDE} · 跨视图违规 ${c.violations.length} 处` +
      (c.doorAgree === null ? '' : ` · 门洞一致性 ${c.doorAgree ? '一致 ✓' : '不一致 ✗'}`)
  }

  const renderValidate = (): void => {
    if (currentTab !== 'validate') return
    const s = refs
    const box = s.validateBox as HTMLElement
    box.innerHTML = ''
    if (!validateResult) {
      box.append(h('div', { style: { opacity: .7 } }, '尚未校验 — 点击「运行校验」'))
      return
    }
    const r = validateResult
    const head = h('div', { class: 'v2d-check ' + (r.report.ok ? 'pass' : 'fail') },
      [h('span', { class: 'mark' }, r.report.ok ? '✓' : '✗'),
       h('span', { class: 'name' }, '总体'),
       h('span', { class: 'detail' }, `${r.report.ok ? '全部不变量通过' : '存在缺陷'}（${r.report.blocks} 块）`)])
    box.append(head)
    for (const c of r.report.checks) {
      box.append(h('div', { class: 'v2d-check ' + (c.pass ? 'pass' : 'fail') },
        [h('span', { class: 'mark' }, c.pass ? '✓' : '✗'),
         h('span', { class: 'name' }, c.name),
         h('span', { class: 'detail' }, c.detail)]))
    }
    if (r.fixes.length > 0) {
      const ul = h('ul', { class: 'v2d-fixes' }, [h('b', {}, `自动修复（${r.before} → ${r.after} 块）`)])
      for (const f of r.fixes) ul.append(h('li', {}, f))
      box.append(ul)
    }
    const hist = h('div', { class: 'v2d-hist' })
    const counts = r.report.layers
    const max = Math.max(1, ...counts.map((l) => l.count))
    for (const l of counts) {
      hist.append(h('i', { style: { height: `${Math.round((l.count / max) * 36) + 2}px` }, title: `y${l.y}: ${l.count}` }))
    }
    box.append(h('div', { class: 'v2d-sub' }, `层分布（${counts.length} 层有方块）`), hist)
  }

  const renderAll = (): void => {
    syncTabs()
    renderHeader()
    render3d()
    renderSlices()
    renderViews()
    renderValidate()
  }

  // ── 切片网格绘制 ────────────────────────────────────────────
  const drawSliceGrid = (canvas: HTMLCanvasElement, st: BState, y: number): void => {
    const W = st.size.x
    const D = st.size.z
    const cell = 30
    const dpr = window.devicePixelRatio || 1
    const pw = W * cell * dpr
    const ph = D * cell * dpr
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw
      canvas.height = ph
      canvas.style.width = W * cell + 'px'
      canvas.style.height = D * cell + 'px'
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, W * cell, D * cell)
    const slice = st.slices.find((l) => l.y === y)
    for (let ri = 0; ri < D; ri++) {
      const z = D - 1 - ri
      for (let x = 0; x < W; x++) {
        const row = slice?.rows[ri] ?? ''
        const filled = row[x] === '#'
        ctx.fillStyle = filled ? (st.palette[blockTypeAt(st, x, y, z)] ?? '#9aa3ad') : 'rgba(128,128,128,.07)'
        ctx.fillRect(x * cell, ri * cell, cell, cell)
        ctx.strokeStyle = 'rgba(128,128,128,.35)'
        ctx.lineWidth = 1
        ctx.strokeRect(x * cell + 0.5, ri * cell + 0.5, cell, cell)
      }
    }
    // 坐标标签
    ctx.fillStyle = 'rgba(128,128,128,.8)'
    ctx.font = '9px ui-monospace, monospace'
    ctx.textAlign = 'center'
    for (let x = 0; x < W; x++) ctx.fillText(String(x), x * cell + cell / 2, D * cell + 10)
    for (let ri = 0; ri < D; ri++) ctx.fillText(String(D - 1 - ri), 10, ri * cell + 12)
  }

  const blockTypeAt = (st: BState, x: number, y: number, z: number): string =>
    st.blocksList.find((b) => b.x === x && b.y === y && b.z === z)?.t ?? 'stone'

  // ── 三视图网格绘制 ──────────────────────────────────────────
  const drawViewGrid = (canvas: HTMLCanvasElement, st: BState, view: 'TOP' | 'FRONT' | 'SIDE'): void => {
    const rows = st.views[view]
    const n = Math.max(rows.length, rows[0]?.length ?? 0)
    const cell = 30
    const dpr = window.devicePixelRatio || 1
    const size = n * cell
    const pw = size * dpr
    const ph = size * dpr
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw
      canvas.height = ph
      canvas.style.width = size + 'px'
      canvas.style.height = size + 'px'
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, size, size)
    const violations = new Set(st.consistency.violations.filter((v) => v.view === view).map((v) => v.cell.join(',')))
    for (let ri = 0; ri < rows.length; ri++) {
      for (let ci = 0; ci < rows[ri].length; ci++) {
        const filled = rows[ri][ci] === '#'
        ctx.fillStyle = filled ? '#8a93a0' : 'rgba(128,128,128,.07)'
        ctx.fillRect(ci * cell, ri * cell, cell, cell)
        if (violations.has(`${ci},${ri}`)) {
          ctx.fillStyle = 'rgba(229,72,77,.45)'
          ctx.fillRect(ci * cell, ri * cell, cell, cell)
          ctx.strokeStyle = '#e5484d'
          ctx.lineWidth = 2
          ctx.strokeRect(ci * cell + 1, ri * cell + 1, cell - 2, cell - 2)
        }
        ctx.strokeStyle = 'rgba(128,128,128,.35)'
        ctx.lineWidth = 1
        ctx.strokeRect(ci * cell + 0.5, ri * cell + 0.5, cell, cell)
      }
    }
  }

  // ── 数据加载 ────────────────────────────────────────────────
  const load = async (): Promise<void> => {
    try {
      const r = await api('/state')
      if (r.ok && r.state) {
        state = r.state as BState
        online = true
        if (state.version !== lastVersion) {
          lastVersion = state.version
          renderAll()
        } else {
          renderHeader()
        }
      }
    } catch {
      online = false
      renderHeader()
    }
  }

  const mutate = async (path: string, body?: unknown): Promise<void> => {
    try {
      const r = await api(path, body)
      if (r.state) state = r.state as BState
      if (r && 'report' in r) validateResult = r as unknown as ValidateResult
      online = true
      lastVersion = state?.version ?? -1
      renderAll()
    } catch {
      online = false
      renderHeader()
    }
  }

  // ── DOM 构建 ────────────────────────────────────────────────
  const root = h('div', { class: 'v2d-root' })

  const header = h('div', { class: 'v2d-header' }, [
    h('span', { class: 'v2d-dot' }),
    h('span', { class: 'v2d-title' }, '🧊 体素 3D→2D 工作台'),
    h('span', { class: 'v2d-meta' }),
    h('span', { style: { flex: 1 } }),
    h('label', {}, [h('input', { type: 'checkbox', checked: true }), ' 自动刷新']),
    h('button', { class: 'v2d-btn', onclick: () => void load() }, '刷新'),
  ])
  refs.dot = header.children[0] as HTMLElement
  refs.name = header.children[1] as HTMLElement
  refs.meta = header.children[2] as HTMLElement
  const autoCheck = header.querySelector('input') as HTMLInputElement

  const toolbar = h('div', { class: 'v2d-toolbar' }, [
    h('select', { class: 'v2d-select' }, ['house', 'tower', 'chimney-house'].map((d) =>
      h('option', { value: d }, d))),
    h('button', { class: 'v2d-btn primary', onclick: () => void mutate('/demo', { demo: (toolbar.children[0] as HTMLSelectElement).value }) }, '载入演示'),
    h('button', { class: 'v2d-btn', onclick: () => void mutate('/gravity') }, '重力'),
    h('button', { class: 'v2d-btn', onclick: () => void mutate('/validate', { house: true }) }, '校验'),
    h('button', { class: 'v2d-btn', onclick: () => void mutate('/validate', { house: true, autoFix: true }) }, '自动修复'),
    h('select', { class: 'v2d-select' }, ['8', '10', '12', '16'].map((s) => h('option', { value: s }, s + '³'))),
    h('button', { class: 'v2d-btn', onclick: () => void mutate('/resize', { size: Number((toolbar.children[4] as HTMLSelectElement).value) }) }, '改尺寸'),
    h('button', { class: 'v2d-btn', onclick: () => void mutate('/clear') }, '清空'),
    h('button', {
      class: 'v2d-btn',
      onclick: () => {
        if (!state) return
        const blob = new Blob([JSON.stringify({
          name: state.name, size: state.size,
          coords: state.blocksList.map((b) => [b.x, b.y, b.z]),
        }, null, 2)], { type: 'application/json' })
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = 'voxel-world.json'
        a.click()
        URL.revokeObjectURL(a.href)
      },
    }, '导出坐标'),
  ])

  const tabs = h('div', { class: 'v2d-tabs' })
  const tabDefs: Array<[string, string]> = [['3d', '3D 视图'], ['slice', 'Y 层切片'], ['views', '三视图'], ['validate', '校验报告']]
  for (const [id, label] of tabDefs) {
    tabs.append(h('button', {
      class: 'v2d-tab' + (id === currentTab ? ' active' : ''),
      onclick: () => {
        currentTab = id
        ;Array.from(tabs.children).forEach((c, i) => {
          c.className = 'v2d-tab' + (tabDefs[i][0] === currentTab ? ' active' : '')
        })
        renderAll()
      },
    }, label))
  }

  // 3D 页签
  const pane3d = h('div', { class: 'v2d-pane v2d-canvas-wrap' })
  const canvas3d = h('canvas', { class: 'v2d-canvas' })
  canvas3d.addEventListener('mousedown', (e) => {
    const startX = e.clientX
    const startY = e.clientY
    const yaw0 = cam.yaw
    const pitch0 = cam.pitch
    const onMove = (ev: MouseEvent): void => {
      cam.yaw = yaw0 + (ev.clientX - startX) * 0.45
      cam.pitch = Math.max(8, Math.min(82, pitch0 + (ev.clientY - startY) * 0.35))
      drawIso(canvas3d, state!, cam)
    }
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  })
  canvas3d.addEventListener('wheel', (e) => {
    e.preventDefault()
    cam.zoom = Math.max(0.35, Math.min(3, cam.zoom * (e.deltaY < 0 ? 1.1 : 0.9)))
    drawIso(canvas3d, state!, cam)
  }, { passive: false })
  canvas3d.addEventListener('dblclick', () => {
    cam.yaw = 0
    cam.pitch = 28
    cam.zoom = 1
    drawIso(canvas3d, state!, cam)
  })
  refs.canvas3d = canvas3d
  pane3d.append(canvas3d, h('div', { class: 'v2d-hint' }, '拖动旋转 · 滚轮缩放 · 双击复位'))

  // 切片页签
  const paneSlice = h('div', { class: 'v2d-pane' }, [
    h('div', { class: 'v2d-layerbar' }),
    h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '6px' } }, [
      h('span', {}, '放置类型:'),
      h('select', { class: 'v2d-select' }, Object.keys({ stone: 1, wood: 1, sand: 1, glass: 1, brick: 1, snow: 1, leaves: 1, roof: 1 }).map((t) =>
        h('option', { value: t }, t))),
      h('span', { class: 'v2d-sub', style: { opacity: .6 } }, '点击格子放置/清除（左键=放置，右键=清除）'),
    ]),
    h('canvas', { class: 'v2d-gridcanvas' }),
    h('div', { class: 'v2d-legend' }),
  ])
  refs.layerbar = paneSlice.children[0] as HTMLElement
  const sliceTypeSel = paneSlice.querySelector('select') as HTMLSelectElement
  refs.sliceCanvas = paneSlice.querySelector('canvas') as HTMLCanvasElement
  const legendBox = paneSlice.children[3] as HTMLElement
  const renderLegend = (palette: Record<string, string>): void => {
    legendBox.innerHTML = ''
    for (const [t, c] of Object.entries(palette)) {
      legendBox.append(h('span', { class: 'v2d-swatch' }, [h('i', { style: { background: c } }), t]))
    }
  }
  ;(refs.sliceCanvas as HTMLCanvasElement).addEventListener('mousedown', (e) => {
    if (!state) return
    const canvas = e.target as HTMLCanvasElement
    const rect = canvas.getBoundingClientRect()
    const cell = 30
    const ci = Math.floor((e.clientX - rect.left) / cell)
    const ri = Math.floor((e.clientY - rect.top) / cell)
    const W = state.size.x
    const D = state.size.z
    if (ci < 0 || ci >= W || ri < 0 || ri >= D) return
    const x = ci
    const z = D - 1 - ri
    const clearing = e.button === 2
    void mutate('/block', { x, y: selLayer, z, type: clearing ? '' : (sliceTypeSel.value || 'stone') })
  })
  refs.sliceCanvas.addEventListener('contextmenu', (e) => e.preventDefault())

  // 三视图页签
  const paneViews = h('div', { class: 'v2d-pane' }, [
    h('div', { class: 'v2d-views' }, [
      h('div', { class: 'v2d-viewblock' }, [h('div', { class: 'v2d-label' }, 'TOP 顶视图'), h('canvas', { class: 'v2d-gridcanvas' })]),
      h('div', { class: 'v2d-viewblock' }, [h('div', { class: 'v2d-label' }, 'FRONT 正视图'), h('canvas', { class: 'v2d-gridcanvas' })]),
      h('div', { class: 'v2d-viewblock' }, [h('div', { class: 'v2d-label' }, 'SIDE 侧视图'), h('canvas', { class: 'v2d-gridcanvas' })]),
    ]),
    h('div', { class: 'v2d-sub', style: { marginTop: '8px', opacity: .7 } }),
    h('div', { class: 'v2d-sub', style: { marginTop: '4px', opacity: .5 } }, '红色 = 跨视图一致性违规（三张正交投影不唯一确定体素网格 — 离散断层成像）；' +
      '门洞一致性需 FRONT x=3 列见 ≥2 格空段且上方有横梁——完整小屋的门洞会被后墙/屋顶遮挡，属正常'),
  ])
  const viewCanvases = paneViews.querySelectorAll('canvas')
  refs.viewTop = viewCanvases[0] as HTMLCanvasElement
  refs.viewFront = viewCanvases[1] as HTMLCanvasElement
  refs.viewSide = viewCanvases[2] as HTMLCanvasElement
  refs.viewInfo = paneViews.children[1] as HTMLElement

  // 校验页签
  const paneValidate = h('div', { class: 'v2d-pane' }, [h('div', { class: 'v2d-check', style: { opacity: .55 } },
    [h('span', {}, '确定性不变量：无支撑块 / 地板实心 / 门高≥2 / 室内空心。' +
      '「无支撑块」对横跨空心室内的屋顶会误报（Minecraft 中合法），以地板实心+门窗特征为准（实验方法学备注）。')]),
    h('div')])
  refs.validateBox = paneValidate.children[1] as HTMLElement

  const footer = h('div', { class: 'v2d-footer' },
    '范式取自 yjh051108/voxel-3d-to-2d 实验：二维是推理画布，三维一致性交给代数兜底 — 堆叠/投影/重力/校验全部确定性代码，模型只做 2D 层编辑。')

  root.append(header, toolbar, tabs, pane3d, paneSlice, paneViews, paneValidate, footer)

  // 注册页签 → 面板映射（renderAll 的 syncTabs 使用）
  panes.push(['3d', pane3d], ['slice', paneSlice], ['views', paneViews], ['validate', paneValidate])
  syncTabs()

  // 轮询（面板卸载即停）
  let alive = true
  const tick = async (): Promise<void> => {
    if (!alive || !root.isConnected) {
      alive = false
      return
    }
    if (autoCheck.checked) await load()
    window.setTimeout(() => void tick(), 1500)
  }
  void tick()

  // 首次加载 + 图例
  void load().then(() => {
    if (state) {
      renderLegend(state.palette)
      selLayer = state.size.y - 1
    }
    renderAll()
  })

  // 兜底：面板被移除时停轮询
  const observer = new MutationObserver(() => {
    if (!root.isConnected) {
      alive = false
      observer.disconnect()
    }
  })
  observer.observe(root, { childList: true, subtree: true })

  return root
}

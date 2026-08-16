/**
 * dsh-voxel-2d — 3D 装配体设计工作流（总布置 → 接口点 → 子系统 → 剖切语义 → 三视图验收）。
 *
 * 把“先总布置、再接口、后几何、先验收、再堆细节”的原则固化成可检查的状态。
 * 组件以体素盒形式落到 VoxelWorld，方块类型即组件名；剖切时只裁 shell 组，内部组保留。
 */
import { VoxelWorld } from './world.js'

export type AssemblyGroup = 'shell' | 'internal' | 'external'

export interface AssemblyComponent {
  name: string
  /** 组件 bbox 最小角 */
  x: number
  y: number
  z: number
  w: number
  h: number
  d: number
  group: AssemblyGroup
}

export interface AssemblyInterface {
  name: string
  component: string
  point: [number, number, number]
  /** 应连接的另一个接口点名称 */
  peer?: string
}

export interface AssemblyLayout {
  name: string
  axes: string
  components: Record<string, AssemblyComponent>
  interfaces: Record<string, AssemblyInterface>
}

const layouts = new Map<string, AssemblyLayout>()

export function initAssembly(name: string, axes: string): AssemblyLayout {
  const layout: AssemblyLayout = { name, axes, components: {}, interfaces: {} }
  layouts.set(name, layout)
  return layout
}

export function getAssembly(name: string): AssemblyLayout | undefined {
  return layouts.get(name)
}

export function addComponent(layout: AssemblyLayout, comp: AssemblyComponent): void {
  layout.components[comp.name] = comp
}

export function addInterface(layout: AssemblyLayout, iface: AssemblyInterface): void {
  layout.interfaces[iface.name] = iface
}

export function materializeLayout(layout: AssemblyLayout, world: VoxelWorld): number {
  let n = 0
  for (const c of Object.values(layout.components)) {
    for (let x = c.x; x < c.x + c.w; x++) {
      for (let y = c.y; y < c.y + c.h; y++) {
        for (let z = c.z; z < c.z + c.d; z++) {
          if (world.set(x, y, z, c.name)) n++
        }
      }
    }
  }
  return n
}

function inComponent(c: AssemblyComponent, p: [number, number, number]): boolean {
  return p[0] >= c.x && p[0] < c.x + c.w &&
         p[1] >= c.y && p[1] < c.y + c.h &&
         p[2] >= c.z && p[2] < c.z + c.d
}

export interface AssemblyCheckResult {
  ok: boolean
  items: Array<{ name: string; pass: boolean; detail: string }>
  interfaceCount: number
  componentCount: number
}

export function checkLayout(layout: AssemblyLayout, world: VoxelWorld, tolerance = 1): AssemblyCheckResult {
  const items: Array<{ name: string; pass: boolean; detail: string }> = []
  const comps = Object.values(layout.components)
  const ifaces = Object.values(layout.interfaces)

  items.push({
    name: '总布置已定义',
    pass: comps.length > 0 && layout.axes.trim().length > 0,
    detail: `组件 ${comps.length} 个，坐标轴说明: ${layout.axes || '（空）'}`,
  })

  let ifaceInside = 0
  for (const i of ifaces) {
    const c = layout.components[i.component]
    if (!c) {
      items.push({ name: `接口 ${i.name} 归属组件`, pass: false, detail: `组件 ${i.component} 不存在` })
      continue
    }
    if (inComponent(c, i.point)) ifaceInside++
    else items.push({ name: `接口 ${i.name} 在组件内`, pass: false, detail: `点 (${i.point.join(',')}) 不在 ${i.component} bbox 内` })
  }
  items.push({
    name: '接口点均落在组件 bbox 内',
    pass: ifaceInside === ifaces.length,
    detail: `${ifaceInside}/${ifaces.length} 个接口点落在组件内`,
  })

  let connected = 0
  const peerPairs = new Set<string>()
  for (const i of ifaces) {
    if (!i.peer) continue
    const key = [i.name, i.peer].sort().join('<=>')
    if (peerPairs.has(key)) continue
    peerPairs.add(key)
    const peer = layout.interfaces[i.peer]
    if (!peer) {
      items.push({ name: `接口 ${i.name}↔${i.peer}`, pass: false, detail: `peer 接口 ${i.peer} 不存在` })
      continue
    }
    const dist = Math.hypot(i.point[0] - peer.point[0], i.point[1] - peer.point[1], i.point[2] - peer.point[2])
    if (dist <= tolerance) connected++
    else items.push({ name: `接口 ${i.name}↔${i.peer}`, pass: false, detail: `距离 ${dist.toFixed(2)} > 容差 ${tolerance}` })
  }
  items.push({
    name: '成对接口已对齐',
    pass: connected === peerPairs.size,
    detail: `${connected}/${peerPairs.size} 对接口对齐`,
  })

  if (world.count() > 0) {
    const views = world.projectViews()
    items.push({
      name: '三视图可生成',
      pass: views.TOP.length > 0 && views.FRONT.length > 0 && views.SIDE.length > 0,
      detail: `TOP ${views.TOP.length} 行 / FRONT ${views.FRONT.length} 行 / SIDE ${views.SIDE.length} 行`,
    })
  }

  const failed = items.filter((i) => !i.pass)
  return { ok: failed.length === 0, items, interfaceCount: ifaces.length, componentCount: comps.length }
}

export interface CutawayResult {
  removed: number
  remaining: number
  detail: string
}

export function applyCutaway(
  layout: AssemblyLayout,
  world: VoxelWorld,
  axis: 'x' | 'y' | 'z',
  position: number,
): CutawayResult {
  let removed = 0
  const shell = new Set(Object.values(layout.components).filter((c) => c.group === 'shell').map((c) => c.name))
  const coords = world.coords()
  for (const [x, y, z] of coords) {
    const t = world.get(x, y, z)
    if (!t || !shell.has(t)) continue
    const hit = axis === 'x' ? x >= position : axis === 'y' ? y >= position : z >= position
    if (hit) {
      world.set(x, y, z, null)
      removed++
    }
  }
  return { removed, remaining: world.count(), detail: `剖切 ${axis}=${position}：移除 ${removed} 个外壳块，保留 ${world.count()} 块` }
}

export interface AcceptanceItem {
  name: string
  pass: boolean
  detail: string
}

export function acceptance(layout: AssemblyLayout, world: VoxelWorld): { ok: boolean; items: AcceptanceItem[] } {
  const items: AcceptanceItem[] = []
  const comps = Object.values(layout.components)
  const ifaces = Object.values(layout.interfaces)
  const shellCount = comps.filter((c) => c.group === 'shell').length
  const internalCount = comps.filter((c) => c.group === 'internal').length

  items.push({ name: '坐标系与总布置已文档化', pass: comps.length > 0 && layout.axes.trim().length > 0, detail: `组件 ${comps.length} 个，${layout.axes}` })
  items.push({ name: '接口点已定义', pass: ifaces.length > 0, detail: `接口 ${ifaces.length} 个` })
  items.push({ name: '外壳/内脏分组明确', pass: shellCount > 0 && internalCount > 0, detail: `外壳 ${shellCount} 个 / 内脏 ${internalCount} 个` })
  items.push({ name: '三视图可生成', pass: world.count() > 0 && world.projectViews().TOP.length > 0, detail: world.count() > 0 ? `世界 ${world.count()} 块` : '世界为空' })

  const check = checkLayout(layout, world)
  items.push({ name: '接口/总布置校验通过', pass: check.ok, detail: check.ok ? '全部通过' : `${check.items.filter((i) => !i.pass).length} 项未通过` })
  const failed = items.filter((i) => !i.pass)
  return { ok: failed.length === 0, items }
}

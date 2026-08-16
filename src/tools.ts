/**
 * dsh-voxel-2d — 模型侧工具（三种表示法的确定性代数接口）。
 * 范式（取自 voxel-3d-to-2d 实验结论）：模型只做 2D 编辑/输出，
 * 堆叠、投影、重力、一致性、校验与修复全部由确定性代码完成。
 */
import { defineTool, type ToolRuntime } from '@deepseek-ai/dsh-tools'
import { VoxelWorld, DEMOS, parseGridRow } from './world.js'
import { applySpatialCode, exportSpatialCode } from './code_space.js'
import {
  initAssembly, getAssembly, addComponent, addInterface, materializeLayout,
  checkLayout, applyCutaway, acceptance,
} from './assembly.js'

type Summary = {
  name: string
  size: { x: number; y: number; z: number }
  blocks: number
  bbox: string
  version: number
  layers: { y: number; count: number }[]
}

function summarize(w: VoxelWorld): Summary {
  const b = w.bbox()
  return {
    name: w.name,
    size: w.size,
    blocks: w.count(),
    bbox: b ? `x ${b.minX}..${b.maxX}, y ${b.minY}..${b.maxY}, z ${b.minZ}..${b.maxZ}` : '空世界',
    version: w.version,
    layers: w.layerCounts(),
  }
}

const SUMMARY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string' },
    size: {
      type: 'object',
      additionalProperties: false,
      properties: { x: { type: 'integer' }, y: { type: 'integer' }, z: { type: 'integer' } },
    },
    blocks: { type: 'integer' },
    bbox: { type: 'string' },
    version: { type: 'integer' },
    layers: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { y: { type: 'integer' }, count: { type: 'integer' } },
      },
    },
  },
} as const

function summaryText(s: Summary): string {
  const layers = s.layers.map((l) => `y${l.y}:${l.count}`).join(' ')
  return [
    `世界「${s.name}」 ${s.size.x}×${s.size.y}×${s.size.z} 方块=${s.blocks} 包围盒=${s.bbox}`,
    `层分布: ${layers || '（空）'}`,
  ].join('\n')
}

/** 把文本解析为归一化网格行（按世界宽截断/补齐）。 */
function parseGridRows(text: string, width: number): string[] {
  const rows: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().replace(/[^#.xX●█]/g, '')
    if (line.length === 0) continue
    const cells = parseGridRow(line)
    const chars: string[] = []
    for (let i = 0; i < Math.min(cells.length, width); i++) chars.push(cells[i] ? '#' : '.')
    while (chars.length < width) chars.push('.')
    rows.push(chars.join(''))
  }
  return rows
}

function parseSlices(text: string): Array<{ y: number; rows: string[] }> {
  // 先试 JSON：数组 [{y,rows:[...]}] 或对象 {"0": "....", ...}
  const t = text.trim()
  if (t.startsWith('[') || t.startsWith('{')) {
    try {
      const v = JSON.parse(t)
      if (Array.isArray(v)) {
        return v
          .filter((e) => e && typeof e.y === 'number')
          .map((e) => ({ y: e.y, rows: Array.isArray(e.rows) ? e.rows.map(String) : [] }))
      }
      if (typeof v === 'object') {
        const out: Array<{ y: number; rows: string[] }> = []
        for (const k of Object.keys(v)) {
          const y = Number(k.replace(/^y/i, ''))
          if (!Number.isNaN(y)) out.push({ y, rows: Array.isArray(v[k]) ? v[k].map(String) : [String(v[k])] })
        }
        return out
      }
    } catch { /* 落到文本解析 */ }
  }
  // 文本格式：行头 "yN:" / "y=N" / "N:"，其后连续网格行
  const out: Array<{ y: number; rows: string[] }> = []
  let cur: { y: number; rows: string[] } | null = null
  for (const raw of t.split(/\r?\n/)) {
    const line = raw.trim()
    const m = /^y?\s*[:=：]?\s*(\d{1,2})\s*[:：]?\s*$/.exec(line)
    if (m) {
      cur = { y: Number(m[1]), rows: [] }
      out.push(cur)
      continue
    }
    if (/^[#.xX●█]+$/.test(line) && cur) {
      cur.rows.push(line)
    }
  }
  return out
}

function gridText(rows: string[]): string {
  return rows.join('\n')
}

function renderSummary(s: Summary): string {
  return summaryText(s)
}

export interface WorldManager {
  getWorld(): VoxelWorld
  listWorlds(): { names: string[]; current: string; sizes: Record<string, { x: number; y: number; z: number }> }
  switchWorld(name: string, create?: { w?: number; h?: number; d?: number }): VoxelWorld | null
}

export function registerVoxelTools(tools: ToolRuntime, mgr: WorldManager): Array<() => void> {
  const disposers: Array<() => void> = []
  const reg = (def: ReturnType<typeof defineTool>): void => {
    disposers.push(tools.register(def))
  }

  reg(defineTool({
    name: 'voxel_world_init',
    description: '创建/重置体素世界。世界是 W×H×D 的立方体网格：x∈[0,W)，y∈[0,H)（y 向上），z∈[0,D)。可同时载入实验演示结构。之后所有 voxel_* 工具都作用于这个世界。',
    parameters: {
      size: { type: 'integer', description: '边长（4..64，缺省 8，即 8×8×8；32×32 地形沙盘用 32）' },
      name: { type: 'string', description: '世界名（缺省 "world"）' },
      demo: { type: 'string', description: '可选演示结构: house（80 块小屋）/ tower（127 块楼梯塔）/ chimney-house（83 块小屋+烟囱）' },
      type: { type: 'string', description: '演示方块类型（缺省 stone）' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          summary: SUMMARY_SCHEMA,
          note: { type: 'string' },
        },
      },
      render: (_args: unknown, value: { summary: Summary; note: string }) =>
        [{ type: 'text', text: value.note + '\n' + renderSummary(value.summary) }],
    },
    async execute(args: { size?: number; name?: string; demo?: string; type?: string }) {
      const world = mgr.getWorld()
      const size = Math.max(4, Math.min(64, Math.floor(args.size ?? 8)))
      world.clear()
      world.name = (args.name ?? 'world').slice(0, 40)
      if (args.size !== undefined) world.resize(size, size, size)
      let note = '世界已重置'
      if (args.demo) {
        const d = DEMOS[args.demo]
        if (d) {
          world.importCoords(d.coords, args.type ?? d.type)
          note = '载入演示「' + d.name + '」: ' + d.note
        } else {
          note = '未知演示: ' + args.demo + '（可选 house/tower/chimney-house）'
        }
      }
      return { summary: summarize(world), note }
    },
  }))

  reg(defineTool({
    name: 'voxel_demo',
    description: '载入实验演示结构（probe.ps1/probe2.ps1 的真值构建）：house=80 块精确小屋（5x5 占地/围墙/南墙门洞/平屋顶/室内空心），tower=127 块空心塔+螺旋楼梯，chimney-house=83 块小屋+外侧烟囱柱。会清空当前世界。',
    parameters: {
      demo: { type: 'string', required: true, description: 'house | tower | chimney-house' },
      type: { type: 'string', description: '方块类型（缺省 stone）' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          summary: SUMMARY_SCHEMA,
          note: { type: 'string' },
        },
      },
      render: (_args: unknown, value: { summary: Summary; note: string }) =>
        [{ type: 'text', text: value.note + '\n' + renderSummary(value.summary) }],
    },
    async execute(args: { demo: string; type?: string }) {
      const world = mgr.getWorld()
      const d = DEMOS[args.demo]
      if (!d) {
        throw new Error('未知演示: ' + args.demo + '（可选: house / tower / chimney-house）')
      }
      world.clear()
      world.name = d.name.split('（')[0]
      world.importCoords(d.coords, args.type ?? d.type)
      return { summary: summarize(world), note: '已载入「' + d.name + '」' + d.note }
    },
  }))

  reg(defineTool({
    name: 'voxel_layer_get',
    description: '读取一层的 2D 切片网格（B 表示法）：行从上到下 z 递减，列从左到右 x 递增，# 有方块 . 为空。模型可据此做 2D 层编辑。',
    parameters: {
      y: { type: 'integer', required: true, description: '层号（0..H-1）' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          y: { type: 'integer' },
          rows: { type: 'array', items: { type: 'string' } },
          filled: { type: 'integer' },
          legend: { type: 'string' },
        },
      },
      render: (_args: unknown, value: { y: number; rows: string[]; filled: number; legend: string }) =>
        [{ type: 'text', text: 'y=' + value.y + '（填充 ' + value.filled + ' 格）\n' + gridText(value.rows) + '\n' + value.legend }],
    },
    execute: async (args: { y: number }) => {
      const world = mgr.getWorld()
      const s = world.slices().find((l) => l.y === args.y)
      if (!s) throw new Error('层 ' + args.y + ' 超出世界高度 ' + world.size.y)
      const filled = s.rows.join('').split('').filter((c) => c === '#').length
      return { y: args.y, rows: s.rows, filled, legend: '行序 z=' + (world.size.z - 1) + '→0，列序 x=0→' + (world.size.x - 1) }
    },
  }))

  reg(defineTool({
    name: 'voxel_layer_set',
    description: '覆盖设置一层的 2D 切片网格（B 表示法核心原语：模型只编辑单层）。grid 每行恰好 W 个字符，# 有方块 . 为空；行从上到下 z 递减，列从左到右 x 递增。缺行/超行自动补齐截断。可选 type 指定方块类型。',
    parameters: {
      y: { type: 'integer', required: true, description: '层号（0..H-1）' },
      grid: { type: 'string', required: true, description: 'W 行 ASCII 网格（行间换行分隔）' },
      type: { type: 'string', description: '方块类型（缺省 stone；本层现有块清除、新块用此类型）' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          y: { type: 'integer' },
          placed: { type: 'integer' },
          cleared: { type: 'integer' },
          summary: SUMMARY_SCHEMA,
        },
      },
      render: (_args: unknown, value: { y: number; placed: number; cleared: number; summary: Summary }) =>
        [{ type: 'text', text: 'y=' + value.y + ' 层: 放置 ' + value.placed + ' 块，清除 ' + value.cleared + ' 块\n' + renderSummary(value.summary) }],
    },
    execute: async (args: { y: number; grid: string; type?: string }) => {
      const world = mgr.getWorld()
      if (args.y < 0 || args.y >= world.size.y) throw new Error('层 ' + args.y + ' 超出世界高度 ' + world.size.y)
      const rows = parseGridRows(args.grid, world.size.x)
      if (rows.length === 0) throw new Error('grid 为空或格式错误（需要 #/. 组成的网格行）')
      let placed = 0
      let cleared = 0
      for (let z = 0; z < world.size.z; z++) {
        const ri = world.size.z - 1 - z
        const row = rows[ri]
        for (let x = 0; x < world.size.x; x++) {
          const want = row?.[x] === '#'
          const have = world.get(x, args.y, z) !== null
          if (want && !have) { world.set(x, args.y, z, args.type ?? 'stone'); placed++ }
          else if (!want && have) { world.set(x, args.y, z, null); cleared++ }
        }
      }
      return { y: args.y, placed, cleared, summary: summarize(world) }
    },
  }))

  reg(defineTool({
    name: 'voxel_world_build',
    description: '批量构建世界：按 Y 层切片（B 表示法）堆叠成 3D。slices 接受两种格式：① JSON：数组 [{"y":0,"rows":["........",...]},...] 或对象 {"0":"....","1":...}；② 文本：每层以 "yN:" 开头，后跟连续网格行。',
    parameters: {
      slices: { type: 'string', required: true, description: '逐层 2D 网格（JSON 或 yN: 文本格式）' },
      type: { type: 'string', description: '方块类型（缺省 stone）' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          imported: { type: 'integer' },
          layers: { type: 'integer' },
          summary: SUMMARY_SCHEMA,
        },
      },
      render: (_args: unknown, value: { imported: number; layers: number; summary: Summary }) =>
        [{ type: 'text', text: '导入 ' + value.imported + ' 块（' + value.layers + ' 层）\n' + renderSummary(value.summary) }],
    },
    execute: async (args: { slices: string; type?: string }) => {
      const world = mgr.getWorld()
      const parsed = parseSlices(args.slices)
      if (parsed.length === 0) throw new Error('未解析到任何层（需要 "yN:" 头 + #/. 网格行，或 JSON）')
      const imported = world.importSlices(parsed, args.type ?? 'stone')
      return { imported, layers: parsed.length, summary: summarize(world) }
    },
  }))

  reg(defineTool({
    name: 'voxel_code_map',
    description: '把空间代码/伪代码映射到体素世界：支持 for x in 0..4: 嵌套循环、set(x,y,z[,type])、clear(x,y,z)、fill(x0..x1,y0..y1,z0..z1[,type])/box(...)。reset=true 时先清空世界；size 可重设世界尺寸。执行后返回操作数、块数变化、错误列表与校验摘要。',
    parameters: {
      code: { type: 'string', required: true, description: '空间代码/伪代码（Python 风格缩进循环 + set/clear/fill/box）' },
      reset: { type: 'boolean', description: '是否先清空世界（缺省 true）' },
      size: { type: 'integer', description: '可选：应用前把世界重置为 size³（4..64）' },
      validate: { type: 'boolean', description: '是否执行不变量校验（缺省 true）' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ops: { type: 'integer' },
          before: { type: 'integer' },
          after: { type: 'integer' },
          errors: { type: 'array', items: { type: 'string' } },
          ok: { type: 'boolean' },
          checks: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: { name: { type: 'string' }, pass: { type: 'boolean' }, detail: { type: 'string' } },
            },
          },
          summary: SUMMARY_SCHEMA,
        },
      },
      render: (_args: unknown, value: {
        ops: number; before: number; after: number; errors: string[]; ok: boolean
        checks: Array<{ name: string; pass: boolean; detail: string }>; summary: Summary
      }) => {
        const lines = [
          `代码映射完成：${value.ops} 个命令，${value.before} → ${value.after} 块`,
          `校验：${value.ok ? '✅ 通过' : '❌ 存在缺陷'}`,
          ...value.checks.map((c) => (c.pass ? '✓ ' : '✗ ') + c.name + '：' + c.detail),
        ]
        if (value.errors.length > 0) lines.push('解析/执行错误:\n' + value.errors.map((e) => '  - ' + e).join('\n'))
        lines.push(renderSummary(value.summary))
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    execute: async (args: { code: string; reset?: boolean; size?: number; validate?: boolean }) => {
      const world = mgr.getWorld()
      if (args.reset !== false) world.clear()
      if (args.size !== undefined) {
        const s = Math.max(4, Math.min(64, Math.floor(args.size)))
        world.resize(s, s, s)
      }
      const r = applySpatialCode(args.code, world)
      const report = args.validate === false ? null : world.validate(false)
      return {
        ops: r.ops,
        before: r.before,
        after: r.after,
        errors: r.errors,
        ok: report ? report.ok : true,
        checks: report ? report.checks : [],
        summary: summarize(world),
      }
    },
  }))

  reg(defineTool({
    name: 'voxel_code_export',
    description: '把当前体素世界导出为空间代码：style=boxes（缺省）用 fill 合并轴对齐盒，style=blocks 逐格 set。生成代码可直接喂给 voxel_code_map 还原世界。',
    parameters: {
      style: { type: 'string', description: 'boxes（缺省，fill 盒合并）| blocks（逐格 set）' },
      type: { type: 'string', description: '只导出指定方块类型（缺省全部）' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          code: { type: 'string' },
          commands: { type: 'integer' },
          blocks: { type: 'integer' },
          summary: SUMMARY_SCHEMA,
        },
      },
      render: (_args: unknown, value: { code: string; commands: number; blocks: number; summary: Summary }) =>
        [{ type: 'text', text: `体素 → 代码（${value.commands} 条命令，${value.blocks} 块）:\n` + value.code + '\n\n' + renderSummary(value.summary) }],
    },
    execute: async (args: { style?: string; type?: string }) => {
      const world = mgr.getWorld()
      const style = args.style === 'blocks' ? 'blocks' : 'boxes'
      const r = exportSpatialCode(world, style, args.type)
      return { code: r.code, commands: r.commands, blocks: r.blocks, summary: summarize(world) }
    },
  }))

  reg(defineTool({
    name: 'voxel_assembly_init',
    description: '初始化 3D 装配体总布置：定义坐标轴语义、组件包围盒（含外壳/内脏分组），并把组件以体素盒形式写入当前世界。组件用 JSON 数组传入：[{name,x,y,z,w,h,d,group}]，group 为 shell/internal/external。',
    parameters: {
      name: { type: 'string', required: true, description: '布局名（如 diesel-engine）' },
      axes: { type: 'string', required: true, description: '坐标轴说明（如 "Y=气缸轴线 X=曲轴 +Z=前方"）' },
      components: { type: 'json', description: '组件数组 JSON：[{name,x,y,z,w,h,d,group}]' },
      reset: { type: 'boolean', description: '是否先清空世界（缺省 true）' },
      size: { type: 'integer', description: '可选：把世界重置为 size³（4..64）' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          layout: { type: 'string' },
          placed: { type: 'integer' },
          components: { type: 'integer' },
          summary: SUMMARY_SCHEMA,
        },
      },
      render: (_args: unknown, value: { layout: string; placed: number; components: number; summary: Summary }) =>
        [{ type: 'text', text: `总布置「${value.layout}」已初始化：${value.components} 个组件，体素化 ${value.placed} 块\n` + renderSummary(value.summary) }],
    },
    execute: async (args: { name: string; axes: string; components?: unknown; reset?: boolean; size?: number }) => {
      const world = mgr.getWorld()
      if (args.reset !== false) world.clear()
      if (args.size !== undefined) {
        const s = Math.max(4, Math.min(64, Math.floor(args.size)))
        world.resize(s, s, s)
      }
      const layout = initAssembly(args.name, args.axes)
      const comps = typeof args.components === 'string' ? JSON.parse(args.components) : (args.components ?? [])
      if (!Array.isArray(comps)) throw new Error('components 必须是数组')
      for (const c of comps) {
        addComponent(layout, {
          name: String(c.name),
          x: Math.floor(Number(c.x)),
          y: Math.floor(Number(c.y)),
          z: Math.floor(Number(c.z)),
          w: Math.max(1, Math.floor(Number(c.w))),
          h: Math.max(1, Math.floor(Number(c.h))),
          d: Math.max(1, Math.floor(Number(c.d))),
          group: c.group === 'internal' ? 'internal' : c.group === 'external' ? 'external' : 'shell',
        })
      }
      const placed = materializeLayout(layout, world)
      return { layout: layout.name, placed, components: Object.keys(layout.components).length, summary: summarize(world) }
    },
  }))

  reg(defineTool({
    name: 'voxel_interface_add',
    description: '向装配布局添加接口点：用于定义管路/粒子路径端点必须落在哪个组件 bbox 内，并可指定 peer 进行成对接齐校验。',
    parameters: {
      layout: { type: 'string', required: true, description: '布局名' },
      name: { type: 'string', required: true, description: '接口点名称（如 exhaust_start）' },
      component: { type: 'string', required: true, description: '所属组件名' },
      x: { type: 'integer', required: true },
      y: { type: 'integer', required: true },
      z: { type: 'integer', required: true },
      peer: { type: 'string', description: '应连接的另一个接口点名称' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          layout: { type: 'string' },
          interface: { type: 'string' },
          interfaces: { type: 'integer' },
        },
      },
      render: (_args: unknown, value: { layout: string; interface: string; interfaces: number }) =>
        [{ type: 'text', text: `布局「${value.layout}」已添加接口 ${value.interface}（共 ${value.interfaces} 个）` }],
    },
    execute: async (args: { layout: string; name: string; component: string; x: number; y: number; z: number; peer?: string }) => {
      const layout = getAssembly(args.layout)
      if (!layout) throw new Error('未知布局: ' + args.layout)
      addInterface(layout, { name: args.name, component: args.component, point: [args.x, args.y, args.z], peer: args.peer })
      return { layout: layout.name, interface: args.name, interfaces: Object.keys(layout.interfaces).length }
    },
  }))

  reg(defineTool({
    name: 'voxel_assembly_check',
    description: '检查装配布局：接口点是否落在组件 bbox 内、成对接口是否对齐、三视图是否可生成。返回检查清单。',
    parameters: {
      layout: { type: 'string', required: true, description: '布局名' },
      tolerance: { type: 'integer', description: '接口对齐容差（缺省 1）' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
          items: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: { name: { type: 'string' }, pass: { type: 'boolean' }, detail: { type: 'string' } },
            },
          },
          componentCount: { type: 'integer' },
          interfaceCount: { type: 'integer' },
        },
      },
      render: (_args: unknown, value: {
        ok: boolean; items: Array<{ name: string; pass: boolean; detail: string }>; componentCount: number; interfaceCount: number
      }) => {
        const lines = value.items.map((i) => (i.pass ? '✓ ' : '✗ ') + i.name + '：' + i.detail)
        return [{ type: 'text', text: (value.ok ? '✅ 装配检查通过' : '❌ 装配检查未通过') + `（${value.componentCount} 组件 / ${value.interfaceCount} 接口）\n` + lines.join('\n') }]
      },
    },
    execute: async (args: { layout: string; tolerance?: number }) => {
      const layout = getAssembly(args.layout)
      if (!layout) throw new Error('未知布局: ' + args.layout)
      const r = checkLayout(layout, mgr.getWorld(), args.tolerance ?? 1)
      return { ok: r.ok, items: r.items, componentCount: r.componentCount, interfaceCount: r.interfaceCount }
    },
  }))

  reg(defineTool({
    name: 'voxel_cutaway',
    description: '按装配布局执行剖切：只移除 shell 组在剖切面一侧的体素，internal/external 组全部保留。axis=x/y/z，position 为剖切坐标。',
    parameters: {
      layout: { type: 'string', required: true, description: '布局名' },
      axis: { type: 'string', required: true, description: 'x | y | z' },
      position: { type: 'integer', required: true, description: '剖切面位置' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          removed: { type: 'integer' },
          remaining: { type: 'integer' },
          detail: { type: 'string' },
          summary: SUMMARY_SCHEMA,
        },
      },
      render: (_args: unknown, value: { removed: number; remaining: number; detail: string; summary: Summary }) =>
        [{ type: 'text', text: value.detail + '\n' + renderSummary(value.summary) }],
    },
    execute: async (args: { layout: string; axis: string; position: number }) => {
      const layout = getAssembly(args.layout)
      if (!layout) throw new Error('未知布局: ' + args.layout)
      const axis = args.axis === 'x' ? 'x' : args.axis === 'z' ? 'z' : 'y'
      const r = applyCutaway(layout, mgr.getWorld(), axis, args.position)
      return { removed: r.removed, remaining: r.remaining, detail: r.detail, summary: summarize(mgr.getWorld()) }
    },
  }))

  reg(defineTool({
    name: 'voxel_acceptance',
    description: '按 3D 装配体 Definition of Done 输出验收清单：总布置/接口/外壳内脏分组/三视图/装配检查。',
    parameters: {
      layout: { type: 'string', required: true, description: '布局名' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
          items: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: { name: { type: 'string' }, pass: { type: 'boolean' }, detail: { type: 'string' } },
            },
          },
        },
      },
      render: (_args: unknown, value: { ok: boolean; items: Array<{ name: string; pass: boolean; detail: string }> }) => {
        const lines = value.items.map((i) => (i.pass ? '✓ ' : '✗ ') + i.name + '：' + i.detail)
        return [{ type: 'text', text: (value.ok ? '✅ 验收通过' : '❌ 验收未通过') + '\n' + lines.join('\n') }]
      },
    },
    execute: async (args: { layout: string }) => {
      const layout = getAssembly(args.layout)
      if (!layout) throw new Error('未知布局: ' + args.layout)
      const r = acceptance(layout, mgr.getWorld())
      return { ok: r.ok, items: r.items }
    },
  }))




  reg(defineTool({
    name: 'voxel_export_coords',
    description: '导出全部方块为直接 3D 坐标表（A 表示法）[x,y,z] 列表，或紧凑 JSON 数组。',
    parameters: {
      format: { type: 'string', description: 'list（每行 [x,y,z]）或 json（缺省 list）' },
      max: { type: 'integer', description: '渲染上限（缺省 160；超出截断并标注）' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          count: { type: 'integer' },
          truncated: { type: 'integer' },
          text: { type: 'string' },
        },
      },
      render: (_args: unknown, value: { count: number; truncated: number; text: string }) =>
        [{ type: 'text', text: value.text }],
    },
    execute: async (args: { format?: string; max?: number }) => {
      const world = mgr.getWorld()
      const coords = world.coords()
      const max = Math.max(1, Math.min(2000, Math.floor(args.max ?? 160)))
      const truncated = Math.max(0, coords.length - max)
      let text: string
      if (args.format === 'json') {
        text = JSON.stringify(coords.slice(0, max)) + (truncated > 0 ? '\n…（截断 ' + truncated + ' 条）' : '')
      } else {
        text = coords.slice(0, max).map((c) => '[' + c.join(',') + ']').join('\n') +
          (truncated > 0 ? '\n…（共 ' + coords.length + ' 条，截断 ' + truncated + ' 条）' : '')
      }
      return { count: coords.length, truncated, text }
    },
  }))

  reg(defineTool({
    name: 'voxel_project_views',
    description: '正交三视图投影（C 表示法）：TOP 顶视图（行 z 递减、列 x）/ FRONT 正视图（行 y 递减、列 x）/ SIDE 侧视图（行 y 递减、列 z）。附跨视图一致性检查（离散断层成像：三视图一般不唯一确定体素网格）与门洞一致性。',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          top: { type: 'array', items: { type: 'string' } },
          front: { type: 'array', items: { type: 'string' } },
          side: { type: 'array', items: { type: 'string' } },
          checked: {
            type: 'object',
            additionalProperties: false,
            properties: { TOP: { type: 'integer' }, FRONT: { type: 'integer' }, SIDE: { type: 'integer' } },
          },
          violations: { type: 'integer' },
          violationList: { type: 'array', items: { type: 'string' } },
          doorAgree: { type: 'string' },
        },
      },
      render: (_args: unknown, value: {
        top: string[]; front: string[]; side: string[]; checked: { TOP: number; FRONT: number; SIDE: number }
        violations: number; violationList: string[]; doorAgree: string
      }) => {
        const sz = mgr.getWorld().size
        return [
        {
          type: 'text',
          text:
            'TOP（行 z=' + (sz.z - 1) + '→0，列 x）:\n' + gridText(value.top) + '\n' +
            'FRONT（行 y=' + (sz.y - 1) + '→0，列 x）:\n' + gridText(value.front) + '\n' +
            'SIDE（行 y=' + (sz.y - 1) + '→0，列 z）:\n' + gridText(value.side) + '\n' +
            '一致性: 检查 TOP=' + value.checked.TOP + ' FRONT=' + value.checked.FRONT + ' SIDE=' + value.checked.SIDE +
            '，违规 ' + value.violations + ' 处' +
            (value.violationList.length > 0 ? '\n' + value.violationList.slice(0, 12).join('\n') : '') +
            '\n门洞一致性: ' + value.doorAgree,
        },
        ]
      },
    },
    execute: async () => {
      const world = mgr.getWorld()
      const views = world.projectViews()
      const c = world.checkConsistency()
      const vlist = c.violations.slice(0, 24).map((v) => v.view + '[' + v.cell.join(',') + ']: ' + v.reason)
      return {
        top: views.TOP,
        front: views.FRONT,
        side: views.SIDE,
        checked: c.checked,
        violations: c.violations.length,
        violationList: vlist,
        doorAgree: c.doorAgree === null ? '不适用' : c.doorAgree ? '一致' : '不一致',
      }
    },
  }))

  reg(defineTool({
    name: 'voxel_gravity',
    description: '列式重力模拟（实验阶段 3 的列式物理）：每个 (x,z) 独立成列，仅指定类型的方块下落压实到底（缺省 sand——石材悬空合法，见实验备注）。返回下落块数与前后状态。',
    parameters: {
      type: { type: 'string', description: '下落方块类型（缺省 sand；可传多个用逗号分隔，如 "sand,gravel"）' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          moved: { type: 'integer' },
          before: { type: 'integer' },
          after: { type: 'integer' },
          summary: SUMMARY_SCHEMA,
        },
      },
      render: (_args: unknown, value: { moved: number; before: number; after: number; summary: Summary }) =>
        [{ type: 'text', text: '重力: ' + value.moved + ' 块下落（' + value.before + ' → ' + value.after + ' 块）\n' + renderSummary(value.summary) }],
    },
    execute: async (args: { type?: string }) => {
      const world = mgr.getWorld()
      const types = (args.type ?? 'sand').split(',').map((t) => t.trim()).filter(Boolean)
      const before = world.count()
      const moved = world.applyGravity(types.length > 0 ? types : ['sand'])
      return { moved, before, after: world.count(), summary: summarize(world) }
    },
  }))

  reg(defineTool({
    name: 'voxel_validate',
    description: '确定性不变量校验（生成后校验器）：无支撑块（悬空）、地板实心（占地区内最低层缺块=环形地板缺陷）、门高≥2（house 模式）、室内空心（house 模式）。autoFix=true 时自动修复：补地板 → 补门高 → 补支撑，无需重新生成。',
    parameters: {
      house: { type: 'boolean', description: '按小屋语义检查门高与室内空心（缺省 true）' },
      autoFix: { type: 'boolean', description: '校验后自动修复（缺省 false）' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
          blocks: { type: 'integer' },
          checks: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: { name: { type: 'string' }, pass: { type: 'boolean' }, detail: { type: 'string' } },
            },
          },
          fixes: { type: 'array', items: { type: 'string' } },
          before: { type: 'integer' },
          after: { type: 'integer' },
        },
      },
      render: (_args: unknown, value: {
        ok: boolean; blocks: number; checks: Array<{ name: string; pass: boolean; detail: string }>
        fixes: string[]; before: number; after: number
      }) => {
        const lines = value.checks.map((c) => (c.pass ? '✓ ' : '✗ ') + c.name + '：' + c.detail)
        if (value.fixes.length > 0) lines.push('自动修复 ' + value.fixes.length + ' 项:\n' + value.fixes.map((f) => '  - ' + f).join('\n'))
        return [{ type: 'text', text: (value.ok ? '✅ 全部通过' : '❌ 存在缺陷') + '（' + value.blocks + ' 块）\n' + lines.join('\n') }]
      },
    },
    execute: async (args: { house?: boolean; autoFix?: boolean }) => {
      const world = mgr.getWorld()
      const house = args.house !== false
      const report = world.validate(house)
      let fixes: string[] = []
      let before = world.count()
      let after = world.count()
      if (args.autoFix) {
        const r = world.autoFix()
        fixes = r.fixes
        before = r.before
        after = r.after
        if (r.after !== r.before) {
          // 修复后重跑校验，反映最新状态
          const again = world.validate(house)
          return {
            ok: again.ok,
            blocks: again.blocks,
            checks: again.checks,
            fixes,
            before,
            after,
          }
        }
      }
      return { ok: report.ok, blocks: report.blocks, checks: report.checks, fixes, before, after }
    },
  }))

  reg(defineTool({
    name: 'voxel_render_iso',
    description: '等距 ASCII 渲染当前世界（聊天内直观查看）：菱形网格逐层堆叠，顶层在上。用于模型"看见"自己的三维成果。',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { text: { type: 'string' } },
      },
      render: (_args: unknown, value: { text: string }) => [{ type: 'text', text: value.text }],
    },
    execute: async () => ({ text: mgr.getWorld().isoAscii() }),
  }))

  reg(defineTool({
    name: 'voxel_world_list',
    description: '列出插件当前的全部体素世界（多世界工作流：分区制作 → 平移合成 → 分区域回验）。',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          worlds: { type: 'array', items: { type: 'string' } },
          current: { type: 'string' },
          sizes: { type: 'json' },
        },
      },
      render: (_args: unknown, value: { worlds?: string[]; current?: string; sizes?: unknown }) =>
        [{ type: 'text', text: '世界列表: ' + (value.worlds ?? []).join(', ') + '\n当前: ' + (value.current ?? '') + '\n尺寸: ' + JSON.stringify(value.sizes ?? {}) }],
    },
    execute: async () => {
      const info = mgr.listWorlds()
      return { worlds: info.names, current: info.current, sizes: info.sizes }
    },
  }))

  reg(defineTool({
    name: 'voxel_world_switch',
    description: '切换/创建体素世界（多世界工作流核心）：分区制作时每个区域一个世界，合成后切回主世界。create=true 时按 w/h/d 新建。',
    parameters: {
      name: { type: 'string', required: true, description: '世界名（如 region-a / main）' },
      create: { type: 'boolean', description: '不存在时是否创建（缺省 false）' },
      w: { type: 'integer', description: '创建时的宽（缺省 16；4..128）' },
      h: { type: 'integer', description: '创建时的高（缺省 = w）' },
      d: { type: 'integer', description: '创建时的深（缺省 = w）' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          created: { type: 'boolean' },
          summary: SUMMARY_SCHEMA,
        },
      },
      render: (_args: unknown, value: { created: boolean; summary: Summary }) =>
        [{ type: 'text', text: (value.created ? '已创建并切换' : '已切换') + '\n' + renderSummary(value.summary) }],
    },
    execute: async (args: { name: string; create?: boolean; w?: number; h?: number; d?: number }) => {
      const before = mgr.listWorlds()
      const w = mgr.switchWorld(args.name, args.create === true ? { w: args.w, h: args.h, d: args.d } : undefined)
      if (!w) throw new Error('未知世界: ' + args.name + '（create=true 可新建；现有: ' + before.names.join(', ') + '）')
      return { created: !before.names.includes(args.name), summary: summarize(w) }
    },
  }))

  reg(defineTool({
    name: 'voxel_export_region',
    description: '区域导出（分区域回验）：按 bbox 导出当前世界的子区域方块，可选 offset 平移（导出到新世界/验证区）。配合 voxel_world_switch + coords 导入实现"合成→切区回验"工作流。',
    parameters: {
      x0: { type: 'integer', required: true, description: '区域 x 下限' },
      y0: { type: 'integer', required: true, description: '区域 y 下限' },
      z0: { type: 'integer', required: true, description: '区域 z 下限' },
      x1: { type: 'integer', required: true, description: '区域 x 上限' },
      y1: { type: 'integer', required: true, description: '区域 y 上限' },
      z1: { type: 'integer', required: true, description: '区域 z 上限' },
      dx: { type: 'integer', description: '导出平移 x（缺省 0）' },
      dy: { type: 'integer', description: '导出平移 y（缺省 0）' },
      dz: { type: 'integer', description: '导出平移 z（缺省 0）' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          count: { type: 'integer' },
          text: { type: 'string' },
        },
      },
      render: (_args: unknown, value: { count: number; text: string }) =>
        [{ type: 'text', text: value.text }],
    },
    execute: async (args: { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number; dx?: number; dy?: number; dz?: number }) => {
      const world = mgr.getWorld()
      const blocks = world.exportRegion(args.x0, args.y0, args.z0, args.x1, args.y1, args.z1, args.dx ?? 0, args.dy ?? 0, args.dz ?? 0)
      const text = '导出区域 [' + args.x0 + ',' + args.y0 + ',' + args.z0 + ']..[' + args.x1 + ',' + args.y1 + ',' + args.z1 + '] 共 ' + blocks.length + ' 块' +
        (blocks.length > 0 ? '\n' + blocks.slice(0, 120).map((b) => '[' + b.join(',') + ']').join('\n') + (blocks.length > 120 ? '\n…' : '') : '')
      return { count: blocks.length, text }
    },
  }))

  return disposers
}

/**
 * dsh-voxel-2d — 模型侧工具（三种表示法的确定性代数接口）。
 * 范式（取自 voxel-3d-to-2d 实验结论）：模型只做 2D 编辑/输出，
 * 堆叠、投影、重力、一致性、校验与修复全部由确定性代码完成。
 */
import { defineTool, type ToolRuntime } from '@deepseek-ai/dsh-tools'
import { VoxelWorld, DEMOS, parseGridRow } from './world.js'

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

export function registerVoxelTools(tools: ToolRuntime, world: VoxelWorld): Array<() => void> {
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
      const parsed = parseSlices(args.slices)
      if (parsed.length === 0) throw new Error('未解析到任何层（需要 "yN:" 头 + #/. 网格行，或 JSON）')
      const imported = world.importSlices(parsed, args.type ?? 'stone')
      return { imported, layers: parsed.length, summary: summarize(world) }
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
      }) => [
        {
          type: 'text',
          text:
            'TOP（行 z=' + (world.size.z - 1) + '→0，列 x）:\n' + gridText(value.top) + '\n' +
            'FRONT（行 y=' + (world.size.y - 1) + '→0，列 x）:\n' + gridText(value.front) + '\n' +
            'SIDE（行 y=' + (world.size.y - 1) + '→0，列 z）:\n' + gridText(value.side) + '\n' +
            '一致性: 检查 TOP=' + value.checked.TOP + ' FRONT=' + value.checked.FRONT + ' SIDE=' + value.checked.SIDE +
            '，违规 ' + value.violations + ' 处' +
            (value.violationList.length > 0 ? '\n' + value.violationList.slice(0, 12).join('\n') : '') +
            '\n门洞一致性: ' + value.doorAgree,
        },
      ],
    },
    execute: async () => {
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
    execute: async () => ({ text: world.isoAscii() }),
  }))

  return disposers
}

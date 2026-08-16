/**
 * dsh-voxel-2d 鈥?妯″瀷渚у伐鍏凤紙涓夌琛ㄧず娉曠殑纭畾鎬т唬鏁版帴鍙ｏ級銆? * 鑼冨紡锛堝彇鑷?voxel-3d-to-2d 瀹為獙缁撹锛夛細妯″瀷鍙仛 2D 缂栬緫/杈撳嚭锛? * 鍫嗗彔銆佹姇褰便€侀噸鍔涖€佷竴鑷存€с€佹牎楠屼笌淇鍏ㄩ儴鐢辩‘瀹氭€т唬鐮佸畬鎴愩€? */
import { defineTool, type ToolRuntime } from '@deepseek-ai/dsh-tools'
import { VoxelWorld, DEMOS, parseGridRow } from './world.js'
import { applySpatialCode, exportSpatialCode } from './code_space.js'

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
    bbox: b ? `x ${b.minX}..${b.maxX}, y ${b.minY}..${b.maxY}, z ${b.minZ}..${b.maxZ}` : '绌轰笘鐣?,
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
    `涓栫晫銆?{s.name}銆?${s.size.x}脳${s.size.y}脳${s.size.z} 鏂瑰潡=${s.blocks} 鍖呭洿鐩?${s.bbox}`,
    `灞傚垎甯? ${layers || '锛堢┖锛?}`,
  ].join('\n')
}

/** 鎶婃枃鏈В鏋愪负褰掍竴鍖栫綉鏍艰锛堟寜涓栫晫瀹芥埅鏂?琛ラ綈锛夈€?*/
function parseGridRows(text: string, width: number): string[] {
  const rows: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().replace(/[^#.xX鈼忊枅]/g, '')
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
  // 鍏堣瘯 JSON锛氭暟缁?[{y,rows:[...]}] 鎴栧璞?{"0": "....", ...}
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
    } catch { /* 钀藉埌鏂囨湰瑙ｆ瀽 */ }
  }
  // 鏂囨湰鏍煎紡锛氳澶?"yN:" / "y=N" / "N:"锛屽叾鍚庤繛缁綉鏍艰
  const out: Array<{ y: number; rows: string[] }> = []
  let cur: { y: number; rows: string[] } | null = null
  for (const raw of t.split(/\r?\n/)) {
    const line = raw.trim()
    const m = /^y?\s*[:=锛歖?\s*(\d{1,2})\s*[:锛歖?\s*$/.exec(line)
    if (m) {
      cur = { y: Number(m[1]), rows: [] }
      out.push(cur)
      continue
    }
    if (/^[#.xX鈼忊枅]+$/.test(line) && cur) {
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
    description: '鍒涘缓/閲嶇疆浣撶礌涓栫晫銆備笘鐣屾槸 W脳H脳D 鐨勭珛鏂逛綋缃戞牸锛歺鈭圼0,W)锛寉鈭圼0,H)锛坹 鍚戜笂锛夛紝z鈭圼0,D)銆傚彲鍚屾椂杞藉叆瀹為獙婕旂ず缁撴瀯銆備箣鍚庢墍鏈?voxel_* 宸ュ叿閮戒綔鐢ㄤ簬杩欎釜涓栫晫銆?,
    parameters: {
      size: { type: 'integer', description: '杈归暱锛?..64锛岀己鐪?8锛屽嵆 8脳8脳8锛?2脳32 鍦板舰娌欑洏鐢?32锛? },
      name: { type: 'string', description: '涓栫晫鍚嶏紙缂虹渷 "world"锛? },
      demo: { type: 'string', description: '鍙€夋紨绀虹粨鏋? house锛?0 鍧楀皬灞嬶級/ tower锛?27 鍧楁ゼ姊锛? chimney-house锛?3 鍧楀皬灞?鐑熷洷锛? },
      type: { type: 'string', description: '婕旂ず鏂瑰潡绫诲瀷锛堢己鐪?stone锛? },
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
      let note = '涓栫晫宸查噸缃?
      if (args.demo) {
        const d = DEMOS[args.demo]
        if (d) {
          world.importCoords(d.coords, args.type ?? d.type)
          note = '杞藉叆婕旂ず銆? + d.name + '銆? ' + d.note
        } else {
          note = '鏈煡婕旂ず: ' + args.demo + '锛堝彲閫?house/tower/chimney-house锛?
        }
      }
      return { summary: summarize(world), note }
    },
  }))

  reg(defineTool({
    name: 'voxel_demo',
    description: '杞藉叆瀹為獙婕旂ず缁撴瀯锛坧robe.ps1/probe2.ps1 鐨勭湡鍊兼瀯寤猴級锛歨ouse=80 鍧楃簿纭皬灞嬶紙5x5 鍗犲湴/鍥村/鍗楀闂ㄦ礊/骞冲眿椤?瀹ゅ唴绌哄績锛夛紝tower=127 鍧楃┖蹇冨+铻烘棆妤兼锛宑himney-house=83 鍧楀皬灞?澶栦晶鐑熷洷鏌便€備細娓呯┖褰撳墠涓栫晫銆?,
    parameters: {
      demo: { type: 'string', required: true, description: 'house | tower | chimney-house' },
      type: { type: 'string', description: '鏂瑰潡绫诲瀷锛堢己鐪?stone锛? },
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
        throw new Error('鏈煡婕旂ず: ' + args.demo + '锛堝彲閫? house / tower / chimney-house锛?)
      }
      world.clear()
      world.name = d.name.split('锛?)[0]
      world.importCoords(d.coords, args.type ?? d.type)
      return { summary: summarize(world), note: '宸茶浇鍏ャ€? + d.name + '銆? + d.note }
    },
  }))

  reg(defineTool({
    name: 'voxel_layer_get',
    description: '璇诲彇涓€灞傜殑 2D 鍒囩墖缃戞牸锛圔 琛ㄧず娉曪級锛氳浠庝笂鍒颁笅 z 閫掑噺锛屽垪浠庡乏鍒板彸 x 閫掑锛? 鏈夋柟鍧?. 涓虹┖銆傛ā鍨嬪彲鎹鍋?2D 灞傜紪杈戙€?,
    parameters: {
      y: { type: 'integer', required: true, description: '灞傚彿锛?..H-1锛? },
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
        [{ type: 'text', text: 'y=' + value.y + '锛堝～鍏?' + value.filled + ' 鏍硷級\n' + gridText(value.rows) + '\n' + value.legend }],
    },
    execute: async (args: { y: number }) => {
      const world = mgr.getWorld()
      const s = world.slices().find((l) => l.y === args.y)
      if (!s) throw new Error('灞?' + args.y + ' 瓒呭嚭涓栫晫楂樺害 ' + world.size.y)
      const filled = s.rows.join('').split('').filter((c) => c === '#').length
      return { y: args.y, rows: s.rows, filled, legend: '琛屽簭 z=' + (world.size.z - 1) + '鈫?锛屽垪搴?x=0鈫? + (world.size.x - 1) }
    },
  }))

  reg(defineTool({
    name: 'voxel_layer_set',
    description: '瑕嗙洊璁剧疆涓€灞傜殑 2D 鍒囩墖缃戞牸锛圔 琛ㄧず娉曟牳蹇冨師璇細妯″瀷鍙紪杈戝崟灞傦級銆俫rid 姣忚鎭板ソ W 涓瓧绗︼紝# 鏈夋柟鍧?. 涓虹┖锛涜浠庝笂鍒颁笅 z 閫掑噺锛屽垪浠庡乏鍒板彸 x 閫掑銆傜己琛?瓒呰鑷姩琛ラ綈鎴柇銆傚彲閫?type 鎸囧畾鏂瑰潡绫诲瀷銆?,
    parameters: {
      y: { type: 'integer', required: true, description: '灞傚彿锛?..H-1锛? },
      grid: { type: 'string', required: true, description: 'W 琛?ASCII 缃戞牸锛堣闂存崲琛屽垎闅旓級' },
      type: { type: 'string', description: '鏂瑰潡绫诲瀷锛堢己鐪?stone锛涙湰灞傜幇鏈夊潡娓呴櫎銆佹柊鍧楃敤姝ょ被鍨嬶級' },
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
        [{ type: 'text', text: 'y=' + value.y + ' 灞? 鏀剧疆 ' + value.placed + ' 鍧楋紝娓呴櫎 ' + value.cleared + ' 鍧梊n' + renderSummary(value.summary) }],
    },
    execute: async (args: { y: number; grid: string; type?: string }) => {
      const world = mgr.getWorld()
      if (args.y < 0 || args.y >= world.size.y) throw new Error('灞?' + args.y + ' 瓒呭嚭涓栫晫楂樺害 ' + world.size.y)
      const rows = parseGridRows(args.grid, world.size.x)
      if (rows.length === 0) throw new Error('grid 涓虹┖鎴栨牸寮忛敊璇紙闇€瑕?#/. 缁勬垚鐨勭綉鏍艰锛?)
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
    description: '鎵归噺鏋勫缓涓栫晫锛氭寜 Y 灞傚垏鐗囷紙B 琛ㄧず娉曪級鍫嗗彔鎴?3D銆俿lices 鎺ュ彈涓ょ鏍煎紡锛氣憼 JSON锛氭暟缁?[{"y":0,"rows":["........",...]},...] 鎴栧璞?{"0":"....","1":...}锛涒憽 鏂囨湰锛氭瘡灞備互 "yN:" 寮€澶达紝鍚庤窡杩炵画缃戞牸琛屻€?,
    parameters: {
      slices: { type: 'string', required: true, description: '閫愬眰 2D 缃戞牸锛圝SON 鎴?yN: 鏂囨湰鏍煎紡锛? },
      type: { type: 'string', description: '鏂瑰潡绫诲瀷锛堢己鐪?stone锛? },
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
        [{ type: 'text', text: '瀵煎叆 ' + value.imported + ' 鍧楋紙' + value.layers + ' 灞傦級\n' + renderSummary(value.summary) }],
    },
    execute: async (args: { slices: string; type?: string }) => {
      const world = mgr.getWorld()
      const parsed = parseSlices(args.slices)
      if (parsed.length === 0) throw new Error('鏈В鏋愬埌浠讳綍灞傦紙闇€瑕?"yN:" 澶?+ #/. 缃戞牸琛岋紝鎴?JSON锛?)
      const imported = world.importSlices(parsed, args.type ?? 'stone')
      return { imported, layers: parsed.length, summary: summarize(world) }
    },
  }))

  reg(defineTool({
    name: 'voxel_code_map',
    description: '鎶婄┖闂翠唬鐮?浼唬鐮佹槧灏勫埌浣撶礌涓栫晫锛氭敮鎸?for x in 0..4: 宓屽寰幆銆乻et(x,y,z[,type])銆乧lear(x,y,z)銆乫ill(x0..x1,y0..y1,z0..z1[,type])/box(...)銆俽eset=true 鏃跺厛娓呯┖涓栫晫锛泂ize 鍙噸璁句笘鐣屽昂瀵搞€傛墽琛屽悗杩斿洖鎿嶄綔鏁般€佸潡鏁板彉鍖栥€侀敊璇垪琛ㄤ笌鏍￠獙鎽樿銆?,
    parameters: {
      code: { type: 'string', required: true, description: '绌洪棿浠ｇ爜/浼唬鐮侊紙Python 椋庢牸缂╄繘寰幆 + set/clear/fill/box锛? },
      reset: { type: 'boolean', description: '鏄惁鍏堟竻绌轰笘鐣岋紙缂虹渷 true锛? },
      size: { type: 'integer', description: '鍙€夛細搴旂敤鍓嶆妸涓栫晫閲嶇疆涓?size鲁锛?..64锛? },
      validate: { type: 'boolean', description: '鏄惁鎵ц涓嶅彉閲忔牎楠岋紙缂虹渷 true锛? },
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
          `浠ｇ爜鏄犲皠瀹屾垚锛?{value.ops} 涓懡浠わ紝${value.before} 鈫?${value.after} 鍧梎,
          `鏍￠獙锛?{value.ok ? '鉁?閫氳繃' : '鉂?瀛樺湪缂洪櫡'}`,
          ...value.checks.map((c) => (c.pass ? '鉁?' : '鉁?') + c.name + '锛? + c.detail),
        ]
        if (value.errors.length > 0) lines.push('瑙ｆ瀽/鎵ц閿欒:\n' + value.errors.map((e) => '  - ' + e).join('\n'))
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
    description: '鎶婂綋鍓嶄綋绱犱笘鐣屽鍑轰负绌洪棿浠ｇ爜锛歴tyle=boxes锛堢己鐪侊級鐢?fill 鍚堝苟杞村榻愮洅锛宻tyle=blocks 閫愭牸 set銆傜敓鎴愪唬鐮佸彲鐩存帴鍠傜粰 voxel_code_map 杩樺師涓栫晫銆?,
    parameters: {
      style: { type: 'string', description: 'boxes锛堢己鐪侊紝fill 鐩掑悎骞讹級| blocks锛堥€愭牸 set锛? },
      type: { type: 'string', description: '鍙鍑烘寚瀹氭柟鍧楃被鍨嬶紙缂虹渷鍏ㄩ儴锛? },
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
        [{ type: 'text', text: `浣撶礌 鈫?浠ｇ爜锛?{value.commands} 鏉″懡浠わ紝${value.blocks} 鍧楋級:\n` + value.code + '\n\n' + renderSummary(value.summary) }],
    },
    execute: async (args: { style?: string; type?: string }) => {
      const world = mgr.getWorld()
      const style = args.style === 'blocks' ? 'blocks' : 'boxes'
      const r = exportSpatialCode(world, style, args.type)
      return { code: r.code, commands: r.commands, blocks: r.blocks, summary: summarize(world) }
    },
  }))



  reg(defineTool({
    name: 'voxel_export_coords',
    description: '瀵煎嚭鍏ㄩ儴鏂瑰潡涓虹洿鎺?3D 鍧愭爣琛紙A 琛ㄧず娉曪級[x,y,z] 鍒楄〃锛屾垨绱у噾 JSON 鏁扮粍銆?,
    parameters: {
      format: { type: 'string', description: 'list锛堟瘡琛?[x,y,z]锛夋垨 json锛堢己鐪?list锛? },
      max: { type: 'integer', description: '娓叉煋涓婇檺锛堢己鐪?160锛涜秴鍑烘埅鏂苟鏍囨敞锛? },
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
        text = JSON.stringify(coords.slice(0, max)) + (truncated > 0 ? '\n鈥︼紙鎴柇 ' + truncated + ' 鏉★級' : '')
      } else {
        text = coords.slice(0, max).map((c) => '[' + c.join(',') + ']').join('\n') +
          (truncated > 0 ? '\n鈥︼紙鍏?' + coords.length + ' 鏉★紝鎴柇 ' + truncated + ' 鏉★級' : '')
      }
      return { count: coords.length, truncated, text }
    },
  }))

  reg(defineTool({
    name: 'voxel_project_views',
    description: '姝ｄ氦涓夎鍥炬姇褰憋紙C 琛ㄧず娉曪級锛歍OP 椤惰鍥撅紙琛?z 閫掑噺銆佸垪 x锛? FRONT 姝ｈ鍥撅紙琛?y 閫掑噺銆佸垪 x锛? SIDE 渚ц鍥撅紙琛?y 閫掑噺銆佸垪 z锛夈€傞檮璺ㄨ鍥句竴鑷存€ф鏌ワ紙绂绘暎鏂眰鎴愬儚锛氫笁瑙嗗浘涓€鑸笉鍞竴纭畾浣撶礌缃戞牸锛変笌闂ㄦ礊涓€鑷存€с€?,
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
            'TOP锛堣 z=' + (sz.z - 1) + '鈫?锛屽垪 x锛?\n' + gridText(value.top) + '\n' +
            'FRONT锛堣 y=' + (sz.y - 1) + '鈫?锛屽垪 x锛?\n' + gridText(value.front) + '\n' +
            'SIDE锛堣 y=' + (sz.y - 1) + '鈫?锛屽垪 z锛?\n' + gridText(value.side) + '\n' +
            '涓€鑷存€? 妫€鏌?TOP=' + value.checked.TOP + ' FRONT=' + value.checked.FRONT + ' SIDE=' + value.checked.SIDE +
            '锛岃繚瑙?' + value.violations + ' 澶? +
            (value.violationList.length > 0 ? '\n' + value.violationList.slice(0, 12).join('\n') : '') +
            '\n闂ㄦ礊涓€鑷存€? ' + value.doorAgree,
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
        doorAgree: c.doorAgree === null ? '涓嶉€傜敤' : c.doorAgree ? '涓€鑷? : '涓嶄竴鑷?,
      }
    },
  }))

  reg(defineTool({
    name: 'voxel_gravity',
    description: '鍒楀紡閲嶅姏妯℃嫙锛堝疄楠岄樁娈?3 鐨勫垪寮忕墿鐞嗭級锛氭瘡涓?(x,z) 鐙珛鎴愬垪锛屼粎鎸囧畾绫诲瀷鐨勬柟鍧椾笅钀藉帇瀹炲埌搴曪紙缂虹渷 sand鈥斺€旂煶鏉愭偓绌哄悎娉曪紝瑙佸疄楠屽娉級銆傝繑鍥炰笅钀藉潡鏁颁笌鍓嶅悗鐘舵€併€?,
    parameters: {
      type: { type: 'string', description: '涓嬭惤鏂瑰潡绫诲瀷锛堢己鐪?sand锛涘彲浼犲涓敤閫楀彿鍒嗛殧锛屽 "sand,gravel"锛? },
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
        [{ type: 'text', text: '閲嶅姏: ' + value.moved + ' 鍧椾笅钀斤紙' + value.before + ' 鈫?' + value.after + ' 鍧楋級\n' + renderSummary(value.summary) }],
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
    description: '纭畾鎬т笉鍙橀噺鏍￠獙锛堢敓鎴愬悗鏍￠獙鍣級锛氭棤鏀拺鍧楋紙鎮┖锛夈€佸湴鏉垮疄蹇冿紙鍗犲湴鍖哄唴鏈€浣庡眰缂哄潡=鐜舰鍦版澘缂洪櫡锛夈€侀棬楂樷墺2锛坔ouse 妯″紡锛夈€佸鍐呯┖蹇冿紙house 妯″紡锛夈€俛utoFix=true 鏃惰嚜鍔ㄤ慨澶嶏細琛ュ湴鏉?鈫?琛ラ棬楂?鈫?琛ユ敮鎾戯紝鏃犻渶閲嶆柊鐢熸垚銆?,
    parameters: {
      house: { type: 'boolean', description: '鎸夊皬灞嬭涔夋鏌ラ棬楂樹笌瀹ゅ唴绌哄績锛堢己鐪?true锛? },
      autoFix: { type: 'boolean', description: '鏍￠獙鍚庤嚜鍔ㄤ慨澶嶏紙缂虹渷 false锛? },
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
        const lines = value.checks.map((c) => (c.pass ? '鉁?' : '鉁?') + c.name + '锛? + c.detail)
        if (value.fixes.length > 0) lines.push('鑷姩淇 ' + value.fixes.length + ' 椤?\n' + value.fixes.map((f) => '  - ' + f).join('\n'))
        return [{ type: 'text', text: (value.ok ? '鉁?鍏ㄩ儴閫氳繃' : '鉂?瀛樺湪缂洪櫡') + '锛? + value.blocks + ' 鍧楋級\n' + lines.join('\n') }]
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
          // 淇鍚庨噸璺戞牎楠岋紝鍙嶆槧鏈€鏂扮姸鎬?          const again = world.validate(house)
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
    description: '绛夎窛 ASCII 娓叉煋褰撳墠涓栫晫锛堣亰澶╁唴鐩磋鏌ョ湅锛夛細鑿卞舰缃戞牸閫愬眰鍫嗗彔锛岄《灞傚湪涓娿€傜敤浜庢ā鍨?鐪嬭"鑷繁鐨勪笁缁存垚鏋溿€?,
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
    description: '鍒楀嚭鎻掍欢褰撳墠鐨勫叏閮ㄤ綋绱犱笘鐣岋紙澶氫笘鐣屽伐浣滄祦锛氬垎鍖哄埗浣?鈫?骞崇Щ鍚堟垚 鈫?鍒嗗尯鍩熷洖楠岋級銆?,
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
        [{ type: 'text', text: '涓栫晫鍒楄〃: ' + (value.worlds ?? []).join(', ') + '\n褰撳墠: ' + (value.current ?? '') + '\n灏哄: ' + JSON.stringify(value.sizes ?? {}) }],
    },
    execute: async () => {
      const info = mgr.listWorlds()
      return { worlds: info.names, current: info.current, sizes: info.sizes }
    },
  }))

  reg(defineTool({
    name: 'voxel_world_switch',
    description: '鍒囨崲/鍒涘缓浣撶礌涓栫晫锛堝涓栫晫宸ヤ綔娴佹牳蹇冿級锛氬垎鍖哄埗浣滄椂姣忎釜鍖哄煙涓€涓笘鐣岋紝鍚堟垚鍚庡垏鍥炰富涓栫晫銆俢reate=true 鏃舵寜 w/h/d 鏂板缓銆?,
    parameters: {
      name: { type: 'string', required: true, description: '涓栫晫鍚嶏紙濡?region-a / main锛? },
      create: { type: 'boolean', description: '涓嶅瓨鍦ㄦ椂鏄惁鍒涘缓锛堢己鐪?false锛? },
      w: { type: 'integer', description: '鍒涘缓鏃剁殑瀹斤紙缂虹渷 16锛?..128锛? },
      h: { type: 'integer', description: '鍒涘缓鏃剁殑楂橈紙缂虹渷 = w锛? },
      d: { type: 'integer', description: '鍒涘缓鏃剁殑娣憋紙缂虹渷 = w锛? },
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
        [{ type: 'text', text: (value.created ? '宸插垱寤哄苟鍒囨崲' : '宸插垏鎹?) + '\n' + renderSummary(value.summary) }],
    },
    execute: async (args: { name: string; create?: boolean; w?: number; h?: number; d?: number }) => {
      const before = mgr.listWorlds()
      const w = mgr.switchWorld(args.name, args.create === true ? { w: args.w, h: args.h, d: args.d } : undefined)
      if (!w) throw new Error('鏈煡涓栫晫: ' + args.name + '锛坈reate=true 鍙柊寤猴紱鐜版湁: ' + before.names.join(', ') + '锛?)
      return { created: !before.names.includes(args.name), summary: summarize(w) }
    },
  }))

  reg(defineTool({
    name: 'voxel_export_region',
    description: '鍖哄煙瀵煎嚭锛堝垎鍖哄煙鍥為獙锛夛細鎸?bbox 瀵煎嚭褰撳墠涓栫晫鐨勫瓙鍖哄煙鏂瑰潡锛屽彲閫?offset 骞崇Щ锛堝鍑哄埌鏂颁笘鐣?楠岃瘉鍖猴級銆傞厤鍚?voxel_world_switch + coords 瀵煎叆瀹炵幇"鍚堟垚鈫掑垏鍖哄洖楠?宸ヤ綔娴併€?,
    parameters: {
      x0: { type: 'integer', required: true, description: '鍖哄煙 x 涓嬮檺' },
      y0: { type: 'integer', required: true, description: '鍖哄煙 y 涓嬮檺' },
      z0: { type: 'integer', required: true, description: '鍖哄煙 z 涓嬮檺' },
      x1: { type: 'integer', required: true, description: '鍖哄煙 x 涓婇檺' },
      y1: { type: 'integer', required: true, description: '鍖哄煙 y 涓婇檺' },
      z1: { type: 'integer', required: true, description: '鍖哄煙 z 涓婇檺' },
      dx: { type: 'integer', description: '瀵煎嚭骞崇Щ x锛堢己鐪?0锛? },
      dy: { type: 'integer', description: '瀵煎嚭骞崇Щ y锛堢己鐪?0锛? },
      dz: { type: 'integer', description: '瀵煎嚭骞崇Щ z锛堢己鐪?0锛? },
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
      const text = '瀵煎嚭鍖哄煙 [' + args.x0 + ',' + args.y0 + ',' + args.z0 + ']..[' + args.x1 + ',' + args.y1 + ',' + args.z1 + '] 鍏?' + blocks.length + ' 鍧? +
        (blocks.length > 0 ? '\n' + blocks.slice(0, 120).map((b) => '[' + b.join(',') + ']').join('\n') + (blocks.length > 120 ? '\n鈥? : '') : '')
      return { count: blocks.length, text }
    },
  }))

  return disposers
}

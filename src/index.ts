/**
 * @dsh-external/dsh-voxel-2d — 体素三维转二维视觉工作台（hybrid 形态）。
 *
 * 基准：yjh051108/voxel-3d-to-2d（「压缩三维为二维」实验）。
 * 工程范式落地：体素世界以逐层 2D 切片为状态，模型只做 2D 层编辑；
 * 堆叠 / 三视图投影 / 重力 / 一致性 / 不变量校验全部由确定性代数兜底。
 *
 * 宿主侧：注册 10 个 voxel_* 工具（A/B/C 三种表示法的转换与校验），
 * 并提供 /@dsh-external/dsh-voxel-2d/api 路由供客户端面板读写世界。
 */
import type { Context } from 'cordis'
import z from 'schemastery'
import type { ToolRuntime } from '@deepseek-ai/dsh-tools'
import type { WebServer, WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { VoxelWorld, DEMOS, BLOCK_COLORS } from './world.js'
import { registerVoxelTools } from './tools.js'

type AppContext = Context & {
  tools: ToolRuntime
  webServer: WebServer
}

export const name = '@dsh-external/dsh-voxel-2d'
export const inject = ['tools', 'webServer']

export interface Config {
  size: number
  demo: string
  worldName: string
  apiPrefix: string
}

export const Config = z.object({
  size: z.number().min(4).max(64).default(8),
  demo: z.string().default('house'),
  worldName: z.string().default('voxel-workbench'),
  apiPrefix: z.string().default('/@dsh-external/dsh-voxel-2d/api'),
})

export function apply(ctx: AppContext, config: Config): void {
  const apiPrefix = config.apiPrefix.replace(/\/+$/, '')

  // ── 多世界管理：分区制作 → 平移合成 → 分区域回验的工作流基础 ──
  const worlds = new Map<string, VoxelWorld>()
  let currentName = 'main'
  const world = (): VoxelWorld => worlds.get(currentName)!
  const setWorld = (name: string, w: VoxelWorld): void => {
    worlds.set(name, w)
    currentName = name
  }
  const mainWorld = new VoxelWorld(config.size, config.size, config.size, config.worldName)
  worlds.set('main', mainWorld)

  // 启动时载入演示世界（默认 house，忠实实验 80 块精确小屋）
  const demo = DEMOS[config.demo]
  if (demo) {
    mainWorld.importCoords(demo.coords, demo.type)
    ctx.logger?.info?.(`[${name}] 已载入演示「${demo.name}」(${mainWorld.count()} 块)`)
  }

  // ── 工具注册（fiber 生命周期内自动清理） ─────────────────────────
  ctx.effect(() => {
    const disposers = registerVoxelTools(ctx.tools, {
      getWorld: () => world(),
      listWorlds: () => ({
        names: [...worlds.keys()],
        current: currentName,
        sizes: Object.fromEntries([...worlds.entries()].map(([k, w]) => [k, w.size])) as Record<string, { x: number; y: number; z: number }>,
      }),
      switchWorld: (name: string, create?: { w?: number; h?: number; d?: number }) => {
        if (!worlds.has(name)) {
          if (!create) return null
          const w2 = Math.max(4, Math.min(128, create.w ?? 16))
          const h2 = Math.max(4, Math.min(128, create.h ?? w2))
          const d2 = Math.max(4, Math.min(128, create.d ?? w2))
          worlds.set(name, new VoxelWorld(w2, h2, d2, name))
        }
        currentName = name
        return worlds.get(name)!
      },
    })
    return () => {
      for (const d of disposers) d()
    }
  }, name + ': tools')

  // ── API 路由（面板读写同一个 world 实例） ────────────────────────
  const send = (res: ServerResponse, status: number, body: unknown): void => {
    const data = JSON.stringify(body)
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(data)
  }

  const readBody = (req: IncomingMessage): Promise<Record<string, unknown>> =>
    new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      req.on('data', (c: Buffer) => chunks.push(c))
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8')
        if (!raw.trim()) return resolve({})
        try {
          const v = JSON.parse(raw)
          resolve(v && typeof v === 'object' ? v as Record<string, unknown> : {})
        } catch {
          reject(new Error('JSON 解析失败'))
        }
      })
      req.on('error', reject)
    })

  const stateOf = (since?: number, bbox?: number[]): Record<string, unknown> => {
    const w = world()
    const slices = w.slices()
    const views = w.projectViews()
    const consistency = w.checkConsistency()
    const blocksList: Array<{ x: number; y: number; z: number; t: string }> = []
    const inBBox = (x: number, y: number, z: number): boolean => {
      if (!bbox || bbox.length < 6) return true
      return x >= bbox[0] && x <= bbox[3] && y >= bbox[1] && y <= bbox[4] && z >= bbox[2] && z <= bbox[5]
    }
    for (const [x, y, z] of w.coords()) {
      if (inBBox(x, y, z)) blocksList.push({ x, y, z, t: w.get(x, y, z) ?? 'stone' })
    }
    const b = w.bbox()
    const out: Record<string, unknown> = {
      name: w.name,
      size: w.size,
      version: w.version,
      blocks: w.count(),
      bbox: b ? `x ${b.minX}..${b.maxX}, y ${b.minY}..${b.maxY}, z ${b.minZ}..${b.maxZ}` : null,
      layers: w.layerCounts(),
      slices,
      views,
      consistency: {
        checked: consistency.checked,
        violations: consistency.violations.map((v) => ({ view: v.view, cell: v.cell, reason: v.reason })),
        doorAgree: consistency.doorAgree === null ? null : consistency.doorAgree,
      },
      blocksList,
      palette: BLOCK_COLORS,
      demos: Object.keys(DEMOS),
      worlds: [...worlds.keys()],
      currentWorld: currentName,
    }
    // 增量同步：since=N 时附带变更日志
    if (since !== undefined) {
      out.mutations = w.mutationsSince(since).mutations
    }
    return out
  }

  const routes: WebRoute[] = [
    {
      kind: 'prefix',
      path: apiPrefix,
      handler: async (req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost')
        const path = url.pathname.slice(apiPrefix.length).replace(/^\/+/, '')
        try {
          if (req.method === 'GET' && (path === 'state' || path === '')) {
            // 增量/区域查询：?since=N（变更日志）&bbox=x0,y0,z0,x1,y1,z1
            const sinceRaw = url.searchParams.get('since')
            const since = sinceRaw !== null ? Number(sinceRaw) : undefined
            const bboxRaw = url.searchParams.get('bbox')
            const bbox = bboxRaw !== null ? bboxRaw.split(',').map(Number) : undefined
            return send(res, 200, { ok: true, state: stateOf(since, bbox) })
          }
          if (req.method === 'GET' && path === 'worlds') {
            const sizes: Record<string, { x: number; y: number; z: number }> = {}
            for (const [k, w] of worlds) sizes[k] = w.size
            return send(res, 200, { ok: true, worlds: [...worlds.keys()], current: currentName, sizes })
          }
          if (req.method === 'POST') {
            const body = await readBody(req)
            if (path === 'world/new') {
              const name = String(body.name ?? '').trim()
              if (!name) return send(res, 400, { ok: false, error: '缺 name' })
              const w2 = Math.max(4, Math.min(128, Number(body.w) || Number(body.size) || 16))
              const h2 = Math.max(4, Math.min(128, Number(body.h) || w2))
              const d2 = Math.max(4, Math.min(128, Number(body.d) || w2))
              setWorld(name, new VoxelWorld(w2, h2, d2, name))
              return send(res, 200, { ok: true, state: stateOf() })
            }
            if (path === 'world/use') {
              const name = String(body.name ?? '')
              if (!worlds.has(name)) return send(res, 400, { ok: false, error: '未知世界: ' + name })
              currentName = name
              return send(res, 200, { ok: true, state: stateOf() })
            }
            if (path === 'block') {
              const x = Number(body.x), y = Number(body.y), z = Number(body.z)
              const t = String(body.type ?? 'stone')
              const changed = world().set(x, y, z, t === '' ? null : t)
              return send(res, 200, { ok: true, changed, state: stateOf() })
            }
            if (path === 'layer') {
              const y = Number(body.y)
              const grid = String(body.grid ?? '')
              const type = String(body.type ?? 'stone')
              const rows = grid.split(/\r?\n/).filter((r) => /^[#.xX●█]+$/.test(r.trim()))
              if (y < 0 || y >= world().size.y || rows.length === 0) {
                return send(res, 400, { ok: false, error: '非法层号或网格' })
              }
              let placed = 0
              let cleared = 0
              for (let z = 0; z < world().size.z; z++) {
                const ri = world().size.z - 1 - z
                const row = rows[ri] ?? ''
                for (let x = 0; x < world().size.x; x++) {
                  const want = row[x] === '#' || row[x] === 'x' || row[x] === 'X'
                  const have = world().get(x, y, z) !== null
                  if (want && !have) { world().set(x, y, z, type); placed++ }
                  else if (!want && have) { world().set(x, y, z, null); cleared++ }
                }
              }
              return send(res, 200, { ok: true, placed, cleared, state: stateOf() })
            }
            if (path === 'coords') {
              // 批量导入：coords: [[x,y,z,type?], ...] + 可选 offset [dx,dy,dz]（分区合成）
              const list = Array.isArray(body.coords) ? body.coords : []
              const off = Array.isArray(body.offset) ? body.offset : []
              const dx = Number(off[0] ?? 0)
              const dy = Number(off[1] ?? 0)
              const dz = Number(off[2] ?? 0)
              let n = 0
              for (const c of list) {
                if (!Array.isArray(c) || c.length < 3) continue
                const x = Number(c[0]) + dx
                const y = Number(c[1]) + dy
                const z = Number(c[2]) + dz
                const t = c.length >= 4 && c[3] ? String(c[3]) : 'stone'
                if (world().set(x, y, z, t)) n++
              }
              return send(res, 200, { ok: true, imported: n, state: stateOf() })
            }
            if (path === 'export') {
              // 区域导出（分区域回验）：bbox + 可选 offset 平移导出
              const w = world()
              const off = Array.isArray(body.offset) ? body.offset : []
              const blocks = w.exportRegion(
                Number(body.x0 ?? 0), Number(body.y0 ?? 0), Number(body.z0 ?? 0),
                Number(body.x1 ?? w.size.x - 1), Number(body.y1 ?? w.size.y - 1), Number(body.z1 ?? w.size.z - 1),
                Number(off[0] ?? 0), Number(off[1] ?? 0), Number(off[2] ?? 0),
              )
              return send(res, 200, { ok: true, blocks })
            }
            if (path === 'gravity') {
              const types = String(body.type ?? 'sand').split(',').map((t) => t.trim()).filter(Boolean)
              const moved = world().applyGravity(types.length > 0 ? types : ['sand'])
              return send(res, 200, { ok: true, moved, state: stateOf() })
            }
            if (path === 'validate') {
              const report = world().validate(body.house !== false)
              let fixes: string[] = []
              let before = world().count()
              let after = world().count()
              if (body.autoFix === true) {
                const r = world().autoFix()
                fixes = r.fixes
                before = r.before
                after = r.after
                if (r.after !== r.before) {
                  // 修复后重跑校验，返回最新报告
                  return send(res, 200, { ok: true, report: world().validate(body.house !== false), fixes, before, after, state: stateOf() })
                }
              }
              return send(res, 200, { ok: true, report, fixes, before, after, state: stateOf() })
            }
            if (path === 'demo') {
              const d = DEMOS[String(body.demo ?? '')]
              if (!d) return send(res, 400, { ok: false, error: '未知演示' })
              world().clear()
              world().name = d.name.split('（')[0]
              world().importCoords(d.coords, String(body.type ?? d.type))
              return send(res, 200, { ok: true, note: d.name, state: stateOf() })
            }
            if (path === 'clear') {
              world().clear()
              return send(res, 200, { ok: true, state: stateOf() })
            }
            if (path === 'resize') {
              const w2 = Math.max(4, Math.min(128, Number(body.w) || Number(body.size) || 8))
              const h2 = Math.max(4, Math.min(128, Number(body.h) || w2))
              const d2 = Math.max(4, Math.min(128, Number(body.d) || w2))
              world().resize(w2, h2, d2)
              return send(res, 200, { ok: true, state: stateOf() })
            }
          }
          return send(res, 404, { ok: false, error: '未知 API: ' + path })
        } catch (e) {
          send(res, 500, { ok: false, error: String(e) })
        }
      },
    },
  ]

  ctx.effect(() => {
    const disposers = routes.map((r) => ctx.webServer.register(r))
    return () => {
      for (const d of disposers) d()
    }
  }, name + ': api')

  ctx.logger?.info?.(`[${name}] 已就绪: ${world().count()} 块, API=${apiPrefix}, 世界=${worlds.size} 个`)
}

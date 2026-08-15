/**
 * dsh-voxel-2d — 体素世界核心（确定性代数层）。
 *
 * 设计取自 yjh051108/voxel-3d-to-2d 实验的工程范式：
 *   「二维是推理画布，三维一致性交给代数兜底」
 * - 世界状态存成逐层 2D 切片（Y 层网格），模型只做 2D 层编辑；
 * - 堆叠 / 正交三视图投影 / 重力 / 一致性 / 不变量校验全部是确定性代码；
 * - 生成后跑校验器，可自动修复（补地板 / 补门高 / 补支撑）。
 *
 * 坐标约定与 probe.ps1 完全一致：
 * - Y 层切片 rows[ri][ci]：ri=0 对应 z=Z-1（行从上到下 z 递减），ci 对应 x 递增；
 * - TOP   rows[ri][ci]：z=Z-1-ri，x=ci（存在任一 y 即填充）；
 * - FRONT rows[ri][ci]：y=Y-1-ri，x=ci（存在任一 z 即填充）；
 * - SIDE  rows[ri][ci]：y=Y-1-ri，z=ci（存在任一 x 即填充）。
 */
export type Grid = string[]

export interface WorldSize {
  x: number
  y: number
  z: number
}

export interface LayerSlice {
  y: number
  rows: Grid
}

export interface ViewProjection {
  TOP: Grid
  FRONT: Grid
  SIDE: Grid
}

export interface ViewViolation {
  view: 'TOP' | 'FRONT' | 'SIDE'
  /** 视图内单元格坐标（TOP: [x,z]；FRONT: [x,y]；SIDE: [z,y]） */
  cell: [number, number]
  reason: string
}

export interface ConsistencyReport {
  checked: { TOP: number; FRONT: number; SIDE: number }
  violations: ViewViolation[]
  doorAgree: boolean | null
}

export interface CheckResult {
  name: string
  pass: boolean
  detail: string
}

export interface ValidationReport {
  ok: boolean
  blocks: number
  checks: CheckResult[]
  floating: { count: number; samples: string[] }
  floorHoles: { count: number; samples: string[] }
  doorGap1: { count: number; samples: string[] }
  interiorFill: { count: number; samples: string[] }
  layers: { y: number; count: number }[]
}

export interface FixReport {
  fixes: string[]
  before: number
  after: number
}

const DEFAULT_TYPE = 'stone'

function keyOf(x: number, y: number, z: number): string {
  return x + ',' + y + ',' + z
}

/** 解析 ASCII 网格行：'#'/'X'/'x'/'●' 视为填充，其余为空。 */
export function parseGridRow(row: string): boolean[] {
  const out: boolean[] = []
  for (const ch of row.trim()) {
    out.push(ch === '#' || ch === 'X' || ch === 'x' || ch === '●' || ch === '█')
  }
  return out
}

export function gridToText(rows: Grid): string {
  return rows.map((r) => r.replace(/\./g, '.').replace(/[^.#]/g, '#')).join('\n')
}

export class VoxelWorld {
  readonly size: WorldSize
  name: string
  private blocks = new Map<string, string>()
  private ver = 0

  constructor(wx: number, wy: number, wz: number, name = 'world') {
    this.size = { x: wx, y: wy, z: wz }
    this.name = name
  }

  get version(): number {
    return this.ver
  }

  count(): number {
    return this.blocks.size
  }

  get(x: number, y: number, z: number): string | null {
    return this.blocks.get(keyOf(x, y, z)) ?? null
  }

  /** type 传 '' 或 null 表示清除。返回是否发生变化。 */
  set(x: number, y: number, z: number, type: string | null): boolean {
    if (x < 0 || x >= this.size.x || y < 0 || y >= this.size.y || z < 0 || z >= this.size.z) return false
    const k = keyOf(x, y, z)
    if (type === null || type === '') {
      if (!this.blocks.has(k)) return false
      this.blocks.delete(k)
      this.ver++
      return true
    }
    if (this.blocks.get(k) === type) return false
    this.blocks.set(k, type)
    this.ver++
    return true
  }

  toggle(x: number, y: number, z: number, type = DEFAULT_TYPE): boolean {
    if (this.get(x, y, z) !== null) return this.set(x, y, z, null)
    return this.set(x, y, z, type)
  }

  clear(): void {
    if (this.blocks.size > 0) {
      this.blocks.clear()
      this.ver++
    }
  }

  /** 改尺寸（越界块丢弃）。 */
  resize(wx: number, wy: number, wz: number): void {
    this.size.x = Math.max(1, wx)
    this.size.y = Math.max(1, wy)
    this.size.z = Math.max(1, wz)
    let dropped = 0
    for (const k of [...this.blocks.keys()]) {
      const p = k.split(',').map(Number)
      if (p[0] >= this.size.x || p[1] >= this.size.y || p[2] >= this.size.z) {
        this.blocks.delete(k)
        dropped++
      }
    }
    if (dropped > 0) this.ver++
  }

  /** 逐个填入；返回实际新增数量。 */
  importCoords(coords: Array<[number, number, number]>, type = DEFAULT_TYPE): number {
    let n = 0
    for (const [x, y, z] of coords) {
      if (this.set(x, y, z, type)) n++
    }
    return n
  }

  coords(): Array<[number, number, number]> {
    const out: Array<[number, number, number]> = []
    for (const k of this.blocks.keys()) {
      const p = k.split(',').map(Number)
      out.push([p[0], p[1], p[2]])
    }
    out.sort((a, b) => a[1] - b[1] || a[2] - b[2] || a[0] - b[0])
    return out
  }

  bbox(): { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number } | null {
    if (this.blocks.size === 0) return null
    let minX = Infinity, minY = Infinity, minZ = Infinity
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
    for (const k of this.blocks.keys()) {
      const p = k.split(',').map(Number)
      if (p[0] < minX) minX = p[0]
      if (p[1] < minY) minY = p[1]
      if (p[2] < minZ) minZ = p[2]
      if (p[0] > maxX) maxX = p[0]
      if (p[1] > maxY) maxY = p[1]
      if (p[2] > maxZ) maxZ = p[2]
    }
    return { minX, minY, minZ, maxX, maxY, maxZ }
  }

  layerCounts(): { y: number; count: number }[] {
    const m = new Map<number, number>()
    for (const k of this.blocks.keys()) {
      const y = Number(k.split(',')[1])
      m.set(y, (m.get(y) ?? 0) + 1)
    }
    const out: { y: number; count: number }[] = []
    for (const [y, count] of m) out.push({ y, count })
    out.sort((a, b) => a.y - b.y)
    return out
  }

  /** B 表示法：逐层 2D 网格（行从上到下 z 递减，列 x 递增）。 */
  slices(): LayerSlice[] {
    const out: LayerSlice[] = []
    for (let y = 0; y < this.size.y; y++) {
      const rows: string[] = []
      for (let ri = 0; ri < this.size.z; ri++) {
        const z = this.size.z - 1 - ri
        let row = ''
        for (let x = 0; x < this.size.x; x++) {
          row += this.get(x, y, z) !== null ? '#' : '.'
        }
        rows.push(row)
      }
      out.push({ y, rows })
    }
    return out
  }

  /** B 表示法导入：按 Y 层网格堆叠成 3D。返回新增块数。 */
  importSlices(slices: LayerSlice[], type = DEFAULT_TYPE): number {
    let n = 0
    for (const s of slices) {
      if (s.y < 0 || s.y >= this.size.y) continue
      for (let ri = 0; ri < s.rows.length && ri < this.size.z; ri++) {
        const z = this.size.z - 1 - ri
        const cells = parseGridRow(s.rows[ri])
        for (let x = 0; x < Math.min(cells.length, this.size.x); x++) {
          if (cells[x] && this.set(x, s.y, z, type)) n++
        }
      }
    }
    return n
  }

  /** C 表示法：正交三视图投影。 */
  projectViews(): ViewProjection {
    const { x: W, y: H, z: D } = this.size
    const top: string[] = []
    for (let ri = 0; ri < D; ri++) {
      const z = D - 1 - ri
      let row = ''
      for (let x = 0; x < W; x++) {
        let f = false
        for (let y = 0; y < H; y++) {
          if (this.get(x, y, z) !== null) { f = true; break }
        }
        row += f ? '#' : '.'
      }
      top.push(row)
    }
    const front: string[] = []
    for (let ri = 0; ri < H; ri++) {
      const y = H - 1 - ri
      let row = ''
      for (let x = 0; x < W; x++) {
        let f = false
        for (let z = 0; z < D; z++) {
          if (this.get(x, y, z) !== null) { f = true; break }
        }
        row += f ? '#' : '.'
      }
      front.push(row)
    }
    const side: string[] = []
    for (let ri = 0; ri < H; ri++) {
      const y = H - 1 - ri
      let row = ''
      for (let z = 0; z < D; z++) {
        let f = false
        for (let x = 0; x < W; x++) {
          if (this.get(x, y, z) !== null) { f = true; break }
        }
        row += f ? '#' : '.'
      }
      side.push(row)
    }
    return { TOP: top, FRONT: front, SIDE: side }
  }

  /**
   * 三视图一致性（离散断层成像：三张正交投影一般不唯一）。
   * 规则与 probe.ps1 Score-Views 一致：
   * - TOP 的每个 (x,z) 需 ∃y：FRONT[x][y] ∧ SIDE[z][y]；
   * - FRONT 的每个 (x,y) 需 ∃z：TOP[x][z] ∧ SIDE[z][y]；
   * - SIDE 的每个 (z,y) 需 ∃x：TOP[x][z] ∧ FRONT[x][y]。
   * doorAgree：TOP 的 (3,1) 为空且 FRONT 的 (x=3, y=0..1) 为空（8 尺寸小屋门洞规则）。
   */
  checkConsistency(): ConsistencyReport {
    const views = this.projectViews()
    const { x: W, y: H, z: D } = this.size
    const occ = (view: 'TOP' | 'FRONT' | 'SIDE', a: number, b: number): boolean => {
      const rows = views[view]
      if (view === 'TOP') return rows[D - 1 - b]?.[a] === '#'
      if (view === 'FRONT') return rows[H - 1 - b]?.[a] === '#'
      return rows[H - 1 - b]?.[a] === '#'
    }
    const exists = (pred: (i: number) => boolean, n: number): boolean => {
      for (let i = 0; i < n; i++) if (pred(i)) return true
      return false
    }
    const violations: ViewViolation[] = []
    let cTop = 0, cFront = 0, cSide = 0
    for (let x = 0; x < W; x++) {
      for (let z = 0; z < D; z++) {
        if (!occ('TOP', x, z)) continue
        cTop++
        if (!exists((y) => occ('FRONT', x, y) && occ('SIDE', z, y), H)) {
          violations.push({ view: 'TOP', cell: [x, z], reason: '无 y 使 FRONT[' + x + '] 与 SIDE[' + z + '] 同时有块' })
        }
      }
    }
    for (let x = 0; x < W; x++) {
      for (let y = 0; y < H; y++) {
        if (!occ('FRONT', x, y)) continue
        cFront++
        if (!exists((z) => occ('TOP', x, z) && occ('SIDE', z, y), D)) {
          violations.push({ view: 'FRONT', cell: [x, y], reason: '无 z 可使 TOP[' + x + '] 与 SIDE[z] 同时有块' })
        }
      }
    }
    for (let z = 0; z < D; z++) {
      for (let y = 0; y < H; y++) {
        if (!occ('SIDE', z, y)) continue
        cSide++
        if (!exists((x) => occ('TOP', x, z) && occ('FRONT', x, y), W)) {
          violations.push({ view: 'SIDE', cell: [z, y], reason: '无 x 可使 TOP[x] 与 FRONT[x] 同时有块' })
        }
      }
    }
    let doorAgree: boolean | null = null
    if (W >= 4 && D >= 2 && H >= 2) {
      // 门洞一致性：FRONT 的 x=3 列找「从底部起的连续空段」（地板之上或直接贴地），
      // 空段高度 ≥2 且空段上方有块（横梁/屋顶）→ 三视图关于门洞不矛盾。
      // （probe 的严格版要求 TOP(3,1) 也为空，但屋顶会遮挡俯视，对完整小屋误报。）
      let gapStart = -1
      let gapEnd = -1
      for (let y = 0; y < H; y++) {
        if (!occ('FRONT', 3, y)) {
          if (gapStart === -1) gapStart = y
          gapEnd = y
        } else if (gapStart !== -1) {
          break
        }
      }
      const gapLen = gapStart >= 0 ? gapEnd - gapStart + 1 : 0
      const aboveBlock = gapStart >= 0 && exists((y) => y > gapEnd && this.get(3, y, 1) !== null, H)
      doorAgree = gapLen >= 2 && aboveBlock
    }
    return { checked: { TOP: cTop, FRONT: cFront, SIDE: cSide }, violations, doorAgree }
  }

  /**
   * 重力（列式物理，忠实实验阶段 3 的沙块模型）：每个 (x,z) 独立成列，
   * 仅 fallingTypes 内的方块下落压实到底（缺省 sand——石材悬空合法，
   * 见实验方法学备注「Minecraft 中石材合法悬空」）。返回下落块数。
   */
  applyGravity(fallingTypes: string[] = ['sand']): number {
    const falls = new Set(fallingTypes)
    let moved = 0
    for (let x = 0; x < this.size.x; x++) {
      for (let z = 0; z < this.size.z; z++) {
        const column: Array<[number, string]> = []
        for (let y = 0; y < this.size.y; y++) {
          const t = this.get(x, y, z)
          if (t !== null) column.push([y, t])
        }
        if (column.length === 0) continue
        column.sort((a, b) => a[0] - b[0])
        // 非下落方块先占位（不可穿过），下落方块在其间压实
        const result: Array<[number, string]> = []
        for (const [y, t] of column) {
          if (!falls.has(t)) {
            result.push([y, t])
          }
        }
        const fallers = column.filter(([, t]) => falls.has(t))
        let cursor = 0
        for (const [y, t] of result) {
          while (cursor < y && fallers.length > 0) {
            const [fy, ft] = fallers.shift()!
            if (fy !== cursor) {
              this.set(x, fy, z, null)
              this.set(x, cursor, z, ft)
              moved++
            }
            cursor++
          }
          cursor = Math.max(cursor, y + 1)
        }
        for (const [fy, ft] of fallers) {
          if (fy !== cursor) {
            this.set(x, fy, z, null)
            this.set(x, cursor, z, ft)
            moved++
          }
          cursor++
        }
      }
    }
    if (moved > 0) this.ver++
    return moved
  }

  /** 占地区域：所有「至少有一个方块」的 (x,z) 列（列级足迹）。
   * 注意不能从最低层推导——地板缺块会从足迹消失导致空洞永远检不出。 */
  private footprint(): Set<string> {
    const out = new Set<string>()
    for (const k of this.blocks.keys()) {
      const p = k.split(',').map(Number)
      out.add(p[0] + ',' + p[2])
    }
    return out
  }

  /**
   * 确定性不变量校验（对应实验的"生成后跑不变量校验"）。
   * - 无支撑块（floating）：y>0 且正下方为空——含"屋顶横跨空心室内"
   *   （实验备注：该指标对空心屋顶会误报，仅作参考）；
   * - 地板空洞（floorHoles）：最低层占地区内缺块（"环形地板"缺陷）；
   * - 门高不足（doorGap1，house 模式）：占地边缘 1 宽缺口上方 y+1 处仍有块；
   * - 室内填充（interiorFill，house 模式）：占地内部（非边缘）在地板与
   *   最高层之间的填充（"实心"缺陷，需清空）。
   */
  validate(house = false): ValidationReport {
    const { x: W, y: H, z: D } = this.size
    const b = this.bbox()
    const checks: CheckResult[] = []
    const floatingSamples: string[] = []
    let floating = 0
    const floorHolesSamples: string[] = []
    let floorHoles = 0
    const doorSamples: string[] = []
    let doorGap1 = 0
    const interiorSamples: string[] = []
    let interiorFill = 0

    // 无支撑块
    for (const k of this.blocks.keys()) {
      const p = k.split(',').map(Number)
      if (p[1] > 0 && !this.blocks.has(keyOf(p[0], p[1] - 1, p[2]))) {
        floating++
        if (floatingSamples.length < 8) floatingSamples.push(k)
      }
    }
    checks.push({
      name: '无支撑块',
      // 实验方法学备注：该指标对「屋顶横跨空心室内」会误报（Minecraft 中石材
      // 合法悬空）——house 模式下仅作参考，不参与总体 ok。
      pass: floating === 0,
      detail: floating === 0 ? '每个方块下方都有支撑' : floating + ' 块悬空（样本: ' + floatingSamples.join('; ') + '；house 模式下屋顶横跨空心室内属合法，仅参考）',
    })

    if (b) {
      // 地板空洞：最低层占地区内缺块
      const foot = this.footprint()
      for (const f of foot) {
        const p = f.split(',').map(Number)
        if (!this.blocks.has(keyOf(p[0], b.minY, p[1]))) {
          floorHoles++
          if (floorHolesSamples.length < 8) floorHolesSamples.push(p[0] + ',' + b.minY + ',' + p[1])
        }
      }
      checks.push({
        name: '地板实心',
        pass: floorHoles === 0,
        detail: floorHoles === 0
          ? '占地区域（' + foot.size + ' 格）地板完整'
          : '地板缺 ' + floorHoles + ' 格（样本: ' + floorHolesSamples.join('; ') + '）',
      })

      if (house) {
        const minY = b.minY
        const maxY = b.maxY
        const isBorder = (x: number, z: number): boolean =>
          foot.has(x + ',' + z) && (x === b.minX || x === b.maxX || z === b.minZ || z === b.maxZ)
        const isInterior = (x: number, z: number): boolean =>
          foot.has(x + ',' + z) && x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ
        // 门高：占地边缘 1 宽缺口（y=minY 空）且 y=minY+1 有块 → 门只有 1 格高
        for (const f of foot) {
          const p = f.split(',').map(Number)
          const x = p[0], z = p[1]
          if (!isBorder(x, z)) continue
          if (this.blocks.has(keyOf(x, minY, z))) continue
          if (minY + 1 < H && this.blocks.has(keyOf(x, minY + 1, z))) {
            doorGap1++
            if (doorSamples.length < 8) doorSamples.push(x + ',' + minY + ',' + z)
          }
        }
        checks.push({
          name: '门高 ≥2',
          pass: doorGap1 === 0,
          detail: doorGap1 === 0 ? '无 1 格高门洞' : doorGap1 + ' 处门洞仅 1 格高（样本: ' + doorSamples.join('; ') + '）',
        })
        // 室内填充：占地内部、minY<y<maxY、非最上层
        for (let y = minY + 1; y < maxY; y++) {
          for (let x = 0; x < W; x++) {
            for (let z = 0; z < D; z++) {
              if (!isInterior(x, z)) continue
              if (this.blocks.has(keyOf(x, y, z))) {
                interiorFill++
                if (interiorSamples.length < 8) interiorSamples.push(x + ',' + y + ',' + z)
              }
            }
          }
        }
        checks.push({
          name: '室内空心',
          pass: interiorFill === 0,
          detail: interiorFill === 0 ? '室内（占地内部）保持空心' : '室内有 ' + interiorFill + ' 块填充（样本: ' + interiorSamples.join('; ') + '）',
        })
      }
    }

    // 总体判定：以「地板实心 + 门高 + 室内空心」为准（论文结论：最终以
    // 室内地板实心率+门窗特征为准）；悬空指标两种模式都仅作参考
    // （屋顶横跨空心室内、楼梯台阶等合法悬空都会误报）。
    const ok = floorHoles === 0 && doorGap1 === 0 && interiorFill === 0
    return {
      ok,
      blocks: this.count(),
      checks,
      floating: { count: floating, samples: floatingSamples },
      floorHoles: { count: floorHoles, samples: floorHolesSamples },
      doorGap1: { count: doorGap1, samples: doorSamples },
      interiorFill: { count: interiorFill, samples: interiorSamples },
      layers: this.layerCounts(),
    }
  }

  /**
   * 自动修复（对应实验工程启示："补内部地板、补门高、补支撑，无需重新生成"）。
   * 1. 补地板：占地区内最低层缺块全部补齐；
   * 2. 补门高：占地边缘 1 宽缺口上方 y+1 的块移除（缺口变 2 格高）；
   * 3. 补支撑：每个悬空块下方补一列到底（把悬空屋顶变成支柱支撑）。
   */
  autoFix(type = DEFAULT_TYPE): FixReport {
    const before = this.count()
    const fixes: string[] = []
    const b = this.bbox()
    if (b) {
      const foot = this.footprint()
      let floorN = 0
      for (const f of foot) {
        const p = f.split(',').map(Number)
        if (!this.blocks.has(keyOf(p[0], b.minY, p[1]))) {
          this.set(p[0], b.minY, p[1], type)
          floorN++
        }
      }
      if (floorN > 0) fixes.push('补地板 ' + floorN + ' 格（' + b.minY + ' 层占地区内）')

      let doorN = 0
      const isBorder = (x: number, z: number): boolean =>
        foot.has(x + ',' + z) && (x === b.minX || x === b.maxX || z === b.minZ || z === b.maxZ)
      for (const f of foot) {
        const p = f.split(',').map(Number)
        const x = p[0], z = p[1]
        if (!isBorder(x, z)) continue
        if (this.blocks.has(keyOf(x, b.minY, z))) continue
        if (b.minY + 1 < this.size.y && this.blocks.has(keyOf(x, b.minY + 1, z))) {
          this.set(x, b.minY + 1, z, null)
          doorN++
        }
      }
      if (doorN > 0) fixes.push('补门高 ' + doorN + ' 处（缺口上移一层，门洞变 2 格高）')

      let supportN = 0
      for (let x = 0; x < this.size.x; x++) {
        for (let z = 0; z < this.size.z; z++) {
          for (let y = 1; y < this.size.y; y++) {
            if (!this.blocks.has(keyOf(x, y, z))) continue
            if (this.blocks.has(keyOf(x, y - 1, z))) continue
            // 悬空：向下补一列直到地面或已有支撑
            let yy = y - 1
            while (yy >= 0 && !this.blocks.has(keyOf(x, yy, z))) {
              this.set(x, yy, z, type)
              supportN++
              yy--
            }
            fixes.push('补支撑（' + x + ',' + y + ',' + z + ' 下方 ' + (y - 1 - yy) + ' 格）')
            break
          }
        }
      }
      if (supportN > 0) fixes.push('补支撑合计 ' + supportN + ' 格')
    }
    const after = this.count()
    return { fixes, before, after }
  }

  /**
   * 等距 ASCII 渲染（聊天内"看"世界用）：逐层菱形堆叠，从顶往下。
   * 每层 y 一行内 (x,z) 满足 x+z=const 的对角线，层间垂直偏移 2。
   */
  isoAscii(): string {
    const { x: W, y: H, z: D } = this.size
    const lines: string[] = []
    const pad = W + D - 1
    for (let y = H - 1; y >= 0; y--) {
      for (let diag = 0; diag <= W + D - 2; diag++) {
        let row = ''
        for (let x = 0; x < W; x++) {
          const z = diag - x
          row += (z >= 0 && z < D) ? (this.get(x, y, z) !== null ? '#' : '.') : ' '
        }
        const offset = 2 * (H - 1 - y) + (W - 1)
        const padded = ' '.repeat(offset) + row
        lines.push(padded)
      }
    }
    const header =
      'iso ' + this.name + ' [' + W + 'x' + H + 'x' + D + '] 方块=' + this.count() +
      '（' + H + ' 层，顶层在上，y 向下递增）'
    return header + '\n' + lines.join('\n')
  }
}

/** 实验真值结构（probe.ps1 / probe2.ps1 的 New-GT* 函数移植）。 */
export const DEMOS: Record<string, { name: string; coords: Array<[number, number, number]>; type: string; note: string }> = {
  house: {
    name: '乡村小屋（实验精确规格，80 块）',
    type: 'stone',
    note: '5x5 占地 / 围墙 / 南墙门洞(3,1) / 平屋顶 / 室内空心 —— probe.ps1 的 80 块真值',
    coords: (() => {
      const c: Array<[number, number, number]> = []
      for (let x = 1; x <= 5; x++) for (let z = 1; z <= 5; z++) c.push([x, 0, z])
      for (let y = 1; y <= 2; y++) for (let x = 1; x <= 5; x++) for (let z = 1; z <= 5; z++) {
        if ((x === 1 || x === 5 || z === 1 || z === 5) && !(x === 3 && z === 1)) c.push([x, y, z])
      }
      for (let x = 1; x <= 5; x++) for (let z = 1; z <= 5; z++) c.push([x, 3, z])
      return c
    })(),
  },
  tower: {
    name: '空心塔+螺旋楼梯（127 块）',
    type: 'stone',
    note: '5x5 地板 + 6 层围墙 + 螺旋台阶 [(2,2),(4,2),(4,4),(2,4)] 逐层轮换 —— probe2.ps1 的 New-GTStair',
    coords: (() => {
      const c: Array<[number, number, number]> = []
      for (let x = 1; x <= 5; x++) for (let z = 1; z <= 5; z++) c.push([x, 0, z])
      for (let y = 1; y <= 6; y++) for (let x = 1; x <= 5; x++) for (let z = 1; z <= 5; z++) {
        if (x === 1 || x === 5 || z === 1 || z === 5) c.push([x, y, z])
      }
      const seq: Array<[number, number]> = [[2, 2], [4, 2], [4, 4], [2, 4]]
      for (let y = 1; y <= 6; y++) {
        const p = seq[(y - 1) % 4]
        c.push([p[0], y, p[1]])
      }
      return c
    })(),
  },
  'chimney-house': {
    name: '小屋+外侧烟囱柱（83 块）',
    type: 'stone',
    note: '小屋 + 外侧 (6,y,5) y=1..3 烟囱 —— probe2.ps1 的 New-GTC2',
    coords: (() => {
      const c: Array<[number, number, number]> = []
      for (let x = 1; x <= 5; x++) for (let z = 1; z <= 5; z++) c.push([x, 0, z])
      for (let y = 1; y <= 2; y++) for (let x = 1; x <= 5; x++) for (let z = 1; z <= 5; z++) {
        if ((x === 1 || x === 5 || z === 1 || z === 5) && !(x === 3 && z === 1)) c.push([x, y, z])
      }
      for (let x = 1; x <= 5; x++) for (let z = 1; z <= 5; z++) c.push([x, 3, z])
      for (let y = 1; y <= 3; y++) c.push([6, y, 5])
      return c
    })(),
  },
}

/** 面板与渲染用的方块类型调色板。 */
export const BLOCK_COLORS: Record<string, string> = {
  stone: '#9aa3ad',
  wood: '#8d6748',
  sand: '#e6d9a3',
  glass: '#a8d8e8',
  brick: '#b5543f',
  snow: '#eef4fb',
  leaves: '#5f9e4f',
  roof: '#7a5a9e',
  coal: '#3a3f45',
  default: '#9aa3ad',
}

export function blockColor(type: string | null): string {
  if (!type) return '#666'
  return BLOCK_COLORS[type] ?? BLOCK_COLORS.default
}

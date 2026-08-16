/**
 * dsh-voxel-2d — 代码→体素映射。
 *
 * 提供一个极简“空间代码”解释器，把常见的坐标循环/网格操作直接落到 VoxelWorld：
 * - for x in 0..4:  for z in 0..4:  set(x,0,z,stone)
 * - fill(0..4,0..0,0..4,stone)
 * - clear(x,y,z)
 * 支持变量、四则运算、括号、range(a,b)（半开区间）与 a..b（闭区间）。
 */
import { VoxelWorld } from './world.js'

export interface CodeMapResult {
  ops: number
  before: number
  after: number
  errors: string[]
}

function evalExpr(expr: string, vars: Record<string, number>): number {
  const tokens = expr.match(/\d+\.?\d*|[A-Za-z_]\w*|[+\-*/%()]/g) ?? []
  if (tokens.length === 0) throw new Error('空表达式: ' + expr)
  let pos = 0
  const peek = (): string | undefined => tokens[pos]
  const next = (): string => {
    const t = tokens[pos]
    if (t === undefined) throw new Error('表达式意外结束: ' + expr)
    pos++
    return t
  }
  const parseExpr = (): number => parseAddSub()
  const parseAddSub = (): number => {
    let v = parseMulDiv()
    while (peek() === '+' || peek() === '-') {
      const op = next()
      const r = parseMulDiv()
      v = op === '+' ? v + r : v - r
    }
    return v
  }
  const parseMulDiv = (): number => {
    let v = parseUnary()
    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const op = next()
      const r = parseUnary()
      if (op === '*') v = v * r
      else if (op === '/') v = v / r
      else v = v % r
    }
    return v
  }
  const parseUnary = (): number => {
    if (peek() === '-') {
      next()
      return -parseUnary()
    }
    return parsePrimary()
  }
  const parsePrimary = (): number => {
    const t = next()
    if (t === '(') {
      const v = parseExpr()
      if (next() !== ')') throw new Error('缺右括号: ' + expr)
      return v
    }
    if (/^\d/.test(t)) return Number(t)
    if (/^[A-Za-z_]/.test(t)) {
      if (!(t in vars)) throw new Error('未知变量: ' + t)
      return vars[t]
    }
    throw new Error('无法解析的 token: ' + t)
  }
  return parseExpr()
}

function parseAxis(axis: string, vars: Record<string, number>): [number, number] {
  const s = axis.trim()
  if (s.includes('..')) {
    const [a, b] = s.split('..', 2).map((x) => Math.floor(evalExpr(x.trim(), vars)))
    return [Math.min(a, b), Math.max(a, b)]
  }
  const v = Math.floor(evalExpr(s, vars))
  return [v, v]
}

function parseRange(src: string, vars: Record<string, number>): [number, number] {
  const s = src.trim()
  let m = /^range\(\s*(.+?)\s*,\s*(.+?)\s*\)$/.exec(s)
  if (m) {
    const a = Math.floor(evalExpr(m[1], vars))
    const b = Math.floor(evalExpr(m[2], vars))
    return a <= b ? [a, b - 1] : [a, b + 1]
  }
  m = /^(.+?)\s*\.\.\s*(.+)$/.exec(s)
  if (m) {
    const a = Math.floor(evalExpr(m[1], vars))
    const b = Math.floor(evalExpr(m[2], vars))
    return [Math.min(a, b), Math.max(a, b)]
  }
  const v = Math.floor(evalExpr(s, vars))
  return [v, v]
}

function stripType(raw: string): string {
  const s = raw.trim()
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) return s.slice(1, -1)
  return s || 'stone'
}

function splitArgs(content: string): string[] {
  const inner = content.slice(content.indexOf('(') + 1, content.lastIndexOf(')'))
  const args: string[] = []
  let cur = ''
  let depth = 0
  for (const ch of inner) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      args.push(cur)
      cur = ''
    } else cur += ch
  }
  if (cur.trim()) args.push(cur)
  return args
}

export function applySpatialCode(code: string, world: VoxelWorld): CodeMapResult {
  const before = world.count()
  const errors: string[] = []
  let ops = 0
  const vars: Record<string, number> = {}
  const lines = code.split(/\r?\n/)

  const executeCommand = (content: string): void => {
    if (content.startsWith('set(')) {
      const a = splitArgs(content)
      if (a.length < 3) throw new Error('set 需要 x,y,z[,type]: ' + content)
      const x = Math.floor(evalExpr(a[0], vars))
      const y = Math.floor(evalExpr(a[1], vars))
      const z = Math.floor(evalExpr(a[2], vars))
      const t = a.length > 3 ? stripType(a[3]) : 'stone'
      world.set(x, y, z, t)
      return
    }
    if (content.startsWith('clear(')) {
      const a = splitArgs(content)
      if (a.length < 3) throw new Error('clear 需要 x,y,z: ' + content)
      const x = Math.floor(evalExpr(a[0], vars))
      const y = Math.floor(evalExpr(a[1], vars))
      const z = Math.floor(evalExpr(a[2], vars))
      world.set(x, y, z, null)
      return
    }
    if (content.startsWith('fill(') || content.startsWith('box(')) {
      const a = splitArgs(content)
      if (a.length < 3) throw new Error('fill/box 需要 x,y,z 范围[,type]: ' + content)
      const [x0, x1] = parseAxis(a[0], vars)
      const [y0, y1] = parseAxis(a[1], vars)
      const [z0, z1] = parseAxis(a[2], vars)
      const t = a.length > 3 ? stripType(a[3]) : 'stone'
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) world.set(x, y, z, t)
      return
    }
    throw new Error('未知命令: ' + content)
  }

  const execBlock = (blockLines: string[], indent: number): number => {
    let i = 0
    while (i < blockLines.length) {
      const raw = blockLines[i].replace(/\t/g, '  ')
      const m = /^(\s*)(.*)$/.exec(raw)!
      const curIndent = m[1].length
      if (curIndent < indent) return i
      const content = m[2].trim()
      if (!content || content.startsWith('#')) {
        i++
        continue
      }
      if (content.startsWith('for ')) {
        const fm = /^for\s+([A-Za-z_]\w*)\s+in\s+(.+?):\s*$/.exec(content)
        if (!fm) {
          errors.push('无法解析 for: ' + content)
          i++
          continue
        }
        const varName = fm[1]
        const [a, b] = parseRange(fm[2], vars)
        const body: string[] = []
        let j = i + 1
        while (j < blockLines.length) {
          const lm = /^(\s*)/.exec(blockLines[j])![1].length
          if (lm > curIndent) {
            body.push(blockLines[j])
            j++
          } else break
        }
        const step = a <= b ? 1 : -1
        for (let v = a; step > 0 ? v <= b : v >= b; v += step) {
          vars[varName] = v
          execBlock(body, curIndent + 1)
        }
        delete vars[varName]
        i = j
        continue
      }
      try {
        executeCommand(content)
        ops++
      } catch (e) {
        errors.push(String(e instanceof Error ? e.message : e))
      }
      i++
    }
    return i
  }

  execBlock(lines, 0)
  return { ops, before, after: world.count(), errors }
}

export interface CodeExportResult {
  code: string
  commands: number
  blocks: number
}

function cellKey(x: number, y: number, z: number): string {
  return x + ',' + y + ',' + z
}

/** 体素世界 → 空间代码。style=boxes 时用 fill 合并尽量大的轴对齐盒，更紧凑。 */
export function exportSpatialCode(
  world: VoxelWorld,
  style: 'boxes' | 'blocks' = 'boxes',
  typeFilter?: string,
): CodeExportResult {
  const byType = new Map<string, Array<[number, number, number]>>()
  const { x: W, y: H, z: D } = world.size
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) {
      for (let z = 0; z < D; z++) {
        const t = world.get(x, y, z)
        if (!t) continue
        if (typeFilter && t !== typeFilter) continue
        const list = byType.get(t) ?? []
        list.push([x, y, z])
        byType.set(t, list)
      }
    }
  }
  const lines: string[] = []
  let commands = 0
  const types = [...byType.keys()].sort()

  if (style === 'blocks') {
    for (const t of types) {
      for (const [x, y, z] of byType.get(t)!) {
        lines.push(`set(${x},${y},${z},${t})`)
        commands++
      }
    }
  } else {
    for (const t of types) {
      const remaining = new Set(byType.get(t)!.map(([x, y, z]) => cellKey(x, y, z)))
      const cells = byType.get(t)!
      let guard = 0
      while (remaining.size > 0 && guard++ < 100000) {
        const firstKey = [...remaining][0]
        const [sx, sy, sz] = firstKey.split(',').map(Number)
        let x0 = sx, x1 = sx, y0 = sy, y1 = sy, z0 = sz, z1 = sz
        let grew = true
        while (grew) {
          grew = false
          // 尝试 x 方向扩展
          if (x1 + 1 < W) {
            let ok = true
            for (let yy = y0; yy <= y1 && ok; yy++) for (let zz = z0; zz <= z1 && ok; zz++) {
              if (!remaining.has(cellKey(x1 + 1, yy, zz))) ok = false
            }
            if (ok) { x1++; grew = true }
          }
          if (!grew && x0 - 1 >= 0) {
            let ok = true
            for (let yy = y0; yy <= y1 && ok; yy++) for (let zz = z0; zz <= z1 && ok; zz++) {
              if (!remaining.has(cellKey(x0 - 1, yy, zz))) ok = false
            }
            if (ok) { x0--; grew = true }
          }
          if (!grew && y1 + 1 < H) {
            let ok = true
            for (let xx = x0; xx <= x1 && ok; xx++) for (let zz = z0; zz <= z1 && ok; zz++) {
              if (!remaining.has(cellKey(xx, y1 + 1, zz))) ok = false
            }
            if (ok) { y1++; grew = true }
          }
          if (!grew && y0 - 1 >= 0) {
            let ok = true
            for (let xx = x0; xx <= x1 && ok; xx++) for (let zz = z0; zz <= z1 && ok; zz++) {
              if (!remaining.has(cellKey(xx, y0 - 1, zz))) ok = false
            }
            if (ok) { y0--; grew = true }
          }
          if (!grew && z1 + 1 < D) {
            let ok = true
            for (let xx = x0; xx <= x1 && ok; xx++) for (let yy = y0; yy <= y1 && ok; yy++) {
              if (!remaining.has(cellKey(xx, yy, z1 + 1))) ok = false
            }
            if (ok) { z1++; grew = true }
          }
          if (!grew && z0 - 1 >= 0) {
            let ok = true
            for (let xx = x0; xx <= x1 && ok; xx++) for (let yy = y0; yy <= y1 && ok; yy++) {
              if (!remaining.has(cellKey(xx, yy, z0 - 1))) ok = false
            }
            if (ok) { z0--; grew = true }
          }
        }
        lines.push(`fill(${x0}..${x1},${y0}..${y1},${z0}..${z1},${t})`)
        commands++
        for (let xx = x0; xx <= x1; xx++) for (let yy = y0; yy <= y1; yy++) for (let zz = z0; zz <= z1; zz++) {
          remaining.delete(cellKey(xx, yy, zz))
        }
      }
      if (remaining.size > 0) {
        // 兜底：个别未合并的格子逐点输出
        for (const k of remaining) {
          const [x, y, z] = k.split(',').map(Number)
          lines.push(`set(${x},${y},${z},${t})`)
          commands++
        }
      }
    }
  }

  return { code: lines.join('\n'), commands, blocks: world.count() }
}


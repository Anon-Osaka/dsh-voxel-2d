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

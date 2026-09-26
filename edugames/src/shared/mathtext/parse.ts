/**
 * Parser for strings with inline `$…$` math in a small TeX subset (see
 * Problem.prompt in generators/types.ts). Produces a renderer-neutral tree that
 * canvas.ts and MathText.tsx both lay out. Tolerant by design: unknown
 * commands, stray braces and an unmatched `$` never throw.
 *
 * Supported inside math: digits/decimals, single-letter italic variables,
 * + - = < > ( ) [ ] , ^{} _{} \times \div \cdot \frac{a}{b} \sqrt{x} \sqrt[n]{x}
 * \le \ge (plus \lt \gt \ne \pm \pi \approx \cdots \ldots \% \text{…} \left \right
 * and spacing commands). `\$` is a literal dollar sign anywhere.
 */

/** Plain prose (outside `$…$` or from \text{}); upright, keeps its spaces. */
export interface TextNode {
  type: 'text'
  text: string
}

/** Number (digits, decimal point, digit-grouping commas); upright. */
export interface NumNode {
  type: 'num'
  text: string
}

/** Single-letter variable (or Greek letter); italic. */
export interface VarNode {
  type: 'var'
  text: string
}

/**
 * Operator glyph, already mapped to display Unicode ('-' → '−', \times → '×' …).
 *  - bin:   binary operator, medium space both sides (+ − × ÷ · ±)
 *  - rel:   relation, thick space both sides (= < > ≤ ≥ ≠ ≈)
 *  - unary: sign with no spacing (leading/after an operator or open bracket)
 *  - open/close: brackets, no spacing
 *  - punct: comma etc., space after only
 *  - ord:   other symbols, no spacing (%, …, °)
 */
export interface OpNode {
  type: 'op'
  text: string
  kind: 'bin' | 'rel' | 'unary' | 'open' | 'close' | 'punct' | 'ord'
}

/** Superscript attached to the preceding node. */
export interface SupNode {
  type: 'sup'
  children: MathNode[]
}

/** Subscript attached to the preceding node. */
export interface SubNode {
  type: 'sub'
  children: MathNode[]
}

export interface FracNode {
  type: 'frac'
  num: MathNode[]
  den: MathNode[]
}

export interface SqrtNode {
  type: 'sqrt'
  children: MathNode[]
  /** Root index for \sqrt[n]{x}. */
  index?: MathNode[]
}

/** Explicit space from \, \: \; \quad or `\ ` (in em). */
export interface SpaceNode {
  type: 'space'
  em: number
}

export type MathNode = TextNode | NumNode | VarNode | OpNode | SupNode | SubNode | FracNode | SqrtNode | SpaceNode

/** One `$…$` span. Renderers keep it unbroken. */
export interface MathSegment {
  type: 'math'
  children: MathNode[]
}

export type MathTextNode = TextNode | MathSegment

const SYMBOLS: Record<string, { text: string; kind: OpNode['kind'] }> = {
  times: { text: '×', kind: 'bin' },
  div: { text: '÷', kind: 'bin' },
  cdot: { text: '·', kind: 'bin' },
  pm: { text: '±', kind: 'bin' },
  mp: { text: '∓', kind: 'bin' },
  le: { text: '≤', kind: 'rel' },
  leq: { text: '≤', kind: 'rel' },
  ge: { text: '≥', kind: 'rel' },
  geq: { text: '≥', kind: 'rel' },
  lt: { text: '<', kind: 'rel' },
  gt: { text: '>', kind: 'rel' },
  ne: { text: '≠', kind: 'rel' },
  neq: { text: '≠', kind: 'rel' },
  approx: { text: '≈', kind: 'rel' },
  cdots: { text: '⋯', kind: 'ord' },
  ldots: { text: '…', kind: 'ord' },
  dots: { text: '…', kind: 'ord' },
  circ: { text: '°', kind: 'ord' },
  degree: { text: '°', kind: 'ord' },
  '%': { text: '%', kind: 'ord' },
  '{': { text: '{', kind: 'open' },
  '}': { text: '}', kind: 'close' },
  '$': { text: '$', kind: 'ord' },
}

const GREEK: Record<string, string> = { pi: 'π', theta: 'θ', alpha: 'α', beta: 'β' }

const SPACES: Record<string, number> = { ',': 0.17, ':': 0.22, ';': 0.28, ' ': 0.25, quad: 1, qquad: 2 }

const FONT_COMMANDS = new Set(['text', 'textrm', 'mathrm', 'mbox'])
const IGNORED_COMMANDS = new Set(['left', 'right', 'displaystyle', 'mathit', '!', '\\'])

const CHAR_OPS: Record<string, { text: string; kind: OpNode['kind'] }> = {
  '+': { text: '+', kind: 'bin' },
  '-': { text: '−', kind: 'bin' },
  '*': { text: '×', kind: 'bin' },
  '=': { text: '=', kind: 'rel' },
  '<': { text: '<', kind: 'rel' },
  '>': { text: '>', kind: 'rel' },
  '(': { text: '(', kind: 'open' },
  '[': { text: '[', kind: 'open' },
  ')': { text: ')', kind: 'close' },
  ']': { text: ']', kind: 'close' },
  ',': { text: ',', kind: 'punct' },
  ';': { text: ';', kind: 'punct' },
  ':': { text: ':', kind: 'rel' },
  '/': { text: '/', kind: 'ord' },
  '|': { text: '|', kind: 'ord' },
  '!': { text: '!', kind: 'ord' },
  '%': { text: '%', kind: 'ord' },
  "'": { text: '′', kind: 'ord' },
}

/** Split text into prose runs and `$…$` math segments. */
export function parseMathText(input: string): MathTextNode[] {
  const out: MathTextNode[] = []
  let text = ''
  const flushText = () => {
    if (text) out.push({ type: 'text', text })
    text = ''
  }
  let i = 0
  while (i < input.length) {
    const c = input[i]
    if (c === '\\' && input[i + 1] === '$') {
      text += '$'
      i += 2
    } else if (c === '$') {
      const close = findClosingDollar(input, i + 1)
      if (close < 0) {
        // Unmatched: the rest is prose, dollar sign included.
        text += input.slice(i)
        break
      }
      const children = parseMath(input.slice(i + 1, close))
      if (children.length) {
        flushText()
        out.push({ type: 'math', children })
      }
      i = close + 1
    } else {
      text += c
      i++
    }
  }
  flushText()
  return out
}

function findClosingDollar(s: string, from: number): number {
  for (let i = from; i < s.length; i++) {
    if (s[i] === '\\') i++
    else if (s[i] === '$') return i
  }
  return -1
}

/** Parse TeX-subset math (no surrounding `$`). */
export function parseMath(tex: string): MathNode[] {
  return new MathParser(tex).parseList(null)
}

class MathParser {
  private pos = 0
  private readonly src: string

  constructor(src: string) {
    this.src = src
  }

  /** Parse until `stop` (']' or '}' at this depth) or end of input; consumes the stop char. */
  parseList(stop: '}' | ']' | null): MathNode[] {
    const nodes: MathNode[] = []
    while (this.pos < this.src.length) {
      const c = this.src[this.pos]
      if (c === stop) {
        this.pos++
        return nodes
      }
      if (c === '}') {
        // Stray close brace: ignore.
        this.pos++
        continue
      }
      this.parseAtom(nodes)
    }
    return nodes
  }

  private parseAtom(nodes: MathNode[]): void {
    const src = this.src
    const c = src[this.pos]

    if (/\s/.test(c)) {
      this.pos++
      return
    }
    if (/[0-9.]/.test(c)) {
      const m = /^(?:\d+(?:,\d{3}(?!\d))*(?:\.\d+)?|\.\d+)/.exec(src.slice(this.pos))
      if (m) {
        this.pos += m[0].length
        pushMerged(nodes, { type: 'num', text: m[0] })
      } else {
        this.pos++
        nodes.push({ type: 'op', text: c, kind: 'ord' })
      }
      return
    }
    if (/[A-Za-z]/.test(c)) {
      this.pos++
      nodes.push({ type: 'var', text: c })
      return
    }
    if (c === '^' || c === '_') {
      this.pos++
      const children = this.parseArgument()
      nodes.push({ type: c === '^' ? 'sup' : 'sub', children })
      return
    }
    if (c === '{') {
      this.pos++
      nodes.push(...this.parseList('}'))
      return
    }
    if (c === '\\') {
      this.parseCommand(nodes)
      return
    }
    const op = CHAR_OPS[c]
    this.pos++
    if (op) pushOp(nodes, op.text, op.kind)
    else nodes.push({ type: 'op', text: c, kind: 'ord' })
  }

  private parseCommand(nodes: MathNode[]): void {
    const src = this.src
    this.pos++ // backslash
    if (this.pos >= src.length) return
    let name: string
    if (/[A-Za-z]/.test(src[this.pos])) {
      const m = /^[A-Za-z]+/.exec(src.slice(this.pos))!
      name = m[0]
    } else {
      name = src[this.pos]
    }
    this.pos += name.length

    if (name === 'frac' || name === 'dfrac' || name === 'tfrac') {
      const num = this.parseArgument()
      const den = this.parseArgument()
      nodes.push({ type: 'frac', num, den })
    } else if (name === 'sqrt') {
      this.skipSpaces()
      let index: MathNode[] | undefined
      if (src[this.pos] === '[') {
        this.pos++
        index = this.parseList(']')
      }
      const children = this.parseArgument()
      nodes.push(index?.length ? { type: 'sqrt', children, index } : { type: 'sqrt', children })
    } else if (FONT_COMMANDS.has(name)) {
      const text = this.readRawGroup()
      if (text) nodes.push({ type: 'text', text })
    } else if (name in SPACES) {
      nodes.push({ type: 'space', em: SPACES[name] })
    } else if (name in SYMBOLS) {
      const sym = SYMBOLS[name]
      pushOp(nodes, sym.text, sym.kind)
    } else if (name in GREEK) {
      nodes.push({ type: 'var', text: GREEK[name] })
    } else if (IGNORED_COMMANDS.has(name)) {
      // \left( → just the bracket that follows.
    } else {
      // Unknown command: show its name rather than dropping content.
      nodes.push({ type: 'text', text: name })
    }
  }

  /** A `{group}` or a single token (for ^2, \frac12). Missing argument → []. */
  private parseArgument(): MathNode[] {
    this.skipSpaces()
    if (this.pos >= this.src.length) return []
    const c = this.src[this.pos]
    if (c === '{') {
      this.pos++
      return this.parseList('}')
    }
    if (c === '}' || c === ']' || c === '^' || c === '_') return []
    if (/[0-9]/.test(c)) {
      // TeX takes one digit: x^23 → x²3.
      this.pos++
      return [{ type: 'num', text: c }]
    }
    const nodes: MathNode[] = []
    this.parseAtom(nodes)
    return nodes
  }

  /** Raw text of `{…}` (for \text), braces balanced; single char if no brace. */
  private readRawGroup(): string {
    this.skipSpaces()
    const src = this.src
    if (src[this.pos] !== '{') {
      const ch = src[this.pos] ?? ''
      this.pos++
      return ch
    }
    let depth = 0
    let out = ''
    for (this.pos++; this.pos < src.length; this.pos++) {
      const ch = src[this.pos]
      if (ch === '{') depth++
      else if (ch === '}') {
        if (depth === 0) {
          this.pos++
          return out
        }
        depth--
      }
      out += ch
    }
    return out
  }

  private skipSpaces(): void {
    while (this.pos < this.src.length && /\s/.test(this.src[this.pos])) this.pos++
  }
}

/** Adjacent numbers merge ("1" "2" from `1{2}` stays "12"). */
function pushMerged(nodes: MathNode[], node: NumNode): void {
  const last = nodes[nodes.length - 1]
  if (last?.type === 'num') last.text += node.text
  else nodes.push(node)
}

/** A +/− with nothing, an operator, or an open bracket before it is a sign, not a binary op. */
function pushOp(nodes: MathNode[], text: string, kind: OpNode['kind']): void {
  if (kind === 'bin' && (text === '+' || text === '−' || text === '±' || text === '∓')) {
    const prev = nodes[nodes.length - 1]
    if (!prev || (prev.type === 'op' && prev.kind !== 'close' && prev.kind !== 'ord')) kind = 'unary'
  }
  nodes.push({ type: 'op', text, kind })
}

const SUPERSCRIPTS: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
  '+': '⁺', '−': '⁻', n: 'ⁿ', '(': '⁽', ')': '⁾',
}

/** Readable plain-text rendering (for aria-labels, logs, label fallbacks): "x² + ½" style where possible. */
export function toPlainText(nodes: readonly (MathNode | MathSegment)[]): string {
  let out = ''
  for (const node of nodes) {
    switch (node.type) {
      case 'math':
        out += toPlainText(node.children)
        break
      case 'text':
      case 'num':
      case 'var':
        out += node.text
        break
      case 'op':
        out += node.kind === 'bin' || node.kind === 'rel' ? ` ${node.text} ` : node.kind === 'punct' ? `${node.text} ` : node.text
        break
      case 'space':
        out += ' '
        break
      case 'sup': {
        const plain = toPlainText(node.children).trim()
        const mapped = [...plain].map((ch) => SUPERSCRIPTS[ch])
        out += mapped.every(Boolean) ? mapped.join('') : `^(${plain})`
        break
      }
      case 'sub':
        out += `_(${toPlainText(node.children).trim()})`
        break
      case 'frac':
        out += `${wrap(toPlainText(node.num).trim())}/${wrap(toPlainText(node.den).trim())}`
        break
      case 'sqrt':
        out += `${node.index ? toPlainText(node.index).trim() : ''}√${wrap(toPlainText(node.children).trim())}`
        break
    }
  }
  return out.replace(/ {2,}/g, ' ')
}

function wrap(s: string): string {
  return /^[\w.′]+$/.test(s) ? s : `(${s})`
}

/** True if the string contains a `$…$` span (a cheap pre-check before parsing). */
export function hasMath(input: string): boolean {
  return parseMathText(input).some((n) => n.type === 'math')
}

/** Plain text of a prompt with inline math, e.g. "Combine like terms: 4x + 6x." */
export function mathTextToPlain(input: string): string {
  return toPlainText(parseMathText(input))
}

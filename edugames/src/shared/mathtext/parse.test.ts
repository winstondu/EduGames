import { describe, expect, test } from 'bun:test'
import { hasMath, mathTextToPlain, parseMath, parseMathText } from './parse'

describe('parseMathText', () => {
  test('Combine like terms: $4x + 6x$.', () => {
    expect(parseMathText('Combine like terms: $4x + 6x$.')).toEqual([
      { type: 'text', text: 'Combine like terms: ' },
      {
        type: 'math',
        children: [
          { type: 'num', text: '4' },
          { type: 'var', text: 'x' },
          { type: 'op', text: '+', kind: 'bin' },
          { type: 'num', text: '6' },
          { type: 'var', text: 'x' },
        ],
      },
      { type: 'text', text: '.' },
    ])
  })

  test('Evaluate $4x + 1$ when $x = 4$.', () => {
    const nodes = parseMathText('Evaluate $4x + 1$ when $x = 4$.')
    expect(nodes.map((n) => n.type)).toEqual(['text', 'math', 'text', 'math', 'text'])
    expect(nodes[2]).toEqual({ type: 'text', text: ' when ' })
    expect(nodes[3]).toEqual({
      type: 'math',
      children: [
        { type: 'var', text: 'x' },
        { type: 'op', text: '=', kind: 'rel' },
        { type: 'num', text: '4' },
      ],
    })
    expect(mathTextToPlain('Evaluate $4x + 1$ when $x = 4$.')).toBe('Evaluate 4x + 1 when x = 4.')
  })

  test('plain text passes through untouched', () => {
    expect(parseMathText('What is 6 + 7?')).toEqual([{ type: 'text', text: 'What is 6 + 7?' }])
    expect(parseMathText('')).toEqual([])
    expect(hasMath('6+7')).toBe(false)
    expect(hasMath('$6+7$')).toBe(true)
  })

  test('unbalanced $ is literal text', () => {
    expect(parseMathText('It costs $5 today')).toEqual([{ type: 'text', text: 'It costs $5 today' }])
    expect(parseMathText('$x$ and $y')).toEqual([
      { type: 'math', children: [{ type: 'var', text: 'x' }] },
      { type: 'text', text: ' and $y' },
    ])
    expect(parseMathText('$')).toEqual([{ type: 'text', text: '$' }])
  })

  test('escaped \\$ is a literal dollar, inside and outside math', () => {
    expect(parseMathText('Pay \\$3 for $2 + 1$')).toEqual([
      { type: 'text', text: 'Pay $3 for ' },
      {
        type: 'math',
        children: [
          { type: 'num', text: '2' },
          { type: 'op', text: '+', kind: 'bin' },
          { type: 'num', text: '1' },
        ],
      },
    ])
    expect(parseMathText('$\\$5$')).toEqual([
      {
        type: 'math',
        children: [
          { type: 'op', text: '$', kind: 'ord' },
          { type: 'num', text: '5' },
        ],
      },
    ])
  })

  test('empty math is dropped', () => {
    expect(parseMathText('a $$ b')).toEqual([{ type: 'text', text: 'a  b' }])
  })
})

describe('parseMath', () => {
  test('fractions', () => {
    expect(parseMath('\\frac{3}{4}')).toEqual([{ type: 'frac', num: [{ type: 'num', text: '3' }], den: [{ type: 'num', text: '4' }] }])
    // TeX shorthand: one token per argument.
    expect(parseMath('\\frac12')).toEqual([{ type: 'frac', num: [{ type: 'num', text: '1' }], den: [{ type: 'num', text: '2' }] }])
    const nested = parseMath('\\frac{x+1}{\\frac{1}{2}}')
    expect(nested[0].type).toBe('frac')
    expect(mathTextToPlain('$\\frac{x+1}{\\frac{1}{2}}$')).toBe('(x + 1)/(1/2)')
    expect(mathTextToPlain('$\\dfrac{2}{3} + \\frac{1}{3}$')).toBe('2/3 + 1/3')
  })

  test('exponents and subscripts', () => {
    expect(parseMath('x^2')).toEqual([
      { type: 'var', text: 'x' },
      { type: 'sup', children: [{ type: 'num', text: '2' }] },
    ])
    expect(parseMath('2^{10}')).toEqual([
      { type: 'num', text: '2' },
      { type: 'sup', children: [{ type: 'num', text: '10' }] },
    ])
    // ^ takes a single digit without braces.
    expect(parseMath('x^23')).toEqual([
      { type: 'var', text: 'x' },
      { type: 'sup', children: [{ type: 'num', text: '2' }] },
      { type: 'num', text: '3' },
    ])
    expect(parseMath('a_{n-1}')[1]).toEqual({
      type: 'sub',
      children: [
        { type: 'var', text: 'n' },
        { type: 'op', text: '−', kind: 'bin' },
        { type: 'num', text: '1' },
      ],
    })
    expect(mathTextToPlain('$x^2 + y^{2}$')).toBe('x² + y²')
    expect(mathTextToPlain('$2^{x+1}$')).toBe('2^(x + 1)')
  })

  test('operators map to display glyphs with spacing classes', () => {
    const ops = parseMath('a \\times b \\div c \\cdot d - e \\le f \\ge g < h > i').filter((n) => n.type === 'op')
    expect(ops.map((n) => (n.type === 'op' ? `${n.text}:${n.kind}` : ''))).toEqual([
      '×:bin',
      '÷:bin',
      '·:bin',
      '−:bin',
      '≤:rel',
      '≥:rel',
      '<:rel',
      '>:rel',
    ])
  })

  test('unary minus: leading, after operators and open brackets', () => {
    const kinds = (tex: string) => parseMath(tex).flatMap((n) => (n.type === 'op' ? [n.kind] : []))
    expect(kinds('-3')).toEqual(['unary'])
    expect(kinds('5 - -3')).toEqual(['bin', 'unary'])
    expect(kinds('(-2)(-3)')).toEqual(['open', 'unary', 'close', 'open', 'unary', 'close'])
    expect(kinds('x = -1')).toEqual(['rel', 'unary'])
    expect(kinds('(a) - b')).toEqual(['open', 'close', 'bin'])
    expect(mathTextToPlain('$-3 + (-2)$')).toBe('−3 + (−2)')
  })

  test('numbers: decimals and digit grouping', () => {
    expect(parseMath('3.25')).toEqual([{ type: 'num', text: '3.25' }])
    expect(parseMath('1,000')).toEqual([{ type: 'num', text: '1,000' }])
    expect(parseMath('f(1,2)').map((n) => n.type)).toEqual(['var', 'op', 'num', 'op', 'num', 'op'])
  })

  test('square roots', () => {
    expect(parseMath('\\sqrt{16}')).toEqual([{ type: 'sqrt', children: [{ type: 'num', text: '16' }] }])
    expect(parseMath('\\sqrt[3]{8}')).toEqual([
      { type: 'sqrt', children: [{ type: 'num', text: '8' }], index: [{ type: 'num', text: '3' }] },
    ])
    expect(mathTextToPlain('$\\sqrt{x+1}$')).toBe('√(x + 1)')
    expect(mathTextToPlain('$\\sqrt{9}$')).toBe('√9')
  })

  test('\\text, spacing, greek and \\left/\\right', () => {
    expect(parseMath('5\\text{ cm}')).toEqual([
      { type: 'num', text: '5' },
      { type: 'text', text: ' cm' },
    ])
    expect(parseMath('a\\,b')[1]).toEqual({ type: 'space', em: 0.17 })
    expect(parseMath('2\\pi r')[1]).toEqual({ type: 'var', text: 'π' })
    expect(parseMath('\\left(x\\right)').map((n) => n.type)).toEqual(['op', 'var', 'op'])
  })

  test('garbage never throws', () => {
    for (const s of ['\\frac{1}{', '}}x{{', '^_^', '\\', '\\sqrt', '\\frac', 'x^', '\\unknown{3}', '{{{', '\\sqrt[3', '.']) {
      expect(() => parseMath(s)).not.toThrow()
    }
    expect(parseMath('\\frac{1}{2')).toEqual([{ type: 'frac', num: [{ type: 'num', text: '1' }], den: [{ type: 'num', text: '2' }] }])
    expect(parseMath('x}')).toEqual([{ type: 'var', text: 'x' }])
    expect(parseMath('\\foo')).toEqual([{ type: 'text', text: 'foo' }])
  })
})

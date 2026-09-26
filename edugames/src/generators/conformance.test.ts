import { describe, expect, test } from 'bun:test'
import { checkConformance, type ConformanceCase, type ConformanceIssue } from './conformance'
import fixture, { FIXTURE_SETS } from './fixture/index'
import kindermath from './kindermath/index'
import type { KinderQuestion } from './kindermath/mapping'
import math from './math/index'
import { IncompatibleGeneratorError, type GeneratorPlugin, type Problem, type ProblemSource } from './types'

const show = (issues: ConformanceIssue[]) => issues.map((i) => `${i.rule}${i.case ? ` [${i.case}]` : ''}: ${i.message}`)

describe('generator conformance', () => {
  test('math: every op set in both formats', async () => {
    const cases: ConformanceCase[] = []
    for (const ops of ['add', 'add,sub', 'mul', 'div', 'add,sub,mul,div']) {
      for (const format of ['mc', 'freeform']) cases.push({ params: { ops, format } })
    }
    cases.push({ params: {}, name: 'defaults' })
    const report = await checkConformance(math as GeneratorPlugin<unknown>, { cases })
    expect(show(report.issues)).toEqual([])
    expect(report.checked).toBeGreaterThan(1000)
  })

  test('fixture: every set (flaky/slow checks excluded from verdict rules)', async () => {
    const cases = FIXTURE_SETS.map((set) => ({ params: { set }, unreliableChecks: set === 'flaky' || set === 'slow' }))
    const report = await checkConformance(fixture as GeneratorPlugin<unknown>, { cases })
    expect(show(report.issues)).toEqual([])
  })

  test('kindermath: against a fake server half (offline)', async () => {
    const lesson = '11111111-2222-4333-8444-555555555555'
    const questions: KinderQuestion[] = [
      ...Array.from({ length: 5 }, (_, i) => ({
        id: `aaaaaaaa-0000-4000-8000-00000000000${i}`,
        kind: 'MCQ' as const,
        prompt: `Combine like terms: $${i + 2}x + ${i + 1}x$.`,
        choices: [
          { id: `c${i}-right`, text: `${2 * i + 3}x` },
          { id: `c${i}-wrong`, text: `${i + 9}` },
        ],
        difficulty: 1 + (i % 5),
      })),
      ...Array.from({ length: 5 }, (_, i) => ({
        id: `bbbbbbbb-0000-4000-8000-00000000000${i}`,
        kind: 'TYPED' as const,
        prompt: `Evaluate $x + ${i}$ when $x = 4$.`,
        difficulty: 1 + (i % 5),
      })),
    ]
    const answers = new Map<string, string>([
      ...questions.filter((q) => q.kind === 'MCQ').map((q, i) => [q.id, `c${i}-right`] as [string, string]),
      ...questions.filter((q) => q.kind === 'TYPED').map((q, i) => [q.id, String(4 + i)] as [string, string]),
    ])
    const api = async (path: string, init?: RequestInit): Promise<Response> => {
      if (path === `lessons/${lesson}/questions`) return Response.json(questions)
      if (path === `lessons/${lesson}`) return Response.json({ id: lesson, title: 'Like terms' })
      if (path === 'check' && init?.method === 'POST') {
        const { questionId, given } = JSON.parse(String(init.body)) as { questionId: string; given: string }
        return Response.json({ correct: answers.get(questionId) === given.trim() })
      }
      return new Response('not found', { status: 404 })
    }
    const report = await checkConformance(kindermath as GeneratorPlugin<unknown>, { cases: [{ params: { lesson } }], api })
    expect(show(report.issues)).toEqual([])
  })

  test('the suite catches a broken plugin', async () => {
    const problem = (i: number): Problem => ({
      id: 'same',
      prompt: i % 2 ? '$\\bogus{1}$ + 2' : '1 + 1',
      level: 9,
      format: 'multiple-choice',
      choices: [
        { id: 'a', text: '2' },
        { id: 'a', text: '2' },
      ],
    })
    let n = 0
    const broken: GeneratorPlugin<{ x: string }> = {
      id: 'Broken!',
      name: 'Broken',
      description: '',
      kind: 'client',
      maxLevel: 3,
      defaultInput: { kind: 'numeric', maxLength: 0 },
      formats: ['multiple-choice'],
      formatSelectable: false,
      parseOptions: (p) => {
        if (p.get('set') === '__proto__') throw new Error('boom')
        return { x: p.get('x') ?? 'default' }
      },
      serializeOptions: () => ({ x: 'other' }),
      boardKey: (o) => `elsewhere/${o.x}`,
      describe: async () => 'Broken',
      async create(): Promise<ProblemSource> {
        return { next: () => problem(n++), check: () => ({ correct: true }) }
      },
    }
    const rules = new Set((await checkConformance(broken as GeneratorPlugin<unknown>, { cases: [{ params: { x: 'y' } }] })).issues.map((i) => i.rule))
    for (const r of [
      'meta.id',
      'meta.defaultInput',
      'options.garbage',
      'options.roundtrip',
      'board.prefix',
      'requirements.reject',
      'problem.level',
      'problem.prompt',
      'problem.choices',
      'problem.id',
      'check.mc',
    ]) {
      expect(rules).toContain(r)
    }
  })

  test('math and fixture honor a smaller host choice limit', async () => {
    for (const maxChoices of [2, 3]) {
      const m = await checkConformance(math as GeneratorPlugin<unknown>, { cases: [{ params: { ops: 'add,sub,mul,div', format: 'mc' } }], maxChoices })
      expect(show(m.issues)).toEqual([])
      const f = await checkConformance(fixture as GeneratorPlugin<unknown>, { cases: [{ params: { set: 'mc' } }], maxChoices })
      expect(show(f.issues)).toEqual([])
    }
  })

  test('a plugin that ignores requirements.maxChoices is flagged', async () => {
    let n = 0
    const greedy: GeneratorPlugin<Record<string, never>> = {
      id: 'greedy',
      name: 'Greedy',
      description: '',
      kind: 'client',
      maxLevel: 1,
      defaultInput: { kind: 'numeric', maxLength: 3 },
      formats: ['multiple-choice'],
      formatSelectable: false,
      parseOptions: () => ({}),
      serializeOptions: () => ({}),
      boardKey: () => 'greedy',
      describe: async () => 'Greedy',
      async create(): Promise<ProblemSource> {
        return {
          next: () => ({
            id: `g${n++}`,
            prompt: `${n} + 1`,
            level: 1,
            format: 'multiple-choice',
            choices: [0, 1, 2, 3].map((k) => ({ id: `c${k}`, text: String(n + k) })),
          }),
          check: (_p, given) => ({ correct: given === 'c1' }),
        }
      },
    }
    const issues = (await checkConformance(greedy as GeneratorPlugin<unknown>, { cases: [{ params: {} }] })).issues
    expect(issues.some((i) => i.rule === 'problem.choices' && i.case?.includes('maxChoices=2'))).toBe(true)
    // Within the default limit (4) it conforms.
    expect(issues.filter((i) => !i.case?.includes('maxChoices=2')).map((i) => i.rule)).not.toContain('problem.choices')
  })

  test('IncompatibleGeneratorError is recognised by name, not instanceof', () => {
    const err = new IncompatibleGeneratorError('x')
    expect(err.name).toBe('IncompatibleGeneratorError')
  })
})

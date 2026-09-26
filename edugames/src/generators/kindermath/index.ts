/**
 * kindermath — hybrid generator plugin (browser half). One board per lesson;
 * lessons mix MCQ (multiple-choice) and TYPED (freeform) problems, so the
 * source decides the format per problem (formatSelectable = false). The
 * question bank and answer checking live behind api.kindermath.org, reached
 * only through this plugin's server half via `ctx.api(...)`.
 */
import {
  IncompatibleGeneratorError,
  type AnswerInputSpec,
  type AuthStatus,
  type CheckResult,
  type GeneratorContext,
  type GeneratorPlugin,
  type GeneratorVariant,
  type Problem,
  type ProblemRequirements,
  type ProblemSource,
} from '../types'
import {
  getCourse,
  getCourses,
  getLesson,
  getQuestions,
  getSession,
  postLogin,
  postLogout,
} from './client'
import { createPicker, mapPool } from './mapping'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SLUG = /^[a-z0-9-]{1,64}$/

export interface KinderOptions {
  /** Lesson uuid — required. */
  lesson: string
  /** Course slug — optional context for pickers/labels. */
  course?: string
}

const DEFAULT_INPUT: AnswerInputSpec = { kind: 'text', maxLength: 12 }

async function checkAnswer(
  ctx: GeneratorContext,
  problem: Problem,
  given: string,
): Promise<CheckResult> {
  const res = await ctx.api('check', {
    method: 'POST',
    body: JSON.stringify({ questionId: problem.id, given }),
  })
  // Server/network failures void the shot — let the host handle the throw.
  if (res.status >= 500) throw new Error(`kindermath check: HTTP ${res.status}`)
  if (!res.ok) throw new Error(`kindermath check: HTTP ${res.status}`)
  const body = (await res.json()) as { correct?: boolean; explanation?: string }
  return { correct: body.correct === true, explanation: body.explanation }
}

const plugin: GeneratorPlugin<KinderOptions> = {
  id: 'kindermath',
  name: 'KinderMath',
  description: 'Lessons from api.kindermath.org — mixed multiple-choice and typed practice.',
  kind: 'hybrid',
  maxLevel: 5,
  defaultInput: DEFAULT_INPUT,
  formats: ['freeform', 'multiple-choice'],
  formatSelectable: false,

  parseOptions(params) {
    const lesson = params.get('lesson') ?? ''
    if (!UUID.test(lesson)) return null
    const course = params.get('course') ?? undefined
    return { lesson, course: course && SLUG.test(course) ? course : undefined }
  },

  serializeOptions(options) {
    const out: Record<string, string> = { lesson: options.lesson }
    if (options.course) out.course = options.course
    return out
  },

  boardKey(options) {
    return `kindermath/${options.lesson}`
  },

  async describe(options, ctx) {
    try {
      const lesson = await getLesson(ctx, options.lesson)
      return lesson.title || 'KinderMath lesson'
    } catch {
      return 'KinderMath lesson'
    }
  },

  async listVariants(ctx): Promise<GeneratorVariant[]> {
    const courses = await getCourses(ctx)
    const overviews = await Promise.all(
      courses.map((c) =>
        getCourse(ctx, c.slug).catch(() => null as Awaited<ReturnType<typeof getCourse>> | null),
      ),
    )
    const variants: GeneratorVariant[] = []
    overviews.forEach((overview, i) => {
      if (!overview) return
      const courseTitle = overview.title || courses[i].title
      for (const unit of overview.units ?? []) {
        for (const lesson of unit.lessons ?? []) {
          if (!UUID.test(lesson.id)) continue
          variants.push({
            params: { course: overview.slug, lesson: lesson.id },
            label: lesson.title,
            group: `${courseTitle} › ${unit.title}`,
          })
        }
      }
    })
    return variants
  },

  auth: {
    fields: [
      { name: 'email', label: 'Email', type: 'email' },
      { name: 'password', label: 'Password', type: 'password' },
    ],
    async status(ctx): Promise<AuthStatus> {
      try {
        return await getSession(ctx)
      } catch {
        return { loggedIn: false, demo: true }
      }
    },
    async login(ctx, credentials) {
      try {
        return await postLogin(ctx, credentials)
      } catch {
        return { loggedIn: false, demo: true, error: 'Login is not available yet.' }
      }
    },
    async logout(ctx) {
      try {
        await postLogout(ctx)
      } catch {
        // Stub logout — nothing to clear client-side.
      }
    },
  },

  async create(options, ctx, requirements: ProblemRequirements): Promise<ProblemSource> {
    const questions = await getQuestions(ctx, options.lesson)
    const pool = mapPool(questions, requirements.formats)
    if (pool.length === 0) {
      throw new IncompatibleGeneratorError(
        'This lesson has no problems this game can present.',
      )
    }
    const picker = createPicker(pool, ctx.rng)
    return {
      next(level) {
        return picker.next(level)
      },
      check(problem, given) {
        return checkAnswer(ctx, problem, given)
      },
    }
  },
}

export default plugin

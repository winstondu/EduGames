/**
 * Thin typed wrappers over `ctx.api(...)`, which reaches the kindermath server
 * half at `<API_BASE>/v1/generators/kindermath/<path>`. No caching or retry
 * logic lives here — the server half owns that.
 */
import type { AuthStatus, GeneratorContext } from '../types'
import type { KinderQuestion } from './mapping'

export interface CourseSummary {
  id: string
  slug: string
  title: string
  description?: string
  subject?: string
  units?: number
  lessons?: number
}

export interface LessonRef {
  id: string
  title: string
  order?: number
}

export interface CourseOverview {
  id: string
  slug: string
  title: string
  units: { id: string; title: string; order?: number; lessons: LessonRef[] }[]
}

export interface LessonDetail {
  id: string
  title: string
  questions?: number
  course?: { slug?: string; title?: string }
  unit?: { title?: string }
}

async function json<T>(ctx: GeneratorContext, path: string, init?: RequestInit): Promise<T> {
  const res = await ctx.api(path, init)
  if (!res.ok) throw new Error(`kindermath ${path}: HTTP ${res.status}`)
  return (await res.json()) as T
}

export function getCourses(ctx: GeneratorContext): Promise<CourseSummary[]> {
  return json<CourseSummary[]>(ctx, 'courses')
}

export function getCourse(ctx: GeneratorContext, slug: string): Promise<CourseOverview> {
  return json<CourseOverview>(ctx, `courses/${encodeURIComponent(slug)}`)
}

export function getLesson(ctx: GeneratorContext, id: string): Promise<LessonDetail> {
  return json<LessonDetail>(ctx, `lessons/${encodeURIComponent(id)}`)
}

export function getQuestions(ctx: GeneratorContext, id: string): Promise<KinderQuestion[]> {
  return json<KinderQuestion[]>(ctx, `lessons/${encodeURIComponent(id)}/questions`)
}

export function getSession(ctx: GeneratorContext): Promise<AuthStatus> {
  return json<AuthStatus>(ctx, 'session')
}

export function postLogin(
  ctx: GeneratorContext,
  credentials: Record<string, string>,
): Promise<AuthStatus & { error?: string; message?: string }> {
  return json(ctx, 'login', { method: 'POST', body: JSON.stringify(credentials) })
}

export function postLogout(ctx: GeneratorContext): Promise<unknown> {
  return json(ctx, 'logout', { method: 'POST' })
}

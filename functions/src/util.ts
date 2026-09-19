import { createHash, randomBytes } from 'node:crypto'

// Crockford base32 ULID: 10 chars of ms time + 16 random. Lexicographic order == creation order.
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
export function ulid(now = Date.now()): string {
  let t = ''
  for (let i = 0, ms = now; i < 10; i++, ms = Math.floor(ms / 32)) t = B32[ms % 32] + t
  const r = randomBytes(16)
  let s = ''
  for (let i = 0; i < 16; i++) s += B32[r[i]! % 32]
  return t + s
}

/** Synthetic ULID at a timestamp with an all-zero suffix: sorts before every real id minted at or after `ms`. */
export function ulidAt(ms: number): string {
  return ulid(ms).slice(0, 10) + '0000000000000000'
}

export const ULID_RE = /^[0-9A-Z]{26}$/
export const ID_RE = /^[A-Za-z0-9_-]{1,128}$/

export function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex')
}

export function newToken(): { token: string; hash: string; prefix: string } {
  const token = 'ac_' + randomBytes(32).toString('base64url')
  return { token, hash: sha256(token), prefix: token.slice(0, 10) }
}

export class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export const CHANNEL_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/
export const SCOPE_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/
export const KINDS = ['event', 'notice', 'question'] as const
export const QUESTION_TYPES = ['confirm', 'choice', 'text'] as const
export const PRIORITIES = ['urgent', 'normal', 'low'] as const
export type Kind = (typeof KINDS)[number]
export type QuestionType = (typeof QUESTION_TYPES)[number]
export type Priority = (typeof PRIORITIES)[number]
export const THREAD_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/
export const TAG_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/
export const CONSUMER_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/
export const KEY_RE = /^[\x21-\x7e]{1,128}$/

export interface Question {
  type: QuestionType
  options?: string[]
}

export interface NewMessage {
  channel: string
  kind: Kind
  body: string
  data?: string
  question?: Question
  replyTo?: string
  thread?: string
  priority?: Priority
  tag?: string
  idempotencyKey?: string
}

const MAX_BODY = 16 * 1024
const MAX_DATA = 64 * 1024

/** Validates and normalizes a POST /messages payload. Throws HttpError(400). */
export function parseNewMessage(input: unknown): NewMessage {
  const o = (input ?? {}) as Record<string, unknown>
  const channel = String(o.channel ?? '')
  if (!CHANNEL_RE.test(channel)) throw new HttpError(400, `invalid channel: ${channel}`)
  const kind = String(o.kind ?? 'event') as Kind
  if (!KINDS.includes(kind)) throw new HttpError(400, `invalid kind: ${kind}`)
  if (typeof o.body !== 'string') throw new HttpError(400, 'body must be a string')
  const body = o.body
  if (!body.trim()) throw new HttpError(400, 'body is required')
  if (body.length > MAX_BODY) throw new HttpError(400, `body exceeds ${MAX_BODY} chars`)
  const msg: NewMessage = { channel, kind, body }
  if (o.data !== undefined && o.data !== null) {
    // ponytail: stored as a JSON string — avoids Firestore auto-indexing arbitrary maps.
    const data = typeof o.data === 'string' ? o.data : JSON.stringify(o.data)
    if (data.length > MAX_DATA) throw new HttpError(400, `data exceeds ${MAX_DATA} chars`)
    msg.data = data
  }
  if (kind === 'question') {
    const q = (o.question ?? {}) as Record<string, unknown>
    const type = String(q.type ?? 'confirm') as QuestionType
    if (!QUESTION_TYPES.includes(type)) throw new HttpError(400, `invalid question.type: ${type}`)
    msg.question = { type }
    if (type === 'choice') {
      const options = Array.isArray(q.options) ? q.options.map(String) : []
      if (options.length < 2 || options.length > 20) throw new HttpError(400, 'choice needs 2–20 options')
      if (options.some((s) => s.length > 200)) throw new HttpError(400, 'option exceeds 200 chars')
      msg.question.options = options
    }
  } else if (o.question) {
    throw new HttpError(400, 'question is only valid for kind=question')
  }
  if (o.replyTo !== undefined) {
    if (!ULID_RE.test(String(o.replyTo))) throw new HttpError(400, 'replyTo must be a message id')
    msg.replyTo = String(o.replyTo)
  }
  if (o.thread !== undefined) {
    if (!THREAD_RE.test(String(o.thread))) throw new HttpError(400, 'invalid thread (1–128 chars: letters, digits, . _ : / -)')
    msg.thread = String(o.thread)
  }
  if (o.priority !== undefined) {
    if (!PRIORITIES.includes(o.priority as Priority)) throw new HttpError(400, 'priority must be urgent, normal or low')
    if (o.priority !== 'normal') msg.priority = o.priority as Priority
  }
  if (o.tag !== undefined) {
    if (!TAG_RE.test(String(o.tag))) throw new HttpError(400, 'invalid tag (lowercase, a-z0-9._-, max 64)')
    msg.tag = String(o.tag)
  }
  if (o.idempotencyKey !== undefined) {
    if (!KEY_RE.test(String(o.idempotencyKey))) throw new HttpError(400, 'invalid idempotencyKey (1–128 printable ASCII)')
    msg.idempotencyKey = String(o.idempotencyKey)
  }
  return msg
}

/** Token channel policy: `*` matches all, `build*` a prefix, `build` exactly. Empty list = all channels. */
export function channelAllowed(patterns: string[] | undefined, channel: string): boolean {
  if (!patterns || !patterns.length) return true
  return patterns.some((p) => (p === '*' ? true : p.endsWith('*') ? channel.startsWith(p.slice(0, -1)) : p === channel))
}

export const CHANNEL_PATTERN_RE = /^[a-z0-9][a-z0-9._-]{0,63}\*?$|^\*$/

/** Validates an answer against the question. Returns the normalized value. */
export function parseAnswer(question: Question, value: unknown): string | boolean {
  if (question.type === 'confirm') {
    if (typeof value === 'boolean') return value
    const s = String(value).toLowerCase()
    if (['yes', 'y', 'true', '1', 'ok'].includes(s)) return true
    if (['no', 'n', 'false', '0'].includes(s)) return false
    throw new HttpError(400, 'confirm answer must be yes/no')
  }
  const s = String(value ?? '')
  if (question.type === 'choice') {
    if (!question.options?.includes(s)) throw new HttpError(400, `answer must be one of: ${question.options?.join(', ')}`)
    return s
  }
  if (!s.trim()) throw new HttpError(400, 'text answer is required')
  if (s.length > MAX_BODY) throw new HttpError(400, `answer exceeds ${MAX_BODY} chars`)
  return s
}

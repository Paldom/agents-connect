import { onRequest, type Request } from 'firebase-functions/v2/https'
import { setGlobalOptions } from 'firebase-functions/v2'
import { defineString } from 'firebase-functions/params'
import * as logger from 'firebase-functions/logger'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore, FieldValue, FieldPath, Timestamp, type DocumentReference, type Query } from 'firebase-admin/firestore'
import { getAuth } from 'firebase-admin/auth'
import { getMessaging } from 'firebase-admin/messaging'
import type { Response } from 'express'
import nodemailer from 'nodemailer'
import {
  HttpError, SCOPE_RE, CHANNEL_RE, ULID_RE, ID_RE, CONSUMER_RE, THREAD_RE, CHANNEL_PATTERN_RE,
  newToken, sha256, ulid, ulidAt, parseNewMessage, parseAnswer, channelAllowed, type Question, type NewMessage,
} from './util.ts'

setGlobalOptions({ region: 'europe-west1', maxInstances: 3, memory: '256MiB', timeoutSeconds: 30 })
initializeApp()
const db = getFirestore()

// Comma-separated emails allowed to use the hub as humans. Empty = any signed-in, verified user.
const ALLOWED_EMAILS = defineString('ALLOWED_EMAILS', { default: '' })
// ponytail: SMTP creds as a plain param (.env). Upgrade to defineSecret + functions:secrets:set if this hub becomes shared.
const SMTP_URL = defineString('SMTP_URL', { default: '' })
const SMTP_FROM = defineString('SMTP_FROM', { default: 'agents-connect <no-reply@localhost>' })
const APP_URL = defineString('APP_URL', { default: '' }) // e.g. https://<project-id>.web.app — set in functions/.env.<project-id>

const RETENTION_DAYS = 90
const RATE_LIMIT_PER_MIN = 120
const QUESTION_LIMIT_PER_MIN = 20
// Cursor reads exclude messages younger than this, so a slow commit on another instance cannot land behind a cursor that already moved past it.
const SETTLE_MS = 2000
const DEDUPE_WINDOW_MS = 24 * 3600_000
const NOTICE_PUSH_INTERVAL_MS = 60_000
const ACTIVE_WINDOW_MS = 10 * 60_000

type Principal =
  | { kind: 'agent'; uid: string; name: string; scopes: string[]; channels?: string[]; hash: string }
  | { kind: 'human'; uid: string; email: string }

interface Scope { id: string; name: string; ownerUid: string }

// ---------- auth ----------

async function authenticate(req: Request): Promise<Principal> {
  const h = req.get('authorization') ?? ''
  const bearer = h.startsWith('Bearer ') ? h.slice(7).trim() : ''
  if (!bearer) throw new HttpError(401, 'missing Authorization: Bearer <token>')
  if (bearer.startsWith('ac_')) {
    const hash = sha256(bearer)
    const ref = db.doc(`tokens/${hash}`) // ponytail: one read per request; revocation is immediate on every instance
    const snap = await ref.get()
    if (!snap.exists) throw new HttpError(401, 'invalid or revoked token')
    const d = snap.data()!
    const p: Principal = { kind: 'agent', uid: d.uid, name: d.name, scopes: d.scopes ?? [], channels: d.channels, hash }
    const last = (d.lastUsedAt as Timestamp | undefined)?.toMillis() ?? 0
    if (Date.now() - last > 60_000) void ref.update({ lastUsedAt: FieldValue.serverTimestamp() }).catch(() => {})
    return p
  }
  let decoded
  try {
    decoded = await getAuth().verifyIdToken(bearer)
  } catch {
    throw new HttpError(401, 'invalid ID token')
  }
  const email = decoded.email ?? ''
  if (!decoded.email_verified) throw new HttpError(403, 'email not verified: open the web app and use "Send verification email", then sign in again')
  const allowed = ALLOWED_EMAILS.value().split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
  if (allowed.length && !allowed.includes(email.toLowerCase())) throw new HttpError(403, 'email not allowed')
  return { kind: 'human', uid: decoded.uid, email }
}

function requireHuman(p: Principal): asserts p is Extract<Principal, { kind: 'human' }> {
  if (p.kind !== 'human') throw new HttpError(403, 'this action requires a signed-in human, not an agent token')
}

/** Who a message is from, and which client answered: `X-Client: web|ios|cli|hook|mcp`. */
const clientOf = (req: Request) => {
  const c = String(req.get('x-client') ?? '').toLowerCase()
  return ['web', 'ios', 'cli', 'hook', 'mcp'].includes(c) ? c : 'api'
}

// ---------- scopes ----------

/** Scope ids are derived from owner + name, so names are unique per owner and lookups are plain gets. */
const scopeId = (uid: string, name: string) => sha256(`${uid}/${name}`).slice(0, 28)

async function scopeById(id: string): Promise<Scope | null> {
  if (!ID_RE.test(id)) return null
  const snap = await db.doc(`scopes/${id}`).get()
  return snap.exists ? { id, name: snap.get('name'), ownerUid: snap.get('ownerUid') } : null
}

const scopeByName = (uid: string, name: string) => scopeById(scopeId(uid, name))

/** Resolves the scope for this request from X-Scope / ?scope (name) and checks the principal may use it. */
async function resolveScope(req: Request, p: Principal): Promise<Scope> {
  const name = String(req.get('x-scope') ?? req.query.scope ?? '')
  let scope: Scope | null = null
  if (name) {
    if (!SCOPE_RE.test(name)) throw new HttpError(400, `invalid scope name: ${name}`)
    scope = await scopeByName(p.uid, name)
    if (!scope) throw new HttpError(404, `scope not found: ${name}`)
  } else if (p.kind === 'agent' && p.scopes.length === 1 && p.scopes[0] !== '*') {
    scope = await scopeById(p.scopes[0]!)
    if (!scope) throw new HttpError(404, 'token scope no longer exists')
  } else {
    throw new HttpError(400, 'scope required: set X-Scope header or ?scope=<name>')
  }
  if (scope.ownerUid !== p.uid) throw new HttpError(403, 'not your scope')
  if (p.kind === 'agent' && !p.scopes.includes('*') && !p.scopes.includes(scope.id))
    throw new HttpError(403, `token not allowed for scope ${scope.name}`)
  return scope
}

function requireChannel(p: Principal, channel: string) {
  if (!CHANNEL_RE.test(channel)) throw new HttpError(400, 'channel is required (?channel=name)')
  if (p.kind === 'agent' && !channelAllowed(p.channels, channel)) throw new HttpError(403, `token not allowed on channel ${channel}`)
}

// ---------- rate limit ----------

// ponytail: per-instance sliding window; move to Firestore counters if agents get chatty across instances.
const rate = new Map<string, { n: number; t: number }>()
function rateLimit(key: string, perMin: number, what: string) {
  const now = Date.now()
  const r = rate.get(key)
  if (!r || now - r.t > 60_000) return void rate.set(key, { n: 1, t: now })
  if (++r.n > perMin) throw new HttpError(429, `rate limit: ${perMin} ${what}/minute per token`)
}

// ---------- notifications ----------

interface Delivery { push: number; email: boolean }

/**
 * Pushes and emails the scope owner about a notice or question. Returns what was attempted.
 * Notices: skipped when the channel is muted or `low` priority; at most one push per channel per minute
 * (later ones are folded into a count). Questions and `urgent` notices always go out.
 */
async function notifyOwner(scope: Scope, msgId: string, m: NewMessage & { from: string }): Promise<Delivery> {
  const none: Delivery = { push: 0, email: false }
  if (m.kind === 'notice' && m.priority === 'low') return none
  const [userSnap, user] = await Promise.all([db.doc(`users/${scope.ownerUid}`).get(), getAuth().getUser(scope.ownerUid)])
  const prefs = userSnap.data() ?? {}
  const muteUntil = (prefs.mute?.[`${scope.id}/${m.channel}`] as Timestamp | undefined)?.toMillis() ?? 0
  if (m.kind === 'notice' && muteUntil > Date.now()) return none

  let body = m.body.slice(0, 500)
  if (m.kind === 'notice' && m.priority !== 'urgent') {
    const chRef = db.doc(`scopes/${scope.id}/channels/${m.channel}`)
    const throttled = await db.runTransaction(async (tx) => {
      const ch = (await tx.get(chRef)).data() ?? {}
      const lastPushAt = (ch.lastPushAt as Timestamp | undefined)?.toMillis() ?? 0
      if (Date.now() - lastPushAt < NOTICE_PUSH_INTERVAL_MS) {
        tx.set(chRef, { suppressed: FieldValue.increment(1) }, { merge: true })
        return true
      }
      const suppressed: number = ch.suppressed ?? 0
      if (suppressed > 0) body = `${suppressed + 1} new notices on ${m.channel}. Latest: ${body}`.slice(0, 500)
      tx.set(chRef, { lastPushAt: Timestamp.now(), suppressed: 0 }, { merge: true })
      return false
    })
    if (throttled) return none
  }

  const urgent = m.kind === 'question' || m.priority === 'urgent'
  const title = `${m.kind === 'question' ? '❓' : 'ℹ️'} ${scope.name}/${m.channel} · ${m.from}`
  const link = `${APP_URL.value()}/s/${scope.name}/${m.channel}`
  const category = m.kind === 'question' ? m.question!.type : 'notice'
  const tokens: string[] = Array.isArray(prefs.fcmTokens) ? prefs.fcmTokens : []
  const jobs: Promise<unknown>[] = []
  const out: Delivery = { push: 0, email: false }
  if (tokens.length) {
    jobs.push(
      getMessaging()
        .sendEachForMulticast({
          tokens,
          notification: { title, body },
          data: { scope: scope.name, scopeId: scope.id, channel: m.channel, messageId: msgId, kind: m.kind, category, priority: m.priority ?? 'normal' },
          android: { priority: urgent ? 'high' : 'normal' },
          webpush: { headers: { Urgency: urgent ? 'high' : 'normal' }, fcmOptions: { link }, notification: { icon: `${APP_URL.value()}/icon-192.png`, tag: m.kind === 'question' ? msgId : `${scope.id}/${m.channel}` } },
          apns: { headers: { 'apns-priority': urgent ? '10' : '5' }, payload: { aps: { sound: 'default', category, threadId: `${scope.id}/${m.channel}` } } },
        })
        .then((res) => {
          out.push = res.successCount
          const dead = res.responses.flatMap((r, i) =>
            r.error && ['messaging/registration-token-not-registered', 'messaging/invalid-argument'].includes(r.error.code) ? [tokens[i]!] : [],
          )
          if (dead.length) return db.doc(`users/${scope.ownerUid}`).update({ fcmTokens: FieldValue.arrayRemove(...dead) })
        })
        .catch((e) => logger.warn('push failed', e)),
    )
  }
  if (SMTP_URL.value() && prefs.emailNotifications !== false && user.email) {
    const u = new URL(SMTP_URL.value())
    jobs.push(
      nodemailer
        .createTransport({
          host: u.hostname,
          port: Number(u.port) || (u.protocol === 'smtps:' ? 465 : 587),
          secure: u.protocol === 'smtps:',
          auth: u.username ? { user: decodeURIComponent(u.username), pass: decodeURIComponent(u.password) } : undefined,
          connectionTimeout: 5000,
          socketTimeout: 10_000,
        })
        .sendMail({ from: SMTP_FROM.value(), to: user.email, subject: title, text: `${m.body}\n\n${link}` })
        .then(() => void (out.email = true))
        .catch((e) => logger.warn('email failed', e)),
    )
  }
  await Promise.all(jobs)
  return out
}

// ---------- handlers ----------

type Ctx = { req: Request; p: Principal; params: string[] }
type Handler = (c: Ctx) => Promise<unknown>

const toJson = (v: unknown): unknown => {
  if (v instanceof Timestamp) return v.toDate().toISOString()
  if (Array.isArray(v)) return v.map(toJson)
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toJson(x)]))
  return v
}
const serialize = (id: string, d: Record<string, unknown>) => ({ id, ...(toJson(d) as Record<string, unknown>) })

const whoami: Handler = async ({ p }) => {
  if (p.kind === 'human') return { kind: 'human', uid: p.uid, email: p.email }
  const scopes = p.scopes.includes('*')
    ? (await db.collection('scopes').where('ownerUid', '==', p.uid).get()).docs.map((d) => ({ id: d.id, name: d.get('name') }))
    : (await Promise.all(p.scopes.map(scopeById))).filter(Boolean).map((s) => ({ id: s!.id, name: s!.name }))
  return { kind: 'agent', uid: p.uid, name: p.name, allScopes: p.scopes.includes('*'), scopes, channels: p.channels ?? ['*'] }
}

const listScopes: Handler = async ({ p }) => {
  const q = await db.collection('scopes').where('ownerUid', '==', p.uid).orderBy('name').get()
  const visible = q.docs.filter((d) => p.kind === 'human' || p.scopes.includes('*') || p.scopes.includes(d.id))
  return visible.map((d) => serialize(d.id, d.data()))
}

const createScope: Handler = async ({ req, p }) => {
  requireHuman(p)
  const name = String(req.body?.name ?? '')
  if (!SCOPE_RE.test(name)) throw new HttpError(400, 'invalid scope name (a-z0-9._-, max 64)')
  const ref = db.doc(`scopes/${scopeId(p.uid, name)}`)
  try {
    await ref.create({ name, ownerUid: p.uid, createdAt: FieldValue.serverTimestamp() })
  } catch (e) {
    if ((e as { code?: number }).code === 6) throw new HttpError(409, 'scope already exists')
    throw e
  }
  return { id: ref.id, name, ownerUid: p.uid }
}

const deleteScope: Handler = async ({ p, params }) => {
  requireHuman(p)
  if (!ID_RE.test(params[0]!)) throw new HttpError(400, 'invalid scope id')
  const ref = db.doc(`scopes/${params[0]}`)
  const snap = await ref.get()
  if (!snap.exists || snap.get('ownerUid') !== p.uid) throw new HttpError(404, 'scope not found')
  await db.recursiveDelete(ref)
  return { ok: true }
}

const listChannels: Handler = async ({ req, p }) => {
  const scope = await resolveScope(req, p)
  const q = await db.collection(`scopes/${scope.id}/channels`).orderBy('lastMessageAt', 'desc').get()
  return q.docs.filter((d) => p.kind === 'human' || channelAllowed(p.channels, d.id)).map((d) => serialize(d.id, d.data()))
}

/** Agents active in this scope: tokens used within the last 10 minutes. */
const listAgents: Handler = async ({ req, p }) => {
  const scope = await resolveScope(req, p)
  const q = await db.collection('tokens').where('uid', '==', scope.ownerUid).get()
  const since = Date.now() - ACTIVE_WINDOW_MS
  return q.docs
    .filter((d) => (d.get('scopes') as string[]).includes('*') || (d.get('scopes') as string[]).includes(scope.id))
    .map((d) => ({ name: d.get('name'), prefix: d.get('prefix'), lastUsedAt: toJson(d.get('lastUsedAt')), active: ((d.get('lastUsedAt') as Timestamp | null)?.toMillis() ?? 0) > since }))
}

const consumerRef = (scope: Scope, consumer: string, channel: string) => db.doc(`scopes/${scope.id}/consumers/${channel}|${consumer}`) // '|' is legal in neither name

/** Consumer name from a query/body value: undefined = none, '' or 'me' = this token/user, else validated name. */
function consumerOf(raw: unknown, p: Principal): string | undefined {
  if (raw === undefined) return undefined
  const c = String(raw)
  if (c === '' || c === 'me') return p.kind === 'agent' ? `token:${p.hash.slice(0, 12)}` : `user:${p.uid}`
  if (!CONSUMER_RE.test(c)) throw new HttpError(400, 'invalid consumer (1–64 chars: letters, digits, . _ : -)')
  return c
}

const listMessages: Handler = async ({ req, p }) => {
  const scope = await resolveScope(req, p)
  const channel = String(req.query.channel ?? '')
  requireChannel(p, channel)
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200)
  let q: Query = db.collection(`scopes/${scope.id}/messages`).where('channel', '==', channel)
  if (req.query.kind) q = q.where('kind', '==', String(req.query.kind))
  if (req.query.status) q = q.where('status', '==', String(req.query.status))
  if (req.query.thread) {
    if (!THREAD_RE.test(String(req.query.thread))) throw new HttpError(400, 'invalid thread')
    q = q.where('thread', '==', String(req.query.thread))
  }
  q = q.orderBy(FieldPath.documentId(), 'asc')
  let after = req.query.after === undefined ? undefined : String(req.query.after)
  const consumer = consumerOf(req.query.consumer, p)
  if (after === undefined && consumer) after = (await consumerRef(scope, consumer, channel).get()).get('lastId')
  if (after) {
    if (!ULID_RE.test(after)) throw new HttpError(400, 'after must be a message id')
    q = q.startAfter(after) // a deleted anchor is fine: documentId cursors are values, not snapshots
  }
  const snap = await q.endBefore(ulidAt(Date.now() - SETTLE_MS)).limit(limit).get()
  const out = snap.docs.map((d) => serialize(d.id, d.data()))
  // A thread named after a message id includes that root message, even though the root itself carries no `thread`.
  const thread = String(req.query.thread ?? '')
  if (thread && ULID_RE.test(thread) && !after && !out.some((m) => m.id === thread)) {
    const root = await db.doc(`scopes/${scope.id}/messages/${thread}`).get()
    if (root.exists && root.get('channel') === channel) out.unshift(serialize(root.id, root.data()!))
  }
  return out
}

/** Advances a durable, channel-scoped consumer cursor. Never moves backwards. */
const ackMessages: Handler = async ({ req, p, params }) => {
  const scope = await resolveScope(req, p)
  const channel = params[0]!
  requireChannel(p, channel)
  const lastId = String(req.body?.lastId ?? '')
  if (!ULID_RE.test(lastId)) throw new HttpError(400, 'lastId must be a message id')
  if (lastId > ulidAt(Date.now() + 5000)) throw new HttpError(400, 'lastId is in the future')
  const consumer = consumerOf(req.body?.consumer ?? 'me', p)!
  const ref = consumerRef(scope, consumer, channel)
  await db.runTransaction(async (tx) => {
    const cur = (await tx.get(ref)).get('lastId') as string | undefined
    if (cur && cur >= lastId) return
    tx.set(ref, { consumer, channel, lastId, ownerUid: scope.ownerUid, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
  })
  return { consumer, channel, lastId }
}

/**
 * What an agent should look at: its questions resolved (answered/cancelled) after the consumer's watermark, and unread
 * counts per channel. Read-only unless `ack=1`, which moves the watermark to the newest resolution returned — so a status
 * line or the MCP indicator never consumes what the inbox has not delivered yet.
 */
const pending: Handler = async ({ req, p }) => {
  const scope = await resolveScope(req, p)
  const consumer = consumerOf(req.query.consumer ?? 'me', p)!
  const channels = String(req.query.channels ?? '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 10)
  for (const c of channels) requireChannel(p, c)
  const metaRef = db.doc(`scopes/${scope.id}/consumers/_${consumer}`)
  const since = ((await metaRef.get()).get('lastPendingAt') as Timestamp | undefined) ?? Timestamp.fromMillis(0)
  const settle = ulidAt(Date.now() - SETTLE_MS)
  const from = p.kind === 'agent' ? p.name : p.email
  const [resolved, ...counts] = await Promise.all([
    db.collection(`scopes/${scope.id}/messages`).where('from', '==', from).where('kind', '==', 'question').where('resolvedAt', '>', since).orderBy('resolvedAt', 'asc').limit(50).get(),
    ...channels.map(async (c) => {
      const lastId = (await consumerRef(scope, consumer, c).get()).get('lastId') as string | undefined
      let q: Query = db.collection(`scopes/${scope.id}/messages`).where('channel', '==', c).orderBy(FieldPath.documentId(), 'asc')
      if (lastId) q = q.startAfter(lastId)
      return (await q.endBefore(settle).count().get()).data().count
    }),
  ])
  const answered = resolved.docs.filter((d) => p.kind === 'human' || channelAllowed(p.channels, d.get('channel'))).map((d) => serialize(d.id, d.data()))
  if (req.query.ack === '1' && resolved.size) {
    const newest = resolved.docs[resolved.size - 1]!.get('resolvedAt') as Timestamp
    await metaRef.set({ lastPendingAt: newest, ownerUid: scope.ownerUid }, { merge: true })
  }
  return { answered, unread: Object.fromEntries(channels.map((c, i) => [c, counts[i]])) }
}

const createMessage: Handler = async ({ req, p }) => {
  const scope = await resolveScope(req, p)
  const m = parseNewMessage({ ...req.body, idempotencyKey: req.body?.idempotencyKey ?? req.get('idempotency-key') })
  requireChannel(p, m.channel)
  const rateKey = p.kind === 'agent' ? p.hash : p.uid
  rateLimit(rateKey, RATE_LIMIT_PER_MIN, 'writes')
  if (m.kind === 'question') rateLimit(`${rateKey}:q`, QUESTION_LIMIT_PER_MIN, 'questions')
  const from = p.kind === 'agent' ? p.name : p.email
  const messages = db.collection(`scopes/${scope.id}/messages`)

  // Idempotent retries: same (scope, sender, key, channel) → the earlier message while it is still an open question
  // (never a resolved one: a re-ask must not replay an old approval) or, for events/notices, younger than 24 h.
  const keyRef = m.idempotencyKey ? db.doc(`scopes/${scope.id}/keys/${sha256(`${from}|${m.idempotencyKey}`)}`) : null
  const replay = async (): Promise<Record<string, unknown> | null> => {
    const prior = (await keyRef!.get()).get('messageId') as string | undefined
    if (!prior) return null
    const existing = await messages.doc(prior).get()
    if (!existing.exists) return null
    const d = existing.data()!
    if (d.channel !== m.channel) return null
    const fresh = d.kind === 'question' ? d.status === 'open' : Date.now() - d.createdAt.toMillis() < DEDUPE_WINDOW_MS
    return fresh ? { ...serialize(existing.id, d), deduplicated: true } : null
  }
  if (keyRef) {
    const r = await replay()
    if (r) return r
  }

  const id = ulid()
  const now = new Date()
  const doc: Record<string, unknown> = {
    ownerUid: scope.ownerUid,
    channel: m.channel,
    kind: m.kind,
    from,
    body: m.body,
    createdAt: Timestamp.fromDate(now),
    expiresAt: Timestamp.fromMillis(now.getTime() + RETENTION_DAYS * 86_400_000),
  }
  for (const k of ['data', 'replyTo', 'thread', 'priority', 'tag'] as const) if (m[k] !== undefined) doc[k] = m[k]
  if (m.question) {
    doc.question = m.question
    doc.status = 'open'
  }
  const batch = db.batch()
  batch.set(messages.doc(id), doc)
  batch.set(
    db.doc(`scopes/${scope.id}/channels/${m.channel}`),
    { name: m.channel, ownerUid: scope.ownerUid, lastMessageAt: doc.createdAt, last: { id, kind: m.kind, from, body: m.body.slice(0, 200) } },
    { merge: true },
  )
  if (keyRef) {
    // Reserve the key atomically with the message; a concurrent identical request loses the race and replays.
    const prior = await keyRef.get()
    if (prior.exists) batch.update(keyRef, { messageId: id, createdAt: doc.createdAt }) // stale key from a resolved/expired message
    else batch.create(keyRef, { messageId: id, createdAt: doc.createdAt })
  }
  try {
    await batch.commit()
  } catch (e) {
    if (keyRef && (e as { code?: number }).code === 6) {
      const r = await replay()
      if (r) return r
    }
    throw e
  }
  if (m.kind !== 'event') {
    const delivery = await notifyOwner(scope, id, { ...m, from }).catch((e) => (logger.warn('notify failed', e), { push: 0, email: false }))
    doc.delivery = { ...delivery, at: Timestamp.now() }
    await messages.doc(id).update({ delivery: doc.delivery }).catch(() => {})
  }
  return serialize(id, doc)
}

async function messageRef(req: Request, p: Principal, id: string): Promise<DocumentReference> {
  const scope = await resolveScope(req, p)
  if (!ULID_RE.test(id)) throw new HttpError(400, 'invalid message id')
  return db.doc(`scopes/${scope.id}/messages/${id}`)
}

const getMessage: Handler = async ({ req, p, params }) => {
  const snap = await (await messageRef(req, p, params[0]!)).get()
  if (!snap.exists) throw new HttpError(404, 'message not found')
  requireChannel(p, snap.get('channel'))
  return serialize(snap.id, snap.data()!)
}

const answerMessage: Handler = async ({ req, p, params }) => {
  requireHuman(p)
  const ref = await messageRef(req, p, params[0]!)
  const via = clientOf(req)
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists) throw new HttpError(404, 'message not found')
    const d = snap.data()!
    if (d.kind !== 'question') throw new HttpError(400, 'not a question')
    if (d.status !== 'open') throw new HttpError(409, `question is already ${d.status}`)
    const value = parseAnswer(d.question as Question, req.body?.value)
    const answer = { value, by: p.email, at: Timestamp.now(), via }
    tx.update(ref, { status: 'answered', answer, resolvedAt: answer.at })
    return serialize(snap.id, { ...d, status: 'answered', answer })
  })
}

/** Cancels an open question. `reason` keeps "nobody answered in time" (expired) distinct from "no longer needed" (agent cancel). */
const cancelMessage: Handler = async ({ req, p, params }) => {
  const ref = await messageRef(req, p, params[0]!)
  const reason = ['expired', 'superseded', 'cancelled'].includes(String(req.body?.reason)) ? String(req.body.reason) : 'cancelled'
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists) throw new HttpError(404, 'message not found')
    requireChannel(p, snap.get('channel'))
    if (snap.get('kind') !== 'question') throw new HttpError(400, 'not a question')
    if (snap.get('status') !== 'open') throw new HttpError(409, `question is already ${snap.get('status')}`)
    const now = Timestamp.now()
    tx.update(ref, { status: 'cancelled', cancelReason: reason, cancelledAt: now, resolvedAt: now, cancelledBy: p.kind === 'agent' ? p.name : p.email })
  })
  return { id: params[0], status: 'cancelled', cancelReason: reason }
}

const listTokens: Handler = async ({ p }) => {
  requireHuman(p)
  const q = await db.collection('tokens').where('uid', '==', p.uid).get()
  return q.docs.map((d) => serialize(d.id, d.data()))
}

const createToken: Handler = async ({ req, p }) => {
  requireHuman(p)
  const name = String(req.body?.name ?? '').trim().slice(0, 64)
  if (!name) throw new HttpError(400, 'name is required')
  const requested: string[] = Array.isArray(req.body?.scopes) ? req.body.scopes.map(String) : []
  if (!requested.length) throw new HttpError(400, 'scopes is required: ["*"] or scope ids')
  if (requested.some((id) => id !== '*' && !ID_RE.test(id))) throw new HttpError(400, 'invalid scope id')
  let scopes: string[]
  if (requested.includes('*')) scopes = ['*']
  else {
    const found = await Promise.all(requested.map(scopeById))
    if (found.some((s) => !s || s.ownerUid !== p.uid)) throw new HttpError(403, 'unknown scope id')
    scopes = requested
  }
  const channels: string[] = Array.isArray(req.body?.channels) ? req.body.channels.map(String) : []
  if (channels.length > 20 || channels.some((c) => !CHANNEL_PATTERN_RE.test(c))) throw new HttpError(400, 'invalid channels policy (patterns like build, build*, *)')
  const t = newToken()
  const data: Record<string, unknown> = { uid: p.uid, name, prefix: t.prefix, scopes, createdAt: FieldValue.serverTimestamp(), lastUsedAt: null }
  if (channels.length && !channels.includes('*')) data.channels = channels
  await db.doc(`tokens/${t.hash}`).set(data)
  return { id: t.hash, token: t.token, name, prefix: t.prefix, scopes, channels: data.channels ?? ['*'] }
}

const deleteToken: Handler = async ({ p, params }) => {
  requireHuman(p)
  if (!ID_RE.test(params[0]!)) throw new HttpError(400, 'invalid token id')
  const ref = db.doc(`tokens/${params[0]}`)
  const snap = await ref.get()
  if (!snap.exists || snap.get('uid') !== p.uid) throw new HttpError(404, 'token not found')
  await ref.delete()
  return { ok: true }
}

// ---------- router ----------

const routes: [string, RegExp, Handler][] = [
  ['GET', /^\/whoami$/, whoami],
  ['GET', /^\/scopes$/, listScopes],
  ['POST', /^\/scopes$/, createScope],
  ['DELETE', /^\/scopes\/([^/]+)$/, deleteScope],
  ['GET', /^\/channels$/, listChannels],
  ['GET', /^\/agents$/, listAgents],
  ['GET', /^\/messages$/, listMessages],
  ['POST', /^\/messages$/, createMessage],
  ['GET', /^\/messages\/([^/]+)$/, getMessage],
  ['POST', /^\/messages\/([^/]+)\/answer$/, answerMessage],
  ['POST', /^\/messages\/([^/]+)\/cancel$/, cancelMessage],
  ['POST', /^\/consumers\/([^/]+)\/ack$/, ackMessages],
  ['GET', /^\/pending$/, pending],
  ['GET', /^\/tokens$/, listTokens],
  ['POST', /^\/tokens$/, createToken],
  ['DELETE', /^\/tokens\/([^/]+)$/, deleteToken],
]

export const api = onRequest({ cors: true }, async (req: Request, res: Response) => {
  // Path arrives as /api/v1/... via Hosting rewrite or /v1/... when called directly.
  const path = req.path.replace(/^\/api/, '').replace(/^\/v1/, '').replace(/\/+$/, '') || '/'
  try {
    const route = routes.find(([m, re]) => m === req.method && re.test(path))
    if (!route) throw new HttpError(404, `no route ${req.method} ${path}`)
    const p = await authenticate(req)
    let params: string[]
    try {
      params = path.match(route[1])!.slice(1).map(decodeURIComponent)
    } catch {
      throw new HttpError(400, 'malformed path')
    }
    res.json(await route[2]({ req, p, params }))
  } catch (e) {
    if (e instanceof HttpError) res.status(e.status).json({ error: e.message })
    else {
      logger.error(e)
      res.status(500).json({ error: 'internal error' })
    }
  }
})

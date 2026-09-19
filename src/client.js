// @ts-check
import { createHash } from 'node:crypto'
import { settings } from './config.js'

/** Stable, bounded ASCII idempotency key for a logical request. @param {string} kind @param {unknown[]} parts */
export function keyFor(kind, ...parts) {
  return `${kind}:${createHash('sha256').update(JSON.stringify(parts)).digest('base64url').slice(0, 24)}`
}

/**
 * @typedef {{ id: string, channel: string, kind: 'event'|'notice'|'question', from: string, body: string, data?: string,
 *   question?: { type: 'confirm'|'choice'|'text', options?: string[] }, status?: 'open'|'answered'|'cancelled',
 *   answer?: { value: string|boolean, by: string, at: string, via?: string }, createdAt: string,
 *   replyTo?: string, thread?: string, priority?: 'urgent'|'normal'|'low', tag?: string, deduplicated?: boolean,
 *   cancelReason?: 'cancelled'|'expired'|'superseded', resolvedAt?: string,
 *   delivery?: { push: number, email: boolean, at: string } }} Message
 * @typedef {{ data?: unknown, replyTo?: string, thread?: string, priority?: 'urgent'|'normal'|'low', tag?: string, key?: string }} SendOpts
 */

export class ApiError extends Error {
  /** @param {number} status @param {string} message */
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

export class Client {
  /** @param {{ scope?: string, apiUrl?: string, token?: string, client?: string }} [flags] */
  constructor(flags = {}) {
    const s = settings(flags)
    if (!s.apiUrl) throw new Error('no hub configured: run `aconn login --api-url https://<your-hub>/api` (or set AC_API_URL)')
    if (!s.token) throw new Error(`not logged in to ${s.apiUrl}: run \`aconn login --api-url ${s.apiUrl}\` or set AC_TOKEN`)
    this.token = s.token
    this.scope = s.scope
    this.apiUrl = s.apiUrl
    this.subscribe = s.subscribe
    this.client = flags.client ?? 'cli'
  }

  /** @param {string} method @param {string} path @param {unknown} [body] @returns {Promise<any>} */
  async call(method, path, body) {
    /** @type {Record<string,string>} */
    const headers = { authorization: `Bearer ${this.token}`, 'x-client': this.client }
    if (this.scope) headers['x-scope'] = this.scope
    if (body !== undefined) headers['content-type'] = 'application/json'
    const res = await fetch(`${this.apiUrl}/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
    const text = await res.text()
    /** @type {any} */
    let json
    try {
      json = JSON.parse(text)
    } catch {
      json = { error: text.slice(0, 200) }
    }
    if (!res.ok) throw new ApiError(res.status, `${res.status} ${json.error ?? res.statusText}`)
    return json
  }

  whoami() { return this.call('GET', '/whoami') }
  scopes() { return this.call('GET', '/scopes') }
  channels() { return this.call('GET', '/channels') }
  agents() { return this.call('GET', '/agents') }

  /** @param {'event'|'notice'|'question'} kind @param {string} channel @param {string} body @param {SendOpts & { question?: { type: 'confirm'|'choice'|'text', options?: string[] } }} [o] @returns {Promise<Message>} */
  post(kind, channel, body, o = {}) {
    const { key, ...rest } = o
    return this.call('POST', '/messages', { channel, kind, body, ...rest, idempotencyKey: key })
  }
  /** @param {string} channel @param {string} body @param {SendOpts} [o] @returns {Promise<Message>} */
  send(channel, body, o) { return this.post('event', channel, body, o) }
  /** @param {string} channel @param {string} body @param {SendOpts} [o] @returns {Promise<Message>} */
  notify(channel, body, o) { return this.post('notice', channel, body, o) }
  /** @param {string} channel @param {string} body @param {{ type: 'confirm'|'choice'|'text', options?: string[] }} question @param {SendOpts} [o] @returns {Promise<Message>} */
  ask(channel, body, question, o) { return this.post('question', channel, body, { ...o, question }) }
  /** Replies in the original's thread (or starts one named after it). @param {string} id @param {string} body @param {SendOpts & { kind?: 'event'|'notice' }} [o] @returns {Promise<Message>} */
  async reply(id, body, o = {}) {
    const orig = await this.get(id)
    const { kind = 'event', ...rest } = o
    return this.post(kind, orig.channel, body, { ...rest, replyTo: id, thread: rest.thread ?? orig.thread ?? id })
  }

  /** @param {{ channel: string, after?: string, limit?: number, kind?: string, status?: string, thread?: string, consumer?: string }} q @returns {Promise<Message[]>} */
  list(q) {
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== '') params.set(k, String(v))
    return this.call('GET', `/messages?${params}`)
  }
  /** @param {string} channel @param {string} lastId @param {string} [consumer] */
  ack(channel, lastId, consumer = 'me') { return this.call('POST', `/consumers/${channel}/ack`, { lastId, consumer }) }
  /**
   * Answers to this sender's questions since the watermark plus unread counts. Read-only unless `ack`, which moves the
   * watermark past the returned answers (use it only when you actually deliver them).
   * @param {string[]} channels @param {{ consumer?: string, ack?: boolean }} [o] @returns {Promise<{ answered: Message[], unread: Record<string, number> }>}
   */
  pending(channels, o = {}) {
    const params = new URLSearchParams({ consumer: o.consumer ?? 'me' })
    if (channels.length) params.set('channels', channels.join(','))
    if (o.ack) params.set('ack', '1')
    return this.call('GET', `/pending?${params}`)
  }
  /** @param {string} id @returns {Promise<Message>} */
  get(id) { return this.call('GET', `/messages/${id}`) }
  /** @param {string} id @param {'cancelled'|'expired'|'superseded'} [reason] */
  cancel(id, reason) { return this.call('POST', `/messages/${id}/cancel`, reason ? { reason } : undefined) }

  /**
   * Polls until the question is answered/cancelled or timeout. Returns the final message.
   * @param {string} id @param {{ timeoutMs?: number, signal?: AbortSignal }} [o] @returns {Promise<Message>}
   */
  async waitAnswer(id, o = {}) {
    const deadline = Date.now() + (o.timeoutMs ?? 5 * 60_000)
    let delay = 2000
    for (;;) {
      const m = await retrying(() => this.get(id))
      if (m.status !== 'open') return m
      if (Date.now() >= deadline) throw new ApiError(408, `no answer yet for ${id}`)
      await sleep(Math.min(delay, deadline - Date.now()), o.signal)
      delay = Math.min(delay * 1.5, 15_000) // ponytail: backoff caps at 15s; long-poll if latency matters.
    }
  }
}

/** True for errors worth retrying: network failures, 429, 5xx. @param {unknown} e */
export function isTransient(e) {
  return e instanceof ApiError ? e.status === 429 || e.status >= 500 : e instanceof TypeError
}

/** Retries a call on transient errors with backoff (up to ~2 minutes). @template T @param {() => Promise<T>} fn @returns {Promise<T>} */
export async function retrying(fn) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (e) {
      if (!isTransient(e) || attempt >= 8) throw e
      await sleep(Math.min(1000 * 2 ** attempt, 30_000))
    }
  }
}

/** @param {number} ms @param {AbortSignal} [signal] */
export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => (clearTimeout(t), reject(new Error('aborted'))), { once: true })
  })
}

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ulid, ulidAt, parseNewMessage, parseAnswer, newToken, sha256, channelAllowed } from './util.ts'

test('ulid sorts by time', () => {
  const a = ulid(1000), b = ulid(2000)
  assert.equal(a.length, 26)
  assert.ok(a < b)
})

test('parseNewMessage validates', () => {
  assert.deepEqual(parseNewMessage({ channel: 'build', body: 'hi' }), { channel: 'build', kind: 'event', body: 'hi' })
  assert.throws(() => parseNewMessage({ channel: 'Bad Name', body: 'x' }), /invalid channel/)
  assert.throws(() => parseNewMessage({ channel: 'c', kind: 'question', body: 'q', question: { type: 'choice', options: ['a'] } }), /2–20/)
  const q = parseNewMessage({ channel: 'c', kind: 'question', body: 'q', question: { type: 'choice', options: ['a', 'b'] }, data: { x: [1] } })
  assert.equal(q.data, '{"x":[1]}')
  assert.deepEqual(q.question, { type: 'choice', options: ['a', 'b'] })
})

test('parseAnswer', () => {
  assert.equal(parseAnswer({ type: 'confirm' }, 'yes'), true)
  assert.equal(parseAnswer({ type: 'confirm' }, false), false)
  assert.throws(() => parseAnswer({ type: 'confirm' }, 'maybe'))
  assert.equal(parseAnswer({ type: 'choice', options: ['a', 'b'] }, 'b'), 'b')
  assert.throws(() => parseAnswer({ type: 'choice', options: ['a', 'b'] }, 'c'))
  assert.equal(parseAnswer({ type: 'text' }, ' ok '), ' ok ')
})

test('token hash', () => {
  const t = newToken()
  assert.ok(t.token.startsWith('ac_'))
  assert.equal(t.hash, sha256(t.token))
  assert.equal(t.prefix, t.token.slice(0, 10))
})

test('ulidAt sorts before ids minted at the same ms', () => {
  assert.ok(ulidAt(5000) < ulid(5000))
  assert.ok(ulidAt(5000) > ulid(4999))
})

test('envelope fields validate', () => {
  const m = parseNewMessage({ channel: 'c', body: 'x', replyTo: ulid(), thread: 'rel/v42', priority: 'urgent', tag: 'status', idempotencyKey: 'k-1' })
  assert.equal(m.priority, 'urgent'); assert.equal(m.thread, 'rel/v42'); assert.equal(m.tag, 'status'); assert.equal(m.idempotencyKey, 'k-1')
  assert.equal(parseNewMessage({ channel: 'c', body: 'x', priority: 'normal' }).priority, undefined)
  assert.throws(() => parseNewMessage({ channel: 'c', body: 'x', priority: 'high' }), /priority/)
  assert.throws(() => parseNewMessage({ channel: 'c', body: 'x', replyTo: 'nope' }), /replyTo/)
  assert.throws(() => parseNewMessage({ channel: 'c', body: 'x', tag: 'Bad Tag' }), /tag/)
})

test('channel policy', () => {
  assert.ok(channelAllowed(undefined, 'x')); assert.ok(channelAllowed(['*'], 'x'))
  assert.ok(channelAllowed(['build*'], 'build-42')); assert.ok(!channelAllowed(['build*'], 'deploy'))
  assert.ok(channelAllowed(['deploy', 'ops'], 'ops')); assert.ok(!channelAllowed(['deploy'], 'ops'))
})

// @ts-check
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'ac-test-'))
process.env.AC_CONFIG_DIR = dir
delete process.env.AC_TOKEN
delete process.env.AC_SCOPE
delete process.env.AC_API_URL
const { settings, saveToken, getCursor, setCursor } = await import('./config.js')
const DEFAULT_API_URL = 'https://hub.example/api'
const { format } = await import('./cli.js')

test('tokens are bound to the hub they were issued for', () => {
  saveToken('https://other.example/api', 'ac_other')
  saveToken(DEFAULT_API_URL, 'ac_default')
  assert.equal(settings().apiUrl, DEFAULT_API_URL) // last login is the default hub
  assert.equal(settings().token, 'ac_default')
  assert.equal(settings({ apiUrl: 'https://other.example/api/' }).token, 'ac_other')
  // a project file pointing elsewhere gets no token unless the user logged in there
  const repo = join(dir, 'repo'); mkdirSync(repo)
  writeFileSync(join(repo, '.agents-connect.json'), JSON.stringify({ scope: 'x', apiUrl: 'https://evil.example/api' }))
  const cwd = process.cwd(); process.chdir(repo)
  try {
    const s = settings()
    assert.equal(s.scope, 'x'); assert.equal(s.apiUrl, 'https://evil.example/api'); assert.equal(s.token, undefined)
  } finally { process.chdir(cwd) }
  saveToken('https://other.example/api', undefined)
  assert.equal(settings({ apiUrl: 'https://other.example/api' }).token, undefined)
})

test('flags beat env beat files', () => {
  process.env.AC_SCOPE = 'from-env'
  assert.equal(settings().scope, 'from-env')
  assert.equal(settings({ scope: 'flag' }).scope, 'flag')
  delete process.env.AC_SCOPE
})

test('cursors are per key', () => {
  setCursor('a|b|c', '01A'); setCursor('a|b|d', '01B')
  assert.equal(getCursor('a|b|c'), '01A'); assert.equal(getCursor('a|b|d'), '01B'); assert.equal(getCursor('nope'), undefined)
})

test('format renders questions with answers', () => {
  const line = format({ id: 'X', kind: 'question', from: 'bot', body: 'Ship?', createdAt: '2026-09-19T13:00:00.000Z', question: { type: 'choice', options: ['a', 'b'] }, status: 'answered', answer: { value: 'a', by: 'me', at: '' } })
  assert.match(line, /X 13:00:00 \[question\] bot: Ship\? \(a \| b\)\n  → answered by me: a/)
  assert.equal(format([{ name: 'ops', lastMessageAt: 't', last: { kind: 'event', from: 'x', body: 'y' } }]), 'ops\tt\t[event] x: y')
})

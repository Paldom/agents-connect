// @ts-check
import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync, renameSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { createHash } from 'node:crypto'

const CONFIG_DIR = process.env.AC_CONFIG_DIR ?? join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'agents-connect')
const CONFIG_FILE = join(CONFIG_DIR, 'config.json')
const CURSOR_DIR = join(CONFIG_DIR, 'cursors')
export const PROJECT_FILE = '.agents-connect.json'

/** @param {string} file */
function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return {}
  }
}

/** Atomic write (temp + rename) so concurrent processes never see a torn file. @param {string} file @param {unknown} data */
function writeJson(file, data) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 })
  chmodSync(tmp, 0o600)
  renameSync(tmp, file)
}

/** Global config: `{ apiUrl?: string, tokens: { [apiUrl]: token } }`. @returns {{ apiUrl?: string, tokens?: Record<string,string> }} */
export function readGlobal() {
  return readJson(CONFIG_FILE)
}

/** Tokens are stored per API host so a project file can never redirect a saved token to another server. The last hub logged into becomes the default. */
export function saveToken(/** @type {string} */ apiUrl, /** @type {string|undefined} */ token) {
  const g = readGlobal()
  const tokens = { ...(g.tokens ?? {}) }
  if (token) tokens[apiUrl] = token
  else delete tokens[apiUrl]
  writeJson(CONFIG_FILE, { ...g, apiUrl: token ? apiUrl : g.apiUrl, tokens })
  return CONFIG_FILE
}

/** Finds .agents-connect.json walking up from cwd. @returns {{ scope?: string, apiUrl?: string, subscribe?: string[], file?: string }} */
export function readProject(cwd = process.cwd()) {
  let dir = resolve(cwd)
  for (;;) {
    const f = join(dir, PROJECT_FILE)
    if (existsSync(f)) return { ...readJson(f), file: f }
    const parent = dirname(dir)
    if (parent === dir) return {}
    dir = parent
  }
}

/** @param {{ scope: string, apiUrl?: string, subscribe?: string[] }} data */
export function writeProject(data, cwd = process.cwd()) {
  const f = join(cwd, PROJECT_FILE)
  writeFileSync(f, JSON.stringify(data, null, 2) + '\n')
  return f
}

/** Effective settings: flags > env > project file > global file. @param {{ scope?: string, apiUrl?: string, token?: string }} flags */
export function settings(flags = {}) {
  const g = readGlobal()
  const p = readProject()
  const explicitToken = flags.token ?? process.env.AC_TOKEN
  // An explicit token (flag/env) is never sent to a hub named only by a repo's project file: that file is untrusted input.
  const raw = flags.apiUrl ?? process.env.AC_API_URL ?? (explicitToken ? g.apiUrl : p.apiUrl ?? g.apiUrl)
  const apiUrl = raw ? normalizeUrl(raw) : undefined
  return {
    token: explicitToken ?? (apiUrl ? g.tokens?.[apiUrl] : undefined),
    scope: flags.scope ?? process.env.AC_SCOPE ?? p.scope,
    apiUrl,
    subscribe: p.subscribe ?? [],
    projectFile: p.file,
  }
}

export function normalizeUrl(/** @type {string} */ u) {
  return u.replace(/\/+$/, '')
}

/** Cursor per api/scope/channel so `aconn read <channel>` resumes. One file per key: concurrent readers never clobber each other. */
const cursorFile = (/** @type {string} */ key) => join(CURSOR_DIR, createHash('sha1').update(key).digest('hex') + '.json')
export function getCursor(/** @type {string} */ key) {
  return /** @type {{ id?: string }} */ (readJson(cursorFile(key))).id
}
export function setCursor(/** @type {string} */ key, /** @type {string} */ id) {
  writeJson(cursorFile(key), { key, id })
}

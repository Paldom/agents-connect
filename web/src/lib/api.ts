import { useCallback, useState, useSyncExternalStore } from 'react'
import { toast } from 'sonner'
import { auth } from './firebase'

const BASE = (import.meta.env.VITE_API_URL ?? '/api').replace(/\/+$/, '')

// In-flight request counter for the global progress bar. ponytail: a module-level number + listeners is all this needs.
let inflight = 0
const listeners = new Set<() => void>()
const setInflight = (n: number) => {
  inflight = n
  listeners.forEach((l) => l())
}
/** Number of hub API requests currently in flight (0 = idle). */
export function useApiBusy() {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => void listeners.delete(l)),
    () => inflight,
    () => 0,
  )
}

/** Calls the hub API with the current user's ID token. `scope` sets X-Scope (scope name). */
export async function api<T = unknown>(method: string, path: string, body?: unknown, scope?: string): Promise<T> {
  setInflight(inflight + 1)
  try {
    const token = await auth.currentUser?.getIdToken()
    if (!token) throw new Error('not signed in')
    const headers: Record<string, string> = { authorization: `Bearer ${token}`, 'x-client': 'web' }
    if (scope) headers['x-scope'] = scope
    if (body !== undefined) headers['content-type'] = 'application/json'
    const res = await fetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
    const json = (await res.json().catch(() => ({}))) as { error?: string }
    if (!res.ok) throw new Error(json.error ?? res.statusText)
    return json as T
  } finally {
    setInflight(inflight - 1)
  }
}

/** Runs an async action and toasts the error. Returns true on success. */
export async function tryApi(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn()
    return true
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e))
    return false
  }
}

/**
 * Re-entrancy guard for a component's mutating actions: `run` ignores calls while one is pending (so a double click
 * can never send twice), toasts errors, and reports `busy` for disabling buttons. `key` lets a list mark one row busy.
 */
export function useAction() {
  const [busy, setBusy] = useState<string | boolean>(false)
  const run = useCallback(
    async (fn: () => Promise<unknown>, key: string | true = true) => {
      if (busy) return false
      setBusy(key)
      try {
        return await tryApi(fn)
      } finally {
        setBusy(false)
      }
    },
    [busy],
  )
  return { busy, run }
}

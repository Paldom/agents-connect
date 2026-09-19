import {
  collection,
  collectionGroup,
  doc,
  documentId,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
  type DocumentData,
  type Query,
  type QueryDocumentSnapshot,
  Timestamp,
} from 'firebase/firestore'
import { useEffect, useState, type DependencyList } from 'react'
import { toast } from 'sonner'
import { db } from './firebase'
import type { Channel, Message, Scope } from './types'

export interface UserPrefs {
  emailNotifications?: boolean
  fcmTokens?: string[]
  mute?: Record<string, Timestamp>
}

/** Realtime collection subscription. `make` returns null to skip. */
export function useCollection<T>(
  make: () => Query | null,
  map: (d: QueryDocumentSnapshot<DocumentData>) => T,
  deps: DependencyList,
) {
  const [items, setItems] = useState<T[]>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    const q = make()
    setItems([]) // never show the previous user's or query's rows
    if (!q) return void setLoading(false)
    setLoading(true)
    return onSnapshot(
      q,
      (snap) => {
        setItems(snap.docs.map(map))
        setLoading(false)
      },
      (e) => {
        toast.error(e.message)
        setLoading(false)
      },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return { items, loading }
}

export const toMessage = (d: QueryDocumentSnapshot<DocumentData>): Message =>
  ({ id: d.id, scopeId: d.ref.parent.parent!.id, ...d.data() }) as Message

export function useScopes(uid: string | undefined) {
  return useCollection<Scope>(
    () => (uid ? query(collection(db, 'scopes'), where('ownerUid', '==', uid), orderBy('name')) : null),
    (d) => ({ id: d.id, name: d.get('name') as string }),
    [uid],
  )
}

/** Resolves a scope by name. `undefined` while loading, `null` when not found. */
export function useScope(uid: string | undefined, name: string | undefined) {
  const { items, loading } = useCollection<Scope>(
    () => (uid && name ? query(collection(db, 'scopes'), where('ownerUid', '==', uid), where('name', '==', name), limit(1)) : null),
    (d) => ({ id: d.id, name: d.get('name') as string }),
    [uid, name],
  )
  return loading ? undefined : (items[0] ?? null)
}

export function useChannels(uid: string | undefined, scopeId: string | undefined) {
  return useCollection<Channel>(
    () =>
      uid && scopeId
        ? query(collection(db, 'scopes', scopeId, 'channels'), where('ownerUid', '==', uid), orderBy('lastMessageAt', 'desc'))
        : null,
    (d) => d.data() as Channel,
    [uid, scopeId],
  )
}

export function useMessages(uid: string | undefined, scopeId: string | undefined, channel: string | undefined) {
  return useCollection<Message>(
    () =>
      uid && scopeId && channel
        ? query(
            collection(db, 'scopes', scopeId, 'messages'),
            where('ownerUid', '==', uid),
            where('channel', '==', channel),
            orderBy(documentId(), 'desc'),
            limit(100),
          )
        : null,
    toMessage,
    [uid, scopeId, channel],
  )
}

/** Open questions across every scope the user owns (the "action required" list). */
export function useOpenQuestions(uid: string | undefined) {
  return useCollection<Message>(
    () =>
      uid
        ? query(collectionGroup(db, 'messages'), where('ownerUid', '==', uid), where('status', '==', 'open'), orderBy(documentId(), 'desc'), limit(50))
        : null,
    toMessage,
    [uid],
  )
}

/** Resolved (answered or cancelled) questions across every scope, newest resolution first: the decision history. */
export function useResolvedQuestions(uid: string | undefined, max = 100) {
  return useCollection<Message>(
    () =>
      uid
        ? query(
            collectionGroup(db, 'messages'),
            where('ownerUid', '==', uid),
            where('kind', '==', 'question'),
            where('resolvedAt', '>', Timestamp.fromMillis(0)),
            orderBy('resolvedAt', 'desc'),
            limit(max),
          )
        : null,
    toMessage,
    [uid, max],
  )
}

/** Live view of users/{uid} (notification prefs, device tokens, mutes). */
export function useUserPrefs(uid: string | undefined) {
  const [prefs, setPrefs] = useState<UserPrefs>({})
  useEffect(() => {
    setPrefs({})
    if (!uid) return
    return onSnapshot(doc(db, 'users', uid), (s) => setPrefs((s.data() as UserPrefs | undefined) ?? {}), (e) => toast.error(e.message))
  }, [uid])
  return prefs
}

export const muteKey = (scopeId: string, channel: string) => `${scopeId}/${channel}`
export const isMuted = (prefs: UserPrefs, scopeId: string, channel: string) => {
  const until = prefs.mute?.[muteKey(scopeId, channel)]
  return !!until && until.toMillis() > Date.now()
}

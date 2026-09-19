import { MessageCard } from '@/components/message-card'
import { useAuth } from '@/lib/use-auth'
import { useResolvedQuestions, useScopes } from '@/lib/use-firestore'

/** Audit list of every decision: answered and cancelled questions across all scopes, newest first. */
export function History() {
  const { user } = useAuth()
  const { items: scopes } = useScopes(user?.uid)
  const { items, loading } = useResolvedQuestions(user?.uid, 100)
  const scopeName = new Map(scopes.map((s) => [s.id, s.name]))
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium text-muted-foreground">History · {items.length} decision{items.length === 1 ? '' : 's'}</h2>
      {!loading && items.length === 0 && <p className="text-sm text-muted-foreground">No answered or cancelled questions yet.</p>}
      {items.map((m) => <MessageCard key={m.id} m={m} scopeName={scopeName.get(m.scopeId) ?? ''} showChannel />)}
    </section>
  )
}

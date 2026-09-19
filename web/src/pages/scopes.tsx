import { MoreHorizontalIcon } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { MessageCard } from '@/components/message-card'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { api, useAction } from '@/lib/api'
import { BusyButton } from '@/components/busy-button'
import { useAuth } from '@/lib/use-auth'
import { useOpenQuestions, useResolvedQuestions, useScopes } from '@/lib/use-firestore'

export function Scopes() {
  const { user } = useAuth()
  const uid = user?.uid
  const { items: scopes, loading } = useScopes(uid)
  const { items: inbox } = useOpenQuestions(uid)
  const { items: history } = useResolvedQuestions(uid, 10)
  const [name, setName] = useState('')
  const { busy, run } = useAction()
  const scopeName = new Map(scopes.map((s) => [s.id, s.name]))

  async function create(e: FormEvent) {
    e.preventDefault()
    if (await run(() => api('POST', '/v1/scopes', { name }), 'create')) setName('')
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">Scopes</h2>
        {!loading && scopes.length === 0 && <p className="text-sm text-muted-foreground">No scopes yet. Create one below.</p>}
        {scopes.map((s) => (
          <Card key={s.id} size="sm">
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle><Link to={`/s/${s.name}`} className="hover:underline">{s.name}</Link></CardTitle>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="Scope actions"><MoreHorizontalIcon /></Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuGroup>
                    <DropdownMenuItem variant="destructive" disabled={!!busy} onSelect={() => run(() => api('DELETE', `/v1/scopes/${s.id}`), s.id)}>
                      Delete scope and all messages
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </CardHeader>
          </Card>
        ))}
        <form onSubmit={create} className="flex gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="new-scope" pattern="[a-z0-9][a-z0-9._\-]{0,63}" required aria-label="New scope name" />
          <BusyButton type="submit" busy={busy === 'create'} disabled={!!busy}>Create</BusyButton>
        </form>
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          Action required {inbox.length > 0 && <Badge>{inbox.length}</Badge>}
        </h2>
        {inbox.length === 0 && (
          <Card size="sm">
            <CardHeader>
              <CardTitle>All caught up</CardTitle>
              <CardDescription>Questions from agents across all scopes show up here.</CardDescription>
            </CardHeader>
            <CardContent />
          </Card>
        )}
        {inbox.map((m) => (
          <MessageCard key={m.id} m={m} scopeName={scopeName.get(m.scopeId) ?? ''} showChannel />
        ))}
        {history.length > 0 && (
          <>
            <h2 className="mt-4 flex items-center justify-between text-sm font-medium text-muted-foreground">
              History
              <Link to="/history" className="text-xs hover:underline">See all</Link>
            </h2>
            {history.map((m) => (
              <MessageCard key={m.id} m={m} scopeName={scopeName.get(m.scopeId) ?? ''} showChannel />
            ))}
          </>
        )}
      </section>
    </div>
  )
}

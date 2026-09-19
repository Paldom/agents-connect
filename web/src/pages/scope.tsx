import { Timestamp, deleteField, doc, setDoc } from 'firebase/firestore'
import { BellIcon, BellOffIcon } from 'lucide-react'
import { Link, useParams } from 'react-router'
import { Compose } from '@/components/compose'
import { Badge } from '@/components/ui/badge'
import { BusyButton } from '@/components/busy-button'
import { useAction } from '@/lib/api'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { db } from '@/lib/firebase'
import { useAuth } from '@/lib/use-auth'
import { isMuted, muteKey, useChannels, useScope, useUserPrefs } from '@/lib/use-firestore'

const MUTE_MS = 8 * 3600_000

export function ScopePage() {
  const { scope: name } = useParams()
  const { user } = useAuth()
  const scope = useScope(user?.uid, name)
  const { items: channels } = useChannels(user?.uid, scope?.id)
  const prefs = useUserPrefs(user?.uid)
  const { busy, run } = useAction()

  if (scope === undefined) return null
  if (scope === null) return <p className="text-sm text-muted-foreground">Scope “{name}” not found.</p>

  const toggleMute = (channel: string) =>
    user &&
    run(
      () =>
        setDoc(
          doc(db, 'users', user.uid),
          { mute: { [muteKey(scope.id, channel)]: isMuted(prefs, scope.id, channel) ? deleteField() : Timestamp.fromMillis(Date.now() + MUTE_MS) } },
          { merge: true },
        ),
      channel,
    )

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">Channels</h2>
        {channels.length === 0 && <p className="text-sm text-muted-foreground">No messages in this scope yet.</p>}
        {channels.map((c) => (
          <Card key={c.name} size="sm">
            <CardHeader className="flex-row items-start justify-between">
              <div className="flex min-w-0 flex-col gap-1">
              <CardTitle className="flex items-center gap-2">
                <Link to={`/s/${scope.name}/${c.name}`} className="hover:underline">{c.name}</Link>
                {c.last && <Badge variant="outline">{c.last.kind}</Badge>}
                {isMuted(prefs, scope.id, c.name) && <Badge variant="secondary">muted</Badge>}
              </CardTitle>
              {c.last && (
                <CardDescription className="truncate">
                  {c.last.from}: {c.last.body} · {c.lastMessageAt?.toDate().toLocaleString()}
                </CardDescription>
              )}
              </div>
              <BusyButton variant="ghost" size="icon" busy={busy === c.name} disabled={!!busy} aria-label={isMuted(prefs, scope.id, c.name) ? `Unmute ${c.name}` : `Mute ${c.name} for 8 hours`} onClick={() => toggleMute(c.name)}>
                {busy !== c.name && (isMuted(prefs, scope.id, c.name) ? <BellOffIcon /> : <BellIcon />)}
              </BusyButton>
            </CardHeader>
          </Card>
        ))}
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">New message</h2>
        <Compose scopeName={scope.name} />
      </section>
    </div>
  )
}

import { useState } from 'react'
import { useParams } from 'react-router'
import { Compose } from '@/components/compose'
import { MessageCard } from '@/components/message-card'
import { Separator } from '@/components/ui/separator'
import type { Message } from '@/lib/types'
import { useAuth } from '@/lib/use-auth'
import { useMessages, useScope } from '@/lib/use-firestore'

export function ChannelPage() {
  const { scope: name, channel } = useParams()
  const { user } = useAuth()
  const scope = useScope(user?.uid, name)
  const { items: messages, loading } = useMessages(user?.uid, scope?.id, channel)
  const [replyTo, setReplyTo] = useState<Message | null>(null)

  if (scope === undefined) return null
  if (scope === null) return <p className="text-sm text-muted-foreground">Scope “{name}” not found.</p>

  // ponytail: group by thread client-side; messages are already newest-first, so groups keep that order.
  const groups = new Map<string, Message[]>()
  for (const m of messages) {
    const key = m.thread ?? ''
    groups.set(key, [...(groups.get(key) ?? []), m])
  }
  const threaded = messages.some((m) => m.thread)

  return (
    <div className="flex flex-col gap-6">
      <Compose scopeName={scope.name} channel={channel} replyTo={replyTo} onClearReply={() => setReplyTo(null)} />
      <Separator />
      <section className="flex flex-col gap-3">
        {!loading && messages.length === 0 && <p className="text-sm text-muted-foreground">No messages yet.</p>}
        {[...groups.entries()].map(([thread, msgs]) => (
          <div key={thread || '_'} className="flex flex-col gap-3">
            {threaded && <h3 className="text-xs font-medium text-muted-foreground">{thread ? `thread: ${thread}` : 'no thread'}</h3>}
            {msgs.map((m) => <MessageCard key={m.id} m={m} scopeName={scope.name} onReply={setReplyTo} />)}
          </div>
        ))}
      </section>
    </div>
  )
}

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { BusyButton } from '@/components/busy-button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { api, useAction } from '@/lib/api'
import type { Message, PermissionData } from '@/lib/types'

const fmt = (t?: { toDate(): Date }) => t?.toDate().toLocaleString() ?? ''

export function MessageCard({
  m,
  scopeName,
  showChannel,
  onReply,
}: {
  m: Message
  scopeName: string
  showChannel?: boolean
  onReply?: (m: Message) => void
}) {
  const [text, setText] = useState('')
  const { busy, run } = useAction()
  const open = m.kind === 'question' && m.status === 'open'
  const perm = m.channel === 'permissions' && m.kind === 'question' ? parsePermission(m.data) : null

  const answer = (value: string | boolean) => run(() => api('POST', `/v1/messages/${m.id}/answer`, { value }, scopeName), String(value))
  const cancel = () => run(() => api('POST', `/v1/messages/${m.id}/cancel`, undefined, scopeName), 'cancel')

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm font-normal">
          <Badge variant={m.kind === 'question' ? 'default' : m.kind === 'notice' ? 'secondary' : 'outline'}>{m.kind}</Badge>
          {m.priority && m.priority !== 'normal' && <Badge variant={m.priority === 'urgent' ? 'destructive' : 'outline'}>{m.priority}</Badge>}
          {m.tag && <Badge variant="outline">{m.tag}</Badge>}
          {showChannel && <span className="text-muted-foreground">{scopeName}/{m.channel}</span>}
          <span className="font-medium">{perm?.tool_name ? `${m.from} wants to run ${perm.tool_name}` : m.from}</span>
          {m.status && m.status !== 'open' && <Badge variant="outline">{m.status}</Badge>}
          {m.thread && <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">thread: {m.thread}</span>}
        </CardTitle>
        <CardDescription>
          {fmt(m.createdAt)}
          {m.replyTo && <> · reply to <span className="font-mono">{m.replyTo.slice(-6)}</span></>}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <p className="whitespace-pre-wrap break-words text-sm">{perm?.description ?? m.body}</p>
        {perm?.input_preview && <pre className="overflow-x-auto rounded-md bg-muted p-2 text-xs">{perm.input_preview}</pre>}
        {m.data && !perm && (
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">data</summary>
            <pre className="mt-1 overflow-x-auto rounded-md bg-muted p-2">{pretty(m.data)}</pre>
          </details>
        )}
        {m.answer && (
          <p className="text-sm text-muted-foreground">
            Answer: <span className="font-medium text-foreground">{typeof m.answer.value === 'boolean' ? (m.answer.value ? 'Yes' : 'No') : m.answer.value}</span> · {m.answer.by}
            {m.answer.via && <> via {m.answer.via}</>} · {fmt(m.answer.at)}
          </p>
        )}
        {m.delivery && (
          <p className="text-xs text-muted-foreground">
            delivered: push {m.delivery.push} · email {m.delivery.email ? 'yes' : 'no'}
          </p>
        )}
      </CardContent>
      {(open || onReply) && (
        <CardFooter className="flex flex-wrap items-end gap-2">
          {open && m.question?.type === 'confirm' && (
            <>
              <BusyButton size="sm" busy={busy === 'true'} disabled={!!busy} onClick={() => answer(true)}>Yes</BusyButton>
              <BusyButton size="sm" variant="outline" busy={busy === 'false'} disabled={!!busy} onClick={() => answer(false)}>No</BusyButton>
            </>
          )}
          {open && m.question?.type === 'choice' &&
            m.question.options?.map((o) => (
              <BusyButton key={o} size="sm" variant="outline" busy={busy === o} disabled={!!busy} onClick={() => answer(o)}>{o}</BusyButton>
            ))}
          {open && m.question?.type === 'text' && (
            <div className="flex w-full gap-2">
              <Textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Your answer" />
              <BusyButton size="sm" busy={busy === text} disabled={!!busy || !text.trim()} onClick={() => answer(text)}>Send</BusyButton>
            </div>
          )}
          {open && <BusyButton size="sm" variant="ghost" busy={busy === 'cancel'} disabled={!!busy} onClick={cancel}>Cancel</BusyButton>}
          {onReply && <Button size="sm" variant="ghost" onClick={() => onReply(m)}>Reply</Button>}
        </CardFooter>
      )}
    </Card>
  )
}

function pretty(s: string) {
  try {
    return JSON.stringify(JSON.parse(s), null, 2)
  } catch {
    return s
  }
}

function parsePermission(data?: string): PermissionData | null {
  if (!data) return null
  try {
    const d = JSON.parse(data) as PermissionData
    return d && typeof d === 'object' ? d : null
  } catch {
    return null
  }
}

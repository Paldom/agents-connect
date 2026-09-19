import { useEffect, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { BusyButton } from '@/components/busy-button'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { api, tryApi } from '@/lib/api'
import type { Kind, Message, Priority, QuestionType } from '@/lib/types'

export function Compose({
  scopeName,
  channel: fixedChannel,
  replyTo,
  onClearReply,
}: {
  scopeName: string
  channel?: string
  /** Message being replied to; sets replyTo and thread on the new message. */
  replyTo?: Message | null
  onClearReply?: () => void
}) {
  const [channel, setChannel] = useState(fixedChannel ?? '')
  const [kind, setKind] = useState<Kind>('notice')
  const [qtype, setQtype] = useState<QuestionType>('confirm')
  const [options, setOptions] = useState('')
  const [body, setBody] = useState('')
  const [priority, setPriority] = useState<Priority>('normal')
  const [tag, setTag] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (replyTo) setChannel(replyTo.channel)
  }, [replyTo])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return // a second submit while the first is pending would send the message twice
    setBusy(true)
    const question =
      kind === 'question'
        ? { type: qtype, ...(qtype === 'choice' ? { options: options.split(',').map((s) => s.trim()).filter(Boolean) } : {}) }
        : undefined
    const ok = await tryApi(() =>
      api('POST', '/v1/messages', {
        channel,
        kind,
        body,
        question,
        ...(priority !== 'normal' ? { priority } : {}),
        ...(tag.trim() ? { tag: tag.trim() } : {}),
        ...(replyTo ? { replyTo: replyTo.id, thread: replyTo.thread ?? replyTo.id } : {}),
      }, scopeName),
    )
    if (ok) {
      setBody('')
      onClearReply?.()
      toast.success('Sent')
    }
    setBusy(false)
  }

  return (
    <form onSubmit={submit}>
      <FieldGroup>
        {replyTo && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            Replying to <span className="font-mono">{replyTo.id.slice(-6)}</span> · thread {replyTo.thread ?? replyTo.id.slice(-6)}
            <Button type="button" variant="ghost" size="sm" onClick={onClearReply}>Clear</Button>
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-3">
          <Field>
            <FieldLabel htmlFor="channel">Channel</FieldLabel>
            <Input id="channel" value={channel} onChange={(e) => setChannel(e.target.value)} readOnly={!!fixedChannel}
              pattern="[a-z0-9][a-z0-9._\-]{0,63}" placeholder="alerts" required />
          </Field>
          <Field>
            <FieldLabel>Kind</FieldLabel>
            <Select value={kind} onValueChange={(v) => setKind(v as Kind)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="event">event</SelectItem>
                  <SelectItem value="notice">notice</SelectItem>
                  <SelectItem value="question">question</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          {kind === 'question' && (
            <Field>
              <FieldLabel>Question type</FieldLabel>
              <Select value={qtype} onValueChange={(v) => setQtype(v as QuestionType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="confirm">confirm (yes/no)</SelectItem>
                    <SelectItem value="choice">choice</SelectItem>
                    <SelectItem value="text">text</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          )}
        </div>
        {kind === 'question' && qtype === 'choice' && (
          <Field>
            <FieldLabel htmlFor="options">Options (comma-separated)</FieldLabel>
            <Input id="options" value={options} onChange={(e) => setOptions(e.target.value)} placeholder="deploy, rollback, wait" required />
          </Field>
        )}
        <Field>
          <FieldLabel htmlFor="body">Message</FieldLabel>
          <Textarea id="body" rows={3} value={body} onChange={(e) => setBody(e.target.value)} required />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field>
            <FieldLabel>Priority</FieldLabel>
            <Select value={priority} onValueChange={(v) => setPriority(v as Priority)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="normal">normal</SelectItem>
                  <SelectItem value="urgent">urgent</SelectItem>
                  <SelectItem value="low">low (inbox only)</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="tag">Tag (optional)</FieldLabel>
            <Input id="tag" value={tag} onChange={(e) => setTag(e.target.value)} placeholder="status, result, review_request" maxLength={64} />
          </Field>
        </div>
        <div>
          <BusyButton type="submit" busy={busy}>Send</BusyButton>
        </div>
      </FieldGroup>
    </form>
  )
}

import { collection, query, where } from 'firebase/firestore'
import { CopyIcon, Trash2Icon } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { api, useAction } from '@/lib/api'
import { BusyButton } from '@/components/busy-button'
import { db } from '@/lib/firebase'
import type { Token } from '@/lib/types'
import { useAuth } from '@/lib/use-auth'
import { useCollection, useScopes } from '@/lib/use-firestore'

export function Tokens() {
  const { user } = useAuth()
  const uid = user?.uid
  const { items: scopes } = useScopes(uid)
  const { items: tokens } = useCollection<Token>(
    () => (uid ? query(collection(db, 'tokens'), where('uid', '==', uid)) : null),
    (d) => ({ id: d.id, ...d.data() }) as Token,
    [uid],
  )
  const scopeName = new Map(scopes.map((s) => [s.id, s.name]))

  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [all, setAll] = useState(true)
  const [picked, setPicked] = useState<string[]>([])
  const [created, setCreated] = useState<string | null>(null)
  const { busy, run } = useAction()

  async function create(e: FormEvent) {
    e.preventDefault()
    // run() ignores the call while a request is pending, so a double click cannot mint two tokens.
    await run(async () => {
      const res = await api<{ token: string }>('POST', '/v1/tokens', { name, scopes: all ? ['*'] : picked })
      setCreated(res.token)
    }, 'create')
  }
  function reset(o: boolean) {
    setOpen(o)
    if (!o) {
      setCreated(null)
      setName('')
      setAll(true)
      setPicked([])
    }
  }
  const copy = (s: string) => navigator.clipboard.writeText(s).then(() => toast.success('Copied'))

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-muted-foreground">Access tokens</h2>
        <Dialog open={open} onOpenChange={reset}>
          <DialogTrigger asChild><Button>New token</Button></DialogTrigger>
          <DialogContent>
            {created ? (
              <>
                <DialogHeader>
                  <DialogTitle>Token created</DialogTitle>
                  <DialogDescription>Copy it now. It is shown only once.</DialogDescription>
                </DialogHeader>
                <div className="flex items-center gap-2">
                  <Input readOnly value={created} className="font-mono" />
                  <Button variant="outline" size="icon" aria-label="Copy token" onClick={() => copy(created)}><CopyIcon /></Button>
                </div>
                <pre className="overflow-x-auto rounded-md bg-muted p-2 text-xs">{`aconn login --api-url ${window.location.origin}/api   # then paste the token`}</pre>
                <DialogFooter><Button onClick={() => reset(false)}>Done</Button></DialogFooter>
              </>
            ) : (
              <form onSubmit={create}>
                <DialogHeader>
                  <DialogTitle>New access token</DialogTitle>
                  <DialogDescription>Agents use this token with the CLI or MCP server.</DialogDescription>
                </DialogHeader>
                <FieldGroup className="py-4">
                  <Field>
                    <FieldLabel htmlFor="tname">Name</FieldLabel>
                    <Input id="tname" value={name} onChange={(e) => setName(e.target.value)} placeholder="claude-code@laptop" required maxLength={64} />
                    <FieldDescription>Shown as the sender of the agent's messages.</FieldDescription>
                  </Field>
                  <FieldSet>
                    <FieldLegend>Scopes</FieldLegend>
                    <Field orientation="horizontal">
                      <Checkbox id="all" checked={all} onCheckedChange={(v) => setAll(v === true)} />
                      <FieldLabel htmlFor="all">All scopes (including future ones)</FieldLabel>
                    </Field>
                    {!all &&
                      scopes.map((s) => (
                        <Field key={s.id} orientation="horizontal">
                          <Checkbox
                            id={`s-${s.id}`}
                            checked={picked.includes(s.id)}
                            onCheckedChange={(v) => setPicked((p) => (v === true ? [...p, s.id] : p.filter((x) => x !== s.id)))}
                          />
                          <FieldLabel htmlFor={`s-${s.id}`}>{s.name}</FieldLabel>
                        </Field>
                      ))}
                  </FieldSet>
                </FieldGroup>
                <DialogFooter>
                  <BusyButton type="submit" busy={busy === 'create'} disabled={!!busy || (!all && picked.length === 0)}>Create</BusyButton>
                </DialogFooter>
              </form>
            )}
          </DialogContent>
        </Dialog>
      </div>
      {tokens.length === 0 && <p className="text-sm text-muted-foreground">No tokens yet.</p>}
      {tokens.map((t) => (
        <Card key={t.id} size="sm">
          <CardHeader className="flex-row items-start justify-between">
            <div className="flex flex-col gap-1">
              <CardTitle className="flex items-center gap-2">
                <span aria-hidden className={`inline-block size-2 rounded-full ${isActive(t.lastUsedAt) ? 'bg-green-500' : 'bg-muted-foreground/40'}`} />
                {t.name}
                {isActive(t.lastUsedAt) && <span className="text-xs font-normal text-green-600">active now</span>}
              </CardTitle>
              <CardDescription className="font-mono">{t.prefix}…</CardDescription>
            </div>
            <BusyButton variant="ghost" size="icon" aria-label="Revoke token" busy={busy === t.id} disabled={!!busy} onClick={() => run(() => api('DELETE', `/v1/tokens/${t.id}`), t.id)}>
              {busy !== t.id && <Trash2Icon />}
            </BusyButton>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {t.scopes.includes('*') ? <Badge>all scopes</Badge> : t.scopes.map((id) => <Badge key={id} variant="secondary">{scopeName.get(id) ?? id}</Badge>)}
            <span>created {t.createdAt?.toDate().toLocaleDateString()}</span>
            <span>· last used {t.lastUsedAt ? t.lastUsedAt.toDate().toLocaleString() : 'never'}</span>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

/** An agent is "active" when its token was used in the last 10 minutes. */
function isActive(t?: { toMillis(): number } | null) {
  return !!t && Date.now() - t.toMillis() < 10 * 60_000
}

import { sendEmailVerification, signOut } from 'firebase/auth'
import { useState } from 'react'
import { Link, Navigate, Outlet, useParams } from 'react-router'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Toaster } from '@/components/ui/sonner'
import { useApiBusy } from '@/lib/api'
import { auth } from '@/lib/firebase'
import { useAuth } from '@/lib/use-auth'
import { useOpenQuestions } from '@/lib/use-firestore'

export function App() {
  const { user, loading } = useAuth()
  const { scope, channel } = useParams()
  const { items: open } = useOpenQuestions(user?.uid)
  const busy = useApiBusy() > 0
  if (loading) return null
  if (!user) return <Navigate to="/login" replace />

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-5xl flex-col gap-6 p-4">
      {busy && <div role="progressbar" aria-label="Working" className="fixed inset-x-0 top-0 z-50 h-0.5 animate-pulse bg-primary" />}
      <header className="flex flex-wrap items-center justify-between gap-2">
        <nav className="flex items-center gap-1 text-sm">
          <Link to="/" className="font-medium hover:underline">agents-connect</Link>
          {open.length > 0 && <Link to="/" aria-label={`${open.length} open questions`}><Badge>{open.length}</Badge></Link>}
          {scope && <><span className="text-muted-foreground">/</span><Link to={`/s/${scope}`} className="hover:underline">{scope}</Link></>}
          {scope && channel && <><span className="text-muted-foreground">/</span><span>{channel}</span></>}
        </nav>
        <nav className="flex items-center gap-1">
          <Button variant="ghost" size="sm" asChild><Link to="/history">History</Link></Button>
          <Button variant="ghost" size="sm" asChild><Link to="/tokens">Tokens</Link></Button>
          <Button variant="ghost" size="sm" asChild><Link to="/settings">Settings</Link></Button>
          <Button variant="ghost" size="sm" onClick={() => signOut(auth)}>Sign out</Button>
        </nav>
      </header>
      {!user.emailVerified && <VerifyEmailBanner />}
      <main className="flex-1" aria-busy={busy || undefined}>
        <Outlet />
      </main>
      <Toaster />
    </div>
  )
}

/** The API only serves verified accounts. Accounts created in the Firebase console start unverified. */
function VerifyEmailBanner() {
  const [sent, setSent] = useState(false)
  const user = auth.currentUser!
  async function send() {
    try {
      await sendEmailVerification(user)
      setSent(true)
      toast.success(`Verification email sent to ${user.email}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }
  async function check() {
    await user.reload()
    if (!user.emailVerified) return toast.error('Not verified yet. Open the link in the email first.')
    await user.getIdToken(true) // refresh claims so the API sees email_verified
    window.location.reload()
  }
  return (
    <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
      <span>Verify <span className="font-medium">{user.email}</span> to create scopes, tokens and answers.</span>
      <span className="flex gap-2">
        <Button size="sm" onClick={send} disabled={sent}>{sent ? 'Email sent' : 'Send verification email'}</Button>
        <Button size="sm" variant="outline" onClick={check}>I have verified</Button>
      </span>
    </div>
  )
}

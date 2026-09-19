import { arrayUnion, doc, onSnapshot, setDoc } from 'firebase/firestore'
import { getToken } from 'firebase/messaging'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { BusyButton } from '@/components/busy-button'
import { useAction } from '@/lib/api'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { db, firebaseConfig, messaging } from '@/lib/firebase'
import { useAuth } from '@/lib/use-auth'

const VAPID = import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined

export function Settings() {
  const { user } = useAuth()
  const uid = user?.uid
  const [prefs, setPrefs] = useState<{ emailNotifications?: boolean; fcmTokens?: string[] }>({})
  const { busy, run } = useAction()

  useEffect(() => (uid ? onSnapshot(doc(db, 'users', uid), (s) => setPrefs(s.data() ?? {})) : undefined), [uid])

  const save = (patch: object, key = 'save') => uid && run(() => setDoc(doc(db, 'users', uid), patch, { merge: true }), key)

  async function enablePush() {
    if (busy) return
    await run(async () => {
      const m = await messaging
      if (!m) throw new Error('Push is not supported in this browser')
      if ((await Notification.requestPermission()) !== 'granted') throw new Error('Notification permission denied')
      const reg = await navigator.serviceWorker.register('/firebase-messaging-sw.js?config=' + encodeURIComponent(JSON.stringify(firebaseConfig)))
      const token = await getToken(m, { vapidKey: VAPID, serviceWorkerRegistration: reg })
      if (uid) await setDoc(doc(db, 'users', uid), { fcmTokens: arrayUnion(token) }, { merge: true })
      toast.success('Push enabled on this device')
    }, 'push')
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Notifications</CardTitle>
          <CardDescription>How notices and questions reach you.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <Field orientation="horizontal">
            <Checkbox id="email" disabled={!!busy} checked={prefs.emailNotifications !== false} onCheckedChange={(v) => save({ emailNotifications: v === true })} />
            <FieldLabel htmlFor="email">Email notifications</FieldLabel>
          </Field>
          <Field>
            <FieldLabel>Push notifications</FieldLabel>
            <div>
              <BusyButton variant="outline" onClick={enablePush} busy={busy === 'push'} disabled={!!busy || !VAPID}>Enable push on this device</BusyButton>
            </div>
            <FieldDescription>
              {!VAPID
                ? 'Disabled: VITE_FIREBASE_VAPID_KEY is not configured for this build.'
                : `${prefs.fcmTokens?.length ?? 0} device(s) registered.`}
            </FieldDescription>
          </Field>
        </CardContent>
      </Card>
    </div>
  )
}

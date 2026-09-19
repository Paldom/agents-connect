import { initializeApp, type FirebaseOptions } from 'firebase/app'
import { connectAuthEmulator, getAuth } from 'firebase/auth'
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore'
import { getMessaging, isSupported } from 'firebase/messaging'

// The public web config comes from the build environment (web/.env.local, gitignored) so the repo carries no project ids.
const raw = import.meta.env.VITE_FIREBASE_CONFIG as string | undefined
if (!raw) {
  const msg = 'agents-connect web: VITE_FIREBASE_CONFIG is not set. Copy web/.env.example to web/.env.local and paste your Firebase web config as JSON.'
  const root = document.getElementById('root')
  if (root) root.textContent = msg
  throw new Error(msg)
}
export const firebaseConfig = JSON.parse(raw) as FirebaseOptions

export const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const db = getFirestore(app)
export const messaging = isSupported().then((ok) => (ok ? getMessaging(app) : null))

if (import.meta.env.VITE_USE_EMULATORS === '1') {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  connectFirestoreEmulator(db, '127.0.0.1', 8090)
}

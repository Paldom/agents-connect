import { onAuthStateChanged, type User } from 'firebase/auth'
import { useEffect, useState } from 'react'
import { auth } from './firebase'

export function useAuth() {
  const [state, setState] = useState<{ user: User | null; loading: boolean }>({ user: auth.currentUser, loading: true })
  useEffect(() => onAuthStateChanged(auth, (user) => setState({ user, loading: false })), [])
  return state
}

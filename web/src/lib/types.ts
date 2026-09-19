import type { Timestamp } from 'firebase/firestore'

export type Kind = 'event' | 'notice' | 'question'
export type QuestionType = 'confirm' | 'choice' | 'text'

export interface Scope {
  id: string
  name: string
}

export interface Channel {
  name: string
  lastMessageAt?: Timestamp
  last?: { id: string; kind: Kind; from: string; body: string }
}

export interface Message {
  id: string
  scopeId: string
  channel: string
  kind: Kind
  from: string
  body: string
  data?: string
  question?: { type: QuestionType; options?: string[] }
  status?: 'open' | 'answered' | 'cancelled'
  answer?: { value: string | boolean; by: string; at: Timestamp; via?: 'web' | 'ios' | 'cli' | 'hook' }
  replyTo?: string
  thread?: string
  priority?: Priority
  tag?: string
  delivery?: { push: number; email: boolean; at: Timestamp }
  createdAt: Timestamp
}

export type Priority = 'urgent' | 'normal' | 'low'

/** Claude Code permission relay payload (questions on the `permissions` channel). */
export interface PermissionData {
  tool_name?: string
  description?: string
  input_preview?: string
  request_id?: string
}

export interface Token {
  id: string
  name: string
  prefix: string
  scopes: string[]
  createdAt?: Timestamp
  lastUsedAt?: Timestamp | null
}

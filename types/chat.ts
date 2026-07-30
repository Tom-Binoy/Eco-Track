import type { Id } from '@/convex/_generated/dataModel'

export type MessageRole = 'user' | 'eco' | 'error'

export interface ChatMessage {
  id: string
  messageId: Id<'messages'>
  role: MessageRole
  text: string
  timestamp: number
  cardId?: string
}

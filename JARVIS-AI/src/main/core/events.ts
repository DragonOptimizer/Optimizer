import { EventEmitter } from 'node:events'
import type { ActivityEvent, ApprovalRequest, AssistantState, ChatMessage, Settings } from '@shared/types'

export interface BusEvents {
  state: { state: AssistantState; detail: string }
  activity: ActivityEvent
  approval: ApprovalRequest
  'approval-resolved': { id: string; decision: string }
  'chat-message': ChatMessage
  settings: Settings
  'schedule-fired': { id: string; title: string; message: string; channels: string[] }
  telegram: unknown
  speak: { text: string; interrupt?: boolean }
  stop: { reason: string }
  online: { online: boolean }
}

/** Typed event bus connecting services to the UI layer. Events reflect real execution. */
export class Bus {
  private em = new EventEmitter()
  constructor() { this.em.setMaxListeners(50) }
  emit<K extends keyof BusEvents>(k: K, v: BusEvents[K]) { this.em.emit(k, v) }
  on<K extends keyof BusEvents>(k: K, fn: (v: BusEvents[K]) => void): () => void {
    this.em.on(k, fn as any)
    return () => this.em.off(k, fn as any)
  }
}

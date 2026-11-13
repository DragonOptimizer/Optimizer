import type { AssistantState } from '@shared/types'
import type { Bus } from './events'

/** Derives the single orb state shown in the UI from real sub-system signals. */
export class StateMachine {
  private agent: AssistantState = 'idle'
  private agentDetail = ''
  private voice: 'idle' | 'listening' | 'speaking' = 'idle'
  private approvals = 0
  private online = true
  private errorUntil = 0
  private errorDetail = ''
  private cur: AssistantState = 'idle'
  private curDetail = ''
  constructor(private bus: Bus) {}
  get state() { return this.cur }
  get detail() { return this.curDetail }
  setAgent(s: 'idle' | 'processing' | 'acting', detail = '') { this.agent = s; this.agentDetail = detail; this.recompute() }
  setVoice(s: 'idle' | 'listening' | 'speaking') { this.voice = s; this.recompute() }
  setApprovals(n: number) { this.approvals = n; this.recompute() }
  setOnline(v: boolean) { this.online = v; this.recompute() }
  flashError(detail: string, ms = 6000) {
    this.errorUntil = Date.now() + ms; this.errorDetail = detail; this.recompute()
    setTimeout(() => this.recompute(), ms + 20).unref?.()
  }
  private recompute() {
    let s: AssistantState, d: string
    if (!this.online) { s = 'offline'; d = 'No internet connection' }
    else if (this.approvals > 0) { s = 'awaiting_approval'; d = 'Waiting for your permission' }
    else if (Date.now() < this.errorUntil) { s = 'error'; d = this.errorDetail }
    else if (this.agent === 'acting') { s = 'acting'; d = this.agentDetail }
    else if (this.agent === 'processing') { s = 'processing'; d = this.agentDetail || 'Thinking…' }
    else if (this.voice === 'speaking') { s = 'speaking'; d = 'Speaking' }
    else if (this.voice === 'listening') { s = 'listening'; d = 'Listening' }
    else { s = 'idle'; d = 'Ready' }
    if (s !== this.cur || d !== this.curDetail) { this.cur = s; this.curDetail = d; this.bus.emit('state', { state: s, detail: d }) }
  }
}

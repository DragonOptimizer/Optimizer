import type { ApprovalDecision, ApprovalRequest, RiskLevel } from '@shared/types'
import type { Db } from './db'
import type { Bus } from './events'
import type { SettingsStore } from './settings'
import type { AuditStore } from './stores'
import { newId, now } from './ids'

export interface PermissionContext {
  taskId: string
  actor: 'user' | 'telegram' | 'scheduler'
  unattended: boolean
  /** True once this task has consumed untrusted external content (web page, email, PDF...). */
  tainted: boolean
  signal: AbortSignal
}
export interface PermissionQuery { tool: string; category: string; risk: RiskLevel; summary: string; args: unknown; unattendedOk: boolean; taintExempt?: boolean }
export interface Decision { allowed: boolean; reason: string; mode: 'auto' | 'user' | 'blocked' }

/**
 * Central policy engine. Every tool call passes through here.
 *  - safe:      read-only, runs automatically
 *  - moderate:  reversible local actions; automatic in 'balanced' mode unless the task is tainted by untrusted content
 *  - sensitive: external communication, spending, screenshots, closing apps... always asks
 *  - dangerous: deletion, launching downloaded programs... always asks, can never be "always allowed"
 *  Unattended contexts (scheduler, phone) may only run tools explicitly marked unattendedOk with risk <= moderate.
 */
export class PermissionManager {
  private pending = new Map<string, { req: ApprovalRequest; resolve: (d: ApprovalDecision) => void; timer: NodeJS.Timeout }>()
  private stopped = false
  constructor(private db: Db, private settings: SettingsStore, private bus: Bus, private audit: AuditStore) {}

  isStopped() { return this.stopped }
  setStopped(v: boolean) { this.stopped = v }
  pendingRequests(): ApprovalRequest[] { return [...this.pending.values()].map((p) => p.req) }
  hasGrant(tool: string): boolean { return !!this.db.get('SELECT 1 FROM tool_grants WHERE tool=?', tool) }
  revokeGrants() { this.db.run('DELETE FROM tool_grants') }
  grants(): string[] { return this.db.all<{ tool: string }>('SELECT tool FROM tool_grants').map((r) => r.tool) }

  /** Reject everything that is waiting (emergency stop / shutdown). */
  denyAllPending(reason = 'stopped') { for (const id of [...this.pending.keys()]) this.respond(id, 'deny', reason) }

  respond(id: string, decision: ApprovalDecision, why = 'user') {
    const p = this.pending.get(id)
    if (!p) return false
    clearTimeout(p.timer)
    this.pending.delete(id)
    if (decision === 'allow_always' && p.req.allowRemember) this.db.run('INSERT OR REPLACE INTO tool_grants(tool,granted_at) VALUES(?,?)', p.req.tool, now())
    this.bus.emit('approval-resolved', { id, decision })
    p.resolve(decision)
    void why
    return true
  }

  async decide(q: PermissionQuery, ctx: PermissionContext): Promise<Decision> {
    const s = this.settings.get()
    const log = (decision: string) => this.audit.add(ctx.actor, q.tool, q.risk, decision, q.summary)
    if (this.stopped) { log('blocked:emergency-stop'); return { allowed: false, reason: 'Emergency stop is active. Resume from the Privacy panel.', mode: 'blocked' } }
    if (!s.computer.enabled && (q.category === 'computer' || q.category === 'browser')) {
      log('blocked:disabled'); return { allowed: false, reason: 'Computer control is switched off in Settings.', mode: 'blocked' }
    }
    if (q.risk === 'safe') { log('auto'); return { allowed: true, reason: 'safe', mode: 'auto' } }

    if (ctx.unattended) {
      const ok = q.unattendedOk && (q.risk === 'moderate') && !(ctx.tainted && !q.taintExempt)
      log(ok ? 'auto:unattended' : 'blocked:unattended')
      return ok ? { allowed: true, reason: 'unattended-allowed', mode: 'auto' }
        : { allowed: false, reason: `"${q.tool}" is not permitted in unattended workflows (${ctx.tainted ? 'task read untrusted content' : q.risk + ' risk'}).`, mode: 'blocked' }
    }

    const taintBlocks = ctx.tainted && !q.taintExempt
    if (q.risk === 'moderate' && !taintBlocks) {
      if (s.computer.approvalMode === 'balanced' || this.hasGrant(q.tool)) { log('auto'); return { allowed: true, reason: 'moderate', mode: 'auto' } }
    }
    const reason = taintBlocks && (q.risk === 'moderate')
      ? 'This task has read external content (web/email/PDF). Approval is required before acting on the computer, in case that content tried to give instructions.'
      : q.risk === 'dangerous' ? 'Potentially destructive or high-impact action.' : q.risk === 'sensitive' ? 'Sensitive action (communication, spending or private data).' : 'Strict mode: confirmation required.'
    const allowRemember = q.risk === 'moderate' && !taintBlocks
    const decision = await this.ask({ id: newId(), taskId: ctx.taskId, tool: q.tool, risk: q.risk, summary: q.summary, args: q.args, reason,
      createdAt: now(), expiresAt: now() + s.security.approvalTimeoutSec * 1000, allowRemember }, ctx.signal)
    log(decision === 'deny' ? 'denied' : decision === 'allow_always' && allowRemember ? 'approved+remembered' : 'approved')
    return decision === 'deny' ? { allowed: false, reason: 'The user denied (or did not answer) the approval request.', mode: 'user' } : { allowed: true, reason: 'approved', mode: 'user' }
  }

  private ask(req: ApprovalRequest, signal: AbortSignal): Promise<ApprovalDecision> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => this.respond(req.id, 'deny', 'timeout'), Math.max(1, req.expiresAt - now()))
      this.pending.set(req.id, { req, resolve, timer })
      signal.addEventListener('abort', () => this.respond(req.id, 'deny', 'aborted'), { once: true })
      if (signal.aborted) return this.respond(req.id, 'deny', 'aborted')
      this.bus.emit('approval', req)
    })
  }
}

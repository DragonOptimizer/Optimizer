import type { ActivityEvent, AuditEntry, TaskRecord, TaskStatus, RiskLevel } from '@shared/types'
import type { Db } from './db'
import { newId, now } from './ids'

export class TaskStore {
  constructor(private db: Db) {}
  /** Tasks left 'running' by a crash are marked failed on startup so no state is silently lost. */
  recoverCrashed(): number {
    const r = this.db.run(`UPDATE tasks SET status='failed', finished_at=?, summary=COALESCE(summary,'Interrupted: application closed or crashed before this task finished.') WHERE status IN ('running','awaiting_approval','planned')`, now())
    return Number(r.changes)
  }
  create(title: string, source: TaskRecord['source']): TaskRecord {
    const t: TaskRecord = { id: newId(), title: title.slice(0, 200), source, status: 'running', startedAt: now(), tokensIn: 0, tokensOut: 0 }
    this.db.run('INSERT INTO tasks(id,title,source,status,started_at) VALUES(?,?,?,?,?)', t.id, t.title, t.source, t.status, t.startedAt)
    return t
  }
  setStatus(id: string, status: TaskStatus, summary?: string) {
    const fin = status === 'running' || status === 'awaiting_approval' || status === 'planned' ? null : now()
    this.db.run('UPDATE tasks SET status=?, finished_at=COALESCE(?,finished_at), summary=COALESCE(?,summary) WHERE id=?', status, fin, summary ?? null, id)
  }
  addTokens(id: string, i: number, o: number) { this.db.run('UPDATE tasks SET tokens_in=tokens_in+?, tokens_out=tokens_out+? WHERE id=?', i, o, id) }
  list(limit = 100): TaskRecord[] {
    return this.db.all('SELECT * FROM tasks ORDER BY started_at DESC LIMIT ?', limit).map((r: any) => ({
      id: r.id, title: r.title, source: r.source, status: r.status, startedAt: r.started_at, finishedAt: r.finished_at ?? undefined,
      summary: r.summary ?? undefined, tokensIn: r.tokens_in, tokensOut: r.tokens_out }))
  }
}

export class ActivityStore {
  constructor(private db: Db) {}
  add(e: ActivityEvent) {
    this.db.run('INSERT INTO activity(id,ts,task_id,kind,status,tool,risk,message,detail) VALUES(?,?,?,?,?,?,?,?,?)',
      e.id, e.ts, e.taskId, e.kind, e.status, e.tool ?? null, e.risk ?? null, e.message, e.detail ?? null)
  }
  recent(limit = 200): ActivityEvent[] {
    return this.db.all('SELECT * FROM (SELECT *, rowid AS seq FROM activity ORDER BY seq DESC LIMIT ?) ORDER BY seq ASC', limit).map((r: any) => ({
      id: r.id, ts: r.ts, taskId: r.task_id, kind: r.kind, status: r.status, tool: r.tool ?? undefined, risk: r.risk ?? undefined, message: r.message, detail: r.detail ?? undefined }))
  }
  clear() { this.db.run('DELETE FROM activity') }
}

export class AuditStore {
  constructor(private db: Db) {}
  add(actor: string, tool: string, risk: RiskLevel, decision: string, summary: string) {
    this.db.run('INSERT INTO audit(id,ts,actor,tool,risk,decision,summary) VALUES(?,?,?,?,?,?,?)', newId(), now(), actor, tool, risk, decision, summary.slice(0, 500))
  }
  list(limit = 300): AuditEntry[] {
    return this.db.all('SELECT * FROM audit ORDER BY ts DESC, rowid DESC LIMIT ?', limit).map((r: any) => ({ id: r.id, ts: r.ts, actor: r.actor, tool: r.tool, risk: r.risk, decision: r.decision, summary: r.summary }))
  }
  clear() { this.db.run('DELETE FROM audit') }
}

/** Token accounting used to enforce daily limits (prevents runaway API spending). */
export class UsageStore {
  constructor(private db: Db) {}
  private day() { return new Date().toISOString().slice(0, 10) }
  add(i: number, o: number) {
    this.db.run(`INSERT INTO usage(day,tokens_in,tokens_out) VALUES(?,?,?) ON CONFLICT(day) DO UPDATE SET tokens_in=tokens_in+excluded.tokens_in, tokens_out=tokens_out+excluded.tokens_out`, this.day(), i, o)
  }
  today(): { tokensIn: number; tokensOut: number } {
    const r = this.db.get<any>('SELECT tokens_in,tokens_out FROM usage WHERE day=?', this.day())
    return { tokensIn: r?.tokens_in ?? 0, tokensOut: r?.tokens_out ?? 0 }
  }
}

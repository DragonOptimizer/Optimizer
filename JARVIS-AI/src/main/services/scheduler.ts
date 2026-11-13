import type { RecurrenceSpec, ScheduleChannel, ScheduleRecord, ScheduleRunRecord } from '@shared/types'
import type { Db } from '../core/db'
import type { Logger } from '../core/logger'
import { newId, now } from '../core/ids'

const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/

/** Next occurrence strictly after `from` (local time). Returns null for a one-shot in the past. */
export function computeNextRun(r: RecurrenceSpec, from: number): number | null {
  if (r.type === 'once') return r.at > from ? r.at : null
  const m = HHMM.exec(r.time)
  if (!m) throw new Error(`Invalid time "${r.time}" (use HH:MM, 24-hour)`)
  const h = Number(m[1]), min = Number(m[2])
  const days = r.type === 'daily' ? [0, 1, 2, 3, 4, 5, 6] : r.type === 'weekdays' ? [1, 2, 3, 4, 5] : r.days
  if (!days.length) throw new Error('Weekly schedule needs at least one day')
  const base = new Date(from)
  for (let i = 0; i <= 8; i++) {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i, h, min, 0, 0)
    if (d.getTime() > from && days.includes(d.getDay())) return d.getTime()
  }
  return null
}

const rowTo = (r: any): ScheduleRecord => ({
  id: r.id, title: r.title, kind: r.kind, message: r.message, recurrence: JSON.parse(r.recurrence), channels: JSON.parse(r.channels),
  enabled: !!r.enabled, nextRun: r.next_run, lastRun: r.last_run, lastStatus: r.last_status, createdAt: r.created_at
})

export interface SchedulerHooks {
  /** Execute a due schedule. Throw on failure; the returned string is logged as the run detail. */
  fire(s: ScheduleRecord): Promise<string>
}

/**
 * Persistent scheduler. State lives in SQLite so it survives restarts; a unique dedupe key prevents duplicates;
 * runs missed while the app was closed are executed if within the grace window, otherwise logged as missed.
 */
export class Scheduler {
  private timer: NodeJS.Timeout | null = null
  private busy = new Set<string>()
  constructor(private db: Db, private hooks: SchedulerHooks, private log: Logger, private graceMs = 60 * 60_000, private tickMs = 10_000) {}

  start() { if (!this.timer) { this.timer = setInterval(() => void this.tick(), this.tickMs); this.timer.unref?.(); void this.tick() } }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null }

  create(o: { title: string; kind: 'reminder' | 'agent'; message: string; recurrence: RecurrenceSpec; channels: ScheduleChannel[] }): ScheduleRecord {
    if (!o.message.trim()) throw new Error('Message is empty')
    const next = computeNextRun(o.recurrence, now())
    if (next === null) throw new Error('That time is in the past.')
    const key = `${o.kind}|${o.message.trim().toLowerCase()}|${JSON.stringify(o.recurrence)}|${[...o.channels].sort().join(',')}`
    const dup = this.db.get('SELECT * FROM schedules WHERE dedupe_key=?', key)
    if (dup) return rowTo(dup)
    const id = newId()
    this.db.run('INSERT INTO schedules(id,dedupe_key,title,kind,message,recurrence,channels,enabled,next_run,created_at) VALUES(?,?,?,?,?,?,?,1,?,?)',
      id, key, o.title.slice(0, 120), o.kind, o.message, JSON.stringify(o.recurrence), JSON.stringify(o.channels), next, now())
    return this.get(id)!
  }
  get(id: string) { const r = this.db.get('SELECT * FROM schedules WHERE id=?', id); return r ? rowTo(r) : undefined }
  list(): ScheduleRecord[] { return this.db.all('SELECT * FROM schedules ORDER BY COALESCE(next_run, 9e15) ASC').map(rowTo) }
  setEnabled(id: string, enabled: boolean) {
    const s = this.get(id); if (!s) return
    const next = enabled ? computeNextRun(s.recurrence, now()) : s.nextRun
    this.db.run('UPDATE schedules SET enabled=?, next_run=? WHERE id=?', enabled && next !== null ? 1 : 0, next, id)
  }
  delete(id: string) { this.db.run('DELETE FROM schedules WHERE id=?', id); this.db.run('DELETE FROM schedule_runs WHERE schedule_id=?', id) }
  runs(scheduleId?: string, limit = 100): ScheduleRunRecord[] {
    const rows = scheduleId ? this.db.all('SELECT * FROM schedule_runs WHERE schedule_id=? ORDER BY ts DESC LIMIT ?', scheduleId, limit) : this.db.all('SELECT * FROM schedule_runs ORDER BY ts DESC LIMIT ?', limit)
    return rows.map((r: any) => ({ id: r.id, scheduleId: r.schedule_id, ts: r.ts, status: r.status, detail: r.detail }))
  }
  private record(id: string, status: ScheduleRunRecord['status'], detail: string) {
    this.db.run('INSERT INTO schedule_runs(id,schedule_id,ts,status,detail) VALUES(?,?,?,?,?)', newId(), id, now(), status, detail.slice(0, 1000))
    this.db.run('UPDATE schedules SET last_run=?, last_status=? WHERE id=?', now(), `${status}: ${detail.slice(0, 120)}`, id)
  }

  /** Run everything that is due. Exposed for tests. */
  async tick(at = now()): Promise<number> {
    const due = this.db.all('SELECT * FROM schedules WHERE enabled=1 AND next_run IS NOT NULL AND next_run<=?', at).map(rowTo)
    let ran = 0
    for (const s of due) {
      if (this.busy.has(s.id)) continue
      this.busy.add(s.id)
      try {
        // Advance first so a crash mid-run can never cause a duplicate fire.
        const late = at - (s.nextRun as number)
        const next = computeNextRun(s.recurrence, at)
        this.db.run('UPDATE schedules SET next_run=?, enabled=? WHERE id=?', next, next === null ? 0 : 1, s.id)
        if (late > this.graceMs) { this.record(s.id, 'missed', `Missed by ${Math.round(late / 60000)} min (app was not running)`); continue }
        try { const detail = await this.hooks.fire(s); this.record(s.id, 'ok', detail); ran++ }
        catch (e) { this.record(s.id, 'error', (e as Error).message); this.log.error('scheduler', `schedule ${s.title} failed`, e) }
      } finally { this.busy.delete(s.id) }
    }
    return ran
  }
}

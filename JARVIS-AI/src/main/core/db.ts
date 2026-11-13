import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export type Row = Record<string, any>

/** Thin wrapper over Node's built-in SQLite (no native module rebuild needed on Windows). */
export class Db {
  readonly raw: DatabaseSync
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    this.raw = new DatabaseSync(path)
    this.raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA synchronous = NORMAL;')
    this.migrate()
  }
  run(sql: string, ...params: any[]) { return this.raw.prepare(sql).run(...params) }
  all<T = Row>(sql: string, ...params: any[]): T[] { return this.raw.prepare(sql).all(...params) as T[] }
  get<T = Row>(sql: string, ...params: any[]): T | undefined { return this.raw.prepare(sql).get(...params) as T | undefined }
  tx<T>(fn: () => T): T {
    this.raw.exec('BEGIN')
    try { const r = fn(); this.raw.exec('COMMIT'); return r } catch (e) { this.raw.exec('ROLLBACK'); throw e }
  }
  close() { this.raw.close() }

  private migrate() {
    this.raw.exec(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`)
    const v = Number(this.get<{ value: string }>(`SELECT value FROM meta WHERE key='schema'`)?.value ?? 0)
    const steps: string[] = [
      `CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
       CREATE TABLE secrets (name TEXT PRIMARY KEY, blob BLOB NOT NULL, updated_at INTEGER NOT NULL);
       CREATE TABLE conversations (id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
       CREATE TABLE messages (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
         role TEXT NOT NULL, content TEXT NOT NULL, source TEXT NOT NULL, created_at INTEGER NOT NULL);
       CREATE INDEX idx_messages_conv ON messages(conversation_id, created_at);
       CREATE TABLE memory (id TEXT PRIMARY KEY, kind TEXT NOT NULL, content TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
       CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL, source TEXT NOT NULL, status TEXT NOT NULL, started_at INTEGER NOT NULL,
         finished_at INTEGER, summary TEXT, tokens_in INTEGER NOT NULL DEFAULT 0, tokens_out INTEGER NOT NULL DEFAULT 0);
       CREATE TABLE activity (id TEXT PRIMARY KEY, ts INTEGER NOT NULL, task_id TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL,
         tool TEXT, risk TEXT, message TEXT NOT NULL, detail TEXT);
       CREATE INDEX idx_activity_ts ON activity(ts);
       CREATE TABLE audit (id TEXT PRIMARY KEY, ts INTEGER NOT NULL, actor TEXT NOT NULL, tool TEXT NOT NULL, risk TEXT NOT NULL, decision TEXT NOT NULL, summary TEXT NOT NULL);
       CREATE TABLE tool_grants (tool TEXT PRIMARY KEY, granted_at INTEGER NOT NULL);
       CREATE TABLE schedules (id TEXT PRIMARY KEY, dedupe_key TEXT UNIQUE, title TEXT NOT NULL, kind TEXT NOT NULL, message TEXT NOT NULL,
         recurrence TEXT NOT NULL, channels TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, next_run INTEGER, last_run INTEGER, last_status TEXT, created_at INTEGER NOT NULL);
       CREATE TABLE schedule_runs (id TEXT PRIMARY KEY, schedule_id TEXT NOT NULL, ts INTEGER NOT NULL, status TEXT NOT NULL, detail TEXT NOT NULL);
       CREATE TABLE usage (day TEXT PRIMARY KEY, tokens_in INTEGER NOT NULL DEFAULT 0, tokens_out INTEGER NOT NULL DEFAULT 0);
       CREATE TABLE calls (id TEXT PRIMARY KEY, ts INTEGER NOT NULL, to_number TEXT NOT NULL, status TEXT NOT NULL, sid TEXT, duration_sec INTEGER, est_cost_usd REAL NOT NULL DEFAULT 0, reason TEXT NOT NULL);
       CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);`
    ]
    for (let i = v; i < steps.length; i++) {
      this.tx(() => {
        this.raw.exec(steps[i])
        this.run(`INSERT INTO meta(key,value) VALUES('schema',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, String(i + 1))
      })
    }
  }
}

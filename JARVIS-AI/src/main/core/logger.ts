import { appendFileSync, mkdirSync, statSync, renameSync, existsSync } from 'node:fs'
import { dirname } from 'node:path'
import type { LogEntry } from '@shared/types'

const SECRET_RE = /(sk-[A-Za-z0-9_-]{8,}|AIza[0-9A-Za-z_-]{20,}|\b\d{6,}:[A-Za-z0-9_-]{25,}|ya29\.[A-Za-z0-9._-]+|Bearer\s+[A-Za-z0-9._-]+|AC[0-9a-f]{32})/g
export const redact = (s: string): string => s.replace(SECRET_RE, '[redacted]')

/** Structured JSON-lines logger with a ring buffer for the diagnostics screen. Secrets are redacted. */
export class Logger {
  private ring: LogEntry[] = []
  private listeners = new Set<(e: LogEntry) => void>()
  constructor(private file?: string, private maxRing = 500) {
    if (file) mkdirSync(dirname(file), { recursive: true })
  }
  onEntry(fn: (e: LogEntry) => void) { this.listeners.add(fn); return () => this.listeners.delete(fn) }
  private write(level: LogEntry['level'], scope: string, msg: string, data?: unknown) {
    const entry: LogEntry = { ts: Date.now(), level, scope, msg: redact(msg), data: data === undefined ? undefined : safeJson(data) }
    this.ring.push(entry)
    if (this.ring.length > this.maxRing) this.ring.shift()
    if (this.file) {
      try {
        if (existsSync(this.file) && statSync(this.file).size > 5_000_000) renameSync(this.file, this.file + '.1')
        appendFileSync(this.file, JSON.stringify(entry) + '\n')
      } catch { /* logging must never throw */ }
    }
    for (const l of this.listeners) { try { l(entry) } catch { /* ignore */ } }
  }
  debug(scope: string, msg: string, data?: unknown) { this.write('debug', scope, msg, data) }
  info(scope: string, msg: string, data?: unknown) { this.write('info', scope, msg, data) }
  warn(scope: string, msg: string, data?: unknown) { this.write('warn', scope, msg, data) }
  error(scope: string, msg: string, data?: unknown) { this.write('error', scope, msg, data) }
  recent(n = 200): LogEntry[] { return this.ring.slice(-n) }
}
function safeJson(d: unknown): unknown {
  try { return JSON.parse(redact(JSON.stringify(d instanceof Error ? { name: d.name, message: d.message, stack: d.stack } : d))) } catch { return String(d) }
}

import type { MemoryItem } from '@shared/types'
import type { Db } from './db'
import { newId, now } from './ids'

const SENSITIVE = [
  /\bpassword\b\s*(is|=|:)/i, /\bpasscode\b/i, /\bapi[-_ ]?key\b/i, /\bsecret\b\s*(is|=|:)/i, /\btoken\b\s*(is|=|:)/i,
  /sk-[A-Za-z0-9_-]{16,}/, /AIza[0-9A-Za-z_-]{20,}/, /\b(?:\d[ -]?){13,19}\b/, /\b\d{3}-\d{2}-\d{4}\b/
]
export function looksSensitive(text: string): boolean { return SENSITIVE.some((r) => r.test(text)) }

const rowTo = (r: any): MemoryItem => ({ id: r.id, kind: r.kind, content: r.content, createdAt: r.created_at, updatedAt: r.updated_at })

export class MemoryStore {
  constructor(private db: Db) {}
  add(content: string, kind: MemoryItem['kind'] = 'note'): MemoryItem {
    content = content.trim()
    if (!content) throw new Error('Memory content is empty.')
    if (looksSensitive(content)) throw new Error('That looks like a password, token or other secret, so I will not store it in memory.')
    const dup = this.db.get('SELECT * FROM memory WHERE lower(content)=lower(?)', content)
    if (dup) return rowTo(dup)
    const id = newId(), t = now()
    this.db.run('INSERT INTO memory(id,kind,content,created_at,updated_at) VALUES(?,?,?,?,?)', id, kind, content, t, t)
    return { id, kind, content, createdAt: t, updatedAt: t }
  }
  update(id: string, content: string, kind?: MemoryItem['kind']) {
    if (looksSensitive(content)) throw new Error('Refusing to store secrets in memory.')
    this.db.run('UPDATE memory SET content=?, kind=COALESCE(?,kind), updated_at=? WHERE id=?', content.trim(), kind ?? null, now(), id)
  }
  delete(id: string) { this.db.run('DELETE FROM memory WHERE id=?', id) }
  clear() { this.db.run('DELETE FROM memory') }
  list(): MemoryItem[] { return this.db.all('SELECT * FROM memory ORDER BY updated_at DESC').map(rowTo) }
  /** Keyword-overlap relevance search. */
  search(query: string, limit = 8): MemoryItem[] {
    const terms = query.toLowerCase().split(/\W+/).filter((t) => t.length > 2)
    const all = this.list()
    if (!terms.length) return all.slice(0, limit)
    return all
      .map((m) => ({ m, s: terms.reduce((n, t) => n + (m.content.toLowerCase().includes(t) ? 1 : 0), 0) }))
      .filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, limit).map((x) => x.m)
  }
  /** Preferences and goals are always included in the prompt; other memories only when relevant. */
  forPrompt(query: string): MemoryItem[] {
    const always = this.list().filter((m) => m.kind === 'preference' || m.kind === 'goal').slice(0, 15)
    const ids = new Set(always.map((m) => m.id))
    return [...always, ...this.search(query, 6).filter((m) => !ids.has(m.id))]
  }
}

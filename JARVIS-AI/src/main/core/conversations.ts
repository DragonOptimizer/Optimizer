import type { ChatMessage, MessageSource } from '@shared/types'
import type { Db } from './db'
import { newId, now } from './ids'

const rowTo = (r: any): ChatMessage => ({ id: r.id, conversationId: r.conversation_id, role: r.role, content: r.content, source: r.source, createdAt: r.created_at })

export class ConversationStore {
  constructor(private db: Db) {}
  create(title = 'New conversation'): string {
    const id = newId(), t = now()
    this.db.run('INSERT INTO conversations(id,title,created_at,updated_at) VALUES(?,?,?,?)', id, title, t, t)
    return id
  }
  /** Most recent conversation, or a fresh one. */
  current(): string {
    const r = this.db.get<{ id: string }>('SELECT id FROM conversations ORDER BY updated_at DESC LIMIT 1')
    return r?.id ?? this.create()
  }
  list() { return this.db.all('SELECT id,title,updated_at FROM conversations ORDER BY updated_at DESC LIMIT 50').map((r: any) => ({ id: r.id, title: r.title, updatedAt: r.updated_at })) }
  add(conversationId: string, role: ChatMessage['role'], content: string, source: MessageSource = 'text'): ChatMessage {
    const m: ChatMessage = { id: newId(), conversationId, role, content, source, createdAt: now() }
    this.db.tx(() => {
      this.db.run('INSERT INTO messages(id,conversation_id,role,content,source,created_at) VALUES(?,?,?,?,?,?)', m.id, conversationId, role, content, source, m.createdAt)
      this.db.run('UPDATE conversations SET updated_at=? WHERE id=?', m.createdAt, conversationId)
      const c = this.db.get<{ title: string }>('SELECT title FROM conversations WHERE id=?', conversationId)
      if (c?.title === 'New conversation' && role === 'user') this.db.run('UPDATE conversations SET title=? WHERE id=?', content.slice(0, 60), conversationId)
    })
    return m
  }
  history(conversationId: string, limit = 200): ChatMessage[] {
    return this.db.all('SELECT * FROM (SELECT *, rowid AS seq FROM messages WHERE conversation_id=? ORDER BY seq DESC LIMIT ?) ORDER BY seq ASC', conversationId, limit).map(rowTo)
  }
  clearAll() { this.db.run('DELETE FROM conversations') }
}

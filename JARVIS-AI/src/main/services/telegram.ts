import { randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { basename } from 'node:path'
import type { TelegramStatus } from '@shared/types'
import type { Db } from '../core/db'
import type { SecretStore } from '../core/secrets'
import type { Logger } from '../core/logger'
import type { Bus } from '../core/events'

export const TELEGRAM_TOKEN_SECRET = 'telegram.bot.token'
interface Chat { id: number; name: string }
export interface TelegramHandlers {
  /** A paired user sent free text. Return the reply to send back. */
  onMessage(text: string, chat: Chat): Promise<string>
  onStop(): void
}
const kvGet = (db: Db, k: string) => db.get<{ value: string }>('SELECT value FROM kv WHERE key=?', k)?.value
const kvSet = (db: Db, k: string, v: string) => db.run('INSERT INTO kv(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', k, v)

export class TelegramService {
  private running = false
  private abort: AbortController | null = null
  private pairing: { code: string; expires: number } | null = null
  private botUsername?: string
  private lastError?: string
  private recent = new Map<number, number[]>()
  constructor(private db: Db, private secrets: SecretStore, private log: Logger, private bus: Bus, private handlers: TelegramHandlers, private baseUrl = 'https://api.telegram.org', private pollSeconds = 25) {}

  paired(): Chat[] { try { return JSON.parse(kvGet(this.db, 'telegram.paired') ?? '[]') } catch { return [] } }
  private setPaired(c: Chat[]) { kvSet(this.db, 'telegram.paired', JSON.stringify(c)) }
  status(): TelegramStatus {
    return { configured: this.secrets.has(TELEGRAM_TOKEN_SECRET), running: this.running, botUsername: this.botUsername, pairedChats: this.paired(),
      pairingCode: this.pairing && this.pairing.expires > Date.now() ? this.pairing.code : undefined, lastError: this.lastError }
  }

  private async api<T = any>(method: string, body?: object | FormData, signal?: AbortSignal): Promise<T> {
    const token = this.secrets.get(TELEGRAM_TOKEN_SECRET)
    if (!token) throw new Error('Telegram bot token is not configured.')
    const isForm = body instanceof FormData
    const res = await fetch(`${this.baseUrl}/bot${token}/${method}`, { method: 'POST', headers: isForm ? undefined : { 'content-type': 'application/json' }, body: isForm ? body : JSON.stringify(body ?? {}), signal })
    const j: any = await res.json().catch(() => ({}))
    if (!j.ok) throw new Error(`Telegram ${method} failed: ${j.description ?? res.status}`)
    return j.result as T
  }

  /** Validate the token with getMe, store it encrypted, start polling, and issue a one-time pairing code. */
  async connect(token: string): Promise<TelegramStatus> {
    token = token.trim()
    if (!/^\d{6,}:[A-Za-z0-9_-]{30,}$/.test(token)) throw new Error('That does not look like a Telegram bot token (expected 123456:ABC...). Create one with @BotFather.')
    const prev = this.secrets.get(TELEGRAM_TOKEN_SECRET)
    this.secrets.set(TELEGRAM_TOKEN_SECRET, token)
    try { const me = await this.api<{ username: string }>('getMe'); this.botUsername = me.username }
    catch (e) { if (prev) this.secrets.set(TELEGRAM_TOKEN_SECRET, prev); else this.secrets.delete(TELEGRAM_TOKEN_SECRET); throw e }
    await this.api('deleteWebhook', { drop_pending_updates: false }).catch(() => {})
    this.newPairingCode()
    this.start()
    return this.status()
  }
  newPairingCode(): string {
    const code = randomBytes(4).toString('hex').toUpperCase()
    this.pairing = { code, expires: Date.now() + 10 * 60_000 }
    return code
  }
  /** Instantly disconnect the phone: stop polling, forget the token and all paired accounts. */
  disconnect() {
    this.stop(); this.secrets.delete(TELEGRAM_TOKEN_SECRET); this.setPaired([]); this.pairing = null; this.botUsername = undefined
    this.db.run(`DELETE FROM kv WHERE key='telegram.offset'`)
  }

  start() {
    if (this.running || !this.secrets.has(TELEGRAM_TOKEN_SECRET)) return
    this.running = true; this.abort = new AbortController()
    void this.loop(this.abort.signal)
  }
  stop() { this.running = false; this.abort?.abort(); this.abort = null }

  private async loop(signal: AbortSignal) {
    if (!this.botUsername) await this.api<{ username: string }>('getMe', {}, signal).then((m) => { this.botUsername = m.username }).catch(() => {})
    let backoff = 1000
    while (this.running && !signal.aborted) {
      try {
        const offset = Number(kvGet(this.db, 'telegram.offset') ?? 0)
        const updates = await this.api<any[]>('getUpdates', { offset, timeout: this.pollSeconds, allowed_updates: ['message'] }, signal)
        this.lastError = undefined; backoff = 1000
        for (const u of updates) {
          kvSet(this.db, 'telegram.offset', String(u.update_id + 1))
          await this.handleUpdate(u).catch((e) => this.log.error('telegram', 'update handler failed', e))
        }
      } catch (e) {
        if (signal.aborted || !this.running) return
        this.lastError = (e as Error).message
        this.log.warn('telegram', `poll error: ${this.lastError}`)
        await new Promise((r) => setTimeout(r, backoff)); backoff = Math.min(backoff * 2, 30_000)
      }
    }
  }

  /** Exposed for tests. */
  async handleUpdate(u: any) {
    const m = u.message
    if (!m?.chat || !m.from || typeof m.text !== 'string') return
    // Only private chats where the sender is the chat owner are ever considered.
    if (m.chat.type !== 'private' || m.from.id !== m.chat.id || m.from.is_bot) { this.log.warn('telegram', 'ignored non-private/bot message'); return }
    const chat: Chat = { id: m.chat.id, name: [m.from.first_name, m.from.last_name].filter(Boolean).join(' ') || m.from.username || String(m.from.id) }
    const text: string = m.text.trim()
    const isPaired = this.paired().some((c) => c.id === chat.id)

    const pair = /^\/pair(?:@\w+)?\s+([A-Za-z0-9]{8})$/.exec(text)
    if (pair) {
      if (this.pairing && this.pairing.expires > Date.now() && pair[1].toUpperCase() === this.pairing.code) {
        if (!isPaired) this.setPaired([...this.paired(), chat])
        this.pairing = null
        this.log.info('telegram', `paired chat ${chat.id}`)
        this.bus.emit('telegram', { type: 'paired', chat })
        await this.sendTo(chat.id, `Paired. I'm JARVIS, an AI assistant running on your PC. Send me requests, or /stop to halt everything.`)
      } else this.log.warn('telegram', `bad pairing attempt from ${chat.id}`)
      return // no reply to a wrong code: do not confirm anything to strangers
    }
    if (!isPaired) { this.log.warn('telegram', `ignored message from unauthorised account ${chat.id}`); return }

    const now = Date.now(); const hits = (this.recent.get(chat.id) ?? []).filter((t) => now - t < 60_000)
    if (hits.length >= 15) { await this.sendTo(chat.id, 'Slow down: too many requests in the last minute.'); return }
    this.recent.set(chat.id, [...hits, now])

    if (/^\/stop\b/i.test(text)) { this.handlers.onStop(); await this.sendTo(chat.id, 'Emergency stop engaged: all tasks cancelled and actions blocked until you resume on the PC.'); return }
    if (/^\/(start|help)\b/i.test(text)) { await this.sendTo(chat.id, 'Send any request in plain text. Commands: /stop (emergency stop), /status.'); return }
    if (/^\/status\b/i.test(text)) { await this.sendTo(chat.id, 'JARVIS is running and listening to this chat.'); return }
    void this.api('sendChatAction', { chat_id: chat.id, action: 'typing' }).catch(() => {})
    const reply = await this.handlers.onMessage(text, chat).catch((e) => `Error: ${(e as Error).message}`)
    await this.sendTo(chat.id, reply)
  }

  private async sendTo(chatId: number, text: string) {
    const chunks = text.match(/[\s\S]{1,3900}/g) ?? ['(empty)']
    for (const c of chunks) await this.api('sendMessage', { chat_id: chatId, text: c })
  }
  /** Send to all paired chats (the only recipients that are ever allowed). */
  async notify(text: string): Promise<number> {
    const chats = this.paired()
    if (!chats.length) throw new Error('No phone is paired. Pair your Telegram account in Messaging first.')
    for (const c of chats) await this.sendTo(c.id, text)
    return chats.length
  }
  async sendFile(path: string, caption?: string): Promise<number> {
    const chats = this.paired()
    if (!chats.length) throw new Error('No phone is paired.')
    const st = await fs.stat(path)
    if (st.size > 45 * 1024 * 1024) throw new Error('File is larger than the 50 MB Telegram bot limit.')
    const data = await fs.readFile(path)
    for (const c of chats) {
      const form = new FormData()
      form.set('chat_id', String(c.id)); if (caption) form.set('caption', caption.slice(0, 1000))
      form.set('document', new Blob([data]), basename(path))
      await this.api('sendDocument', form)
    }
    return chats.length
  }
}

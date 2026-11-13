import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import type { Db } from './core/db'

/** Optional local app PIN (scrypt). While locked the main process refuses privileged IPC. */
export class AppLock {
  private locked: boolean
  private fails = 0
  private lockedUntil = 0
  constructor(private db: Db, pinEnabled: boolean) { this.locked = pinEnabled && this.hasPin() }
  private hasPin() { return !!this.db.get(`SELECT 1 FROM kv WHERE key='security.pin'`) }
  isLocked() { return this.locked }
  setPin(pin: string) {
    if (!/^\d{4,12}$/.test(pin)) throw new Error('PIN must be 4–12 digits.')
    const salt = randomBytes(16); const h = scryptSync(pin, salt, 32)
    this.db.run(`INSERT INTO kv(key,value) VALUES('security.pin',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, `${salt.toString('hex')}:${h.toString('hex')}`)
  }
  verify(pin: string): boolean {
    if (Date.now() < this.lockedUntil) throw new Error(`Too many attempts. Try again in ${Math.ceil((this.lockedUntil - Date.now()) / 1000)}s.`)
    const v = this.db.get<{ value: string }>(`SELECT value FROM kv WHERE key='security.pin'`)?.value
    if (!v) return true
    const [salt, hash] = v.split(':')
    const ok = timingSafeEqual(scryptSync(pin, Buffer.from(salt, 'hex'), 32), Buffer.from(hash, 'hex'))
    if (ok) { this.fails = 0; return true }
    if (++this.fails >= 5) { this.lockedUntil = Date.now() + 30_000; this.fails = 0 }
    return false
  }
  unlock(pin: string): boolean { const ok = this.verify(pin); if (ok) this.locked = false; return ok }
  lock() { if (this.hasPin()) this.locked = true }
  clearPin(pin: string): boolean { if (!this.verify(pin)) return false; this.db.run(`DELETE FROM kv WHERE key='security.pin'`); this.locked = false; return true }
  pinSet() { return this.hasPin() }
}

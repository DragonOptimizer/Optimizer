import type { Db } from './db'

export interface Encryptor {
  available(): boolean
  encrypt(plain: string): Buffer
  decrypt(blob: Buffer): string
}

/**
 * Secrets (API keys, OAuth tokens) are only ever stored encrypted. In the app the Encryptor is Electron's
 * safeStorage (Windows DPAPI, bound to the signed-in Windows user). If encryption is unavailable we REFUSE to store
 * rather than falling back to plaintext.
 */
export class SecretStore {
  constructor(private db: Db, private enc: Encryptor) {}
  available() { return this.enc.available() }
  set(name: string, value: string) {
    if (!this.enc.available()) throw new Error('Secure storage is unavailable on this system; refusing to store secrets in plaintext.')
    this.db.run(`INSERT INTO secrets(name,blob,updated_at) VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET blob=excluded.blob, updated_at=excluded.updated_at`,
      name, this.enc.encrypt(value), Date.now())
  }
  get(name: string): string | undefined {
    const r = this.db.get<{ blob: Uint8Array }>('SELECT blob FROM secrets WHERE name=?', name)
    if (!r) return undefined
    try { return this.enc.decrypt(Buffer.from(r.blob)) } catch { return undefined }
  }
  has(name: string): boolean { return !!this.db.get('SELECT 1 FROM secrets WHERE name=?', name) }
  delete(name: string) { this.db.run('DELETE FROM secrets WHERE name=?', name) }
  deleteAll() { this.db.run('DELETE FROM secrets') }
  names(): string[] { return this.db.all<{ name: string }>('SELECT name FROM secrets').map((r) => r.name) }
}

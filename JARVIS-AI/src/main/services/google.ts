import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { GoogleStatus } from '@shared/types'
import type { SecretStore } from '../core/secrets'
import type { Logger } from '../core/logger'
import type { Db } from '../core/db'

export const GOOGLE_SCOPES = {
  gmailRead: 'https://www.googleapis.com/auth/gmail.readonly',
  gmailCompose: 'https://www.googleapis.com/auth/gmail.compose',
  gmailModify: 'https://www.googleapis.com/auth/gmail.modify',
  courses: 'https://www.googleapis.com/auth/classroom.courses.readonly',
  coursework: 'https://www.googleapis.com/auth/classroom.coursework.me.readonly',
  announcements: 'https://www.googleapis.com/auth/classroom.announcements.readonly',
  materials: 'https://www.googleapis.com/auth/classroom.courseworkmaterials.readonly',
  driveRead: 'https://www.googleapis.com/auth/drive.readonly',
  email: 'https://www.googleapis.com/auth/userinfo.email'
}
const S = { token: 'google.tokens', secret: 'google.clientSecret' }
interface Tokens { access_token: string; refresh_token?: string; expires_at: number; scope: string }

export interface GoogleEndpoints { auth: string; token: string; revoke: string; api: { gmail: string; classroom: string; drive: string; userinfo: string } }
export const REAL_ENDPOINTS: GoogleEndpoints = {
  auth: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token', revoke: 'https://oauth2.googleapis.com/revoke',
  api: { gmail: 'https://gmail.googleapis.com/gmail/v1', classroom: 'https://classroom.googleapis.com/v1', drive: 'https://www.googleapis.com/drive/v3', userinfo: 'https://openidconnect.googleapis.com/v1/userinfo' }
}
export const b64url = (b: Buffer) => b.toString('base64url')

/**
 * Google OAuth 2.0 (installed-app loopback + PKCE) using the user's OWN Google Cloud OAuth client.
 * Tokens are stored encrypted. Expired access tokens are refreshed automatically; if refresh fails the user is asked to reconnect.
 */
export class GoogleAuth {
  constructor(private secrets: SecretStore, private db: Db, private log: Logger, private clientId: () => string, private openExternal: (url: string) => Promise<void>, private ep: GoogleEndpoints = REAL_ENDPOINTS) {}

  private tokens(): Tokens | undefined { const s = this.secrets.get(S.token); return s ? JSON.parse(s) : undefined }
  status(): GoogleStatus {
    const t = this.tokens()
    return { connected: !!t, email: this.db.get<{ value: string }>(`SELECT value FROM kv WHERE key='google.email'`)?.value, scopes: t ? t.scope.split(' ') : [], clientConfigured: !!this.clientId() }
  }
  setClientSecret(secret: string) { secret ? this.secrets.set(S.secret, secret) : this.secrets.delete(S.secret) }

  /** Opens the system browser for consent, waits for the loopback redirect, and exchanges the code. */
  async connect(scopes: string[], timeoutMs = 180_000): Promise<GoogleStatus> {
    const clientId = this.clientId()
    if (!clientId) throw new Error('Enter your Google OAuth Client ID first (see the setup guide).')
    const verifier = b64url(randomBytes(48)), challenge = b64url(createHash('sha256').update(verifier).digest()), state = b64url(randomBytes(16))
    const code = await new Promise<{ code: string; redirect: string }>((resolve, reject) => {
      let redirect = ''
      const srv = createServer((req, res) => {
        const u = new URL(req.url ?? '/', 'http://127.0.0.1')
        if (u.pathname !== '/callback') { res.writeHead(404).end(); return }
        const done = (msg: string, ok: boolean) => { res.writeHead(200, { 'content-type': 'text/html' }).end(`<html><body style="font-family:sans-serif;background:#07111f;color:#bfefff;padding:40px"><h2>${msg}</h2><p>You can close this tab and return to JARVIS.</p></body></html>`); srv.close(); clearTimeout(timer) ; void ok }
        if (u.searchParams.get('state') !== state) { done('Authorisation failed (state mismatch).', false); reject(new Error('OAuth state mismatch')); return }
        const err = u.searchParams.get('error'), c = u.searchParams.get('code')
        if (err || !c) { done(`Authorisation was not granted (${err ?? 'no code'}).`, false); reject(new Error(`Google authorisation failed: ${err ?? 'no code'}`)); return }
        done('JARVIS is connected to Google.', true)
        resolve({ code: c, redirect })
      })
      const timer = setTimeout(() => { srv.close(); reject(new Error('Timed out waiting for Google sign-in.')) }, timeoutMs)
      srv.listen(0, '127.0.0.1', () => {
        redirect = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/callback`
        const url = new URL(this.ep.auth)
        for (const [k, v] of Object.entries({ client_id: clientId, redirect_uri: redirect, response_type: 'code', scope: scopes.join(' '), state, code_challenge: challenge, code_challenge_method: 'S256', access_type: 'offline', prompt: 'consent' })) url.searchParams.set(k, v)
        void this.openExternal(url.href).catch(reject)
      })
    })
    const t = await this.tokenRequest({ grant_type: 'authorization_code', code: code.code, redirect_uri: code.redirect, code_verifier: verifier })
    this.save(t)
    try {
      const me = await this.request(`${this.ep.api.userinfo}`)
      this.db.run(`INSERT INTO kv(key,value) VALUES('google.email',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, me.email ?? '')
    } catch { /* email scope may not be granted */ }
    return this.status()
  }
  async disconnect() {
    const t = this.tokens()
    if (t) await fetch(`${this.ep.revoke}?token=${encodeURIComponent(t.refresh_token ?? t.access_token)}`, { method: 'POST' }).catch(() => {})
    this.secrets.delete(S.token); this.db.run(`DELETE FROM kv WHERE key='google.email'`)
  }

  private save(t: any, prev?: Tokens) {
    const tokens: Tokens = { access_token: t.access_token, refresh_token: t.refresh_token ?? prev?.refresh_token, expires_at: Date.now() + (t.expires_in ?? 3600) * 1000 - 60_000, scope: t.scope ?? prev?.scope ?? '' }
    this.secrets.set(S.token, JSON.stringify(tokens))
  }
  private async tokenRequest(params: Record<string, string>) {
    const body = new URLSearchParams({ client_id: this.clientId(), ...params })
    const secret = this.secrets.get(S.secret); if (secret) body.set('client_secret', secret)
    const res = await fetch(this.ep.token, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body })
    const j: any = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(`Google token error: ${j.error ?? res.status}${j.error_description ? ` (${j.error_description})` : ''}`)
    return j
  }
  async accessToken(): Promise<string> {
    const t = this.tokens()
    if (!t) throw new Error('Google is not connected. Open Connected apps → Google and sign in.')
    if (t.expires_at > Date.now()) return t.access_token
    if (!t.refresh_token) { this.secrets.delete(S.token); throw new Error('Google session expired. Please reconnect Google.') }
    try { const n = await this.tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh_token }); this.save(n, t); return n.access_token }
    catch (e) {
      if (/invalid_grant/.test((e as Error).message)) { this.secrets.delete(S.token); throw new Error('Google session expired or was revoked. Please reconnect Google.') }
      throw e
    }
  }
  async request(url: string, init: { method?: string; body?: unknown; raw?: boolean } = {}): Promise<any> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const tok = await this.accessToken()
      const res = await fetch(url, { method: init.method ?? (init.body ? 'POST' : 'GET'), headers: { authorization: `Bearer ${tok}`, ...(init.body ? { 'content-type': 'application/json' } : {}) }, body: init.body ? JSON.stringify(init.body) : undefined })
      if (res.status === 401 && attempt === 0) { const t = this.tokens(); if (t) this.secrets.set(S.token, JSON.stringify({ ...t, expires_at: 0 })); continue }
      if (init.raw && res.ok) return Buffer.from(await res.arrayBuffer())
      const j: any = await res.json().catch(() => ({}))
      if (!res.ok) {
        const msg = j.error?.message ?? res.statusText
        if (res.status === 403 && /insufficient|scope/i.test(msg)) throw new Error(`Google denied access: missing permission (${msg}). Reconnect Google and grant the requested access.`)
        if (res.status === 403 || res.status === 400 && /disabled|not been used/i.test(msg)) throw new Error(`Google API refused the request: ${msg}. Your school/workspace admin may restrict this API, or the API is not enabled in your Cloud project.`)
        throw new Error(`Google API error ${res.status}: ${msg}`)
      }
      return j
    }
    throw new Error('Google authorisation failed after refresh; please reconnect.')
  }
}

import type { CallRecord, PhoneStatus, Settings } from '@shared/types'
import type { Db } from '../core/db'
import type { SecretStore } from '../core/secrets'
import type { Logger } from '../core/logger'
import { newId, now } from '../core/ids'

export const TWILIO_SID = 'twilio.accountSid', TWILIO_TOKEN = 'twilio.authToken'
export const E164 = /^\+[1-9]\d{7,14}$/
const xml = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]!))
const VOICE = /^[A-Za-z0-9.\-]{2,40}$/
const mins = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m }

/** Twilio Programmable Voice, one-way spoken calls to the user's own verified number only. */
export class PhoneService {
  constructor(private db: Db, private secrets: SecretStore, private getSettings: () => Settings, private log: Logger, private base = 'https://api.twilio.com', private pricingBase = 'https://pricing.twilio.com') {}

  private kv(k: string) { return this.db.get<{ value: string }>('SELECT value FROM kv WHERE key=?', k)?.value }
  isStopped() { return this.kv('phone.stopped') === '1' }
  setStopped(v: boolean) { this.db.run(`INSERT INTO kv(key,value) VALUES('phone.stopped',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, v ? '1' : '0') }
  credentialsConfigured() { return this.secrets.has(TWILIO_SID) && this.secrets.has(TWILIO_TOKEN) }
  setCredentials(sid: string, token: string) {
    if (!/^AC[0-9a-fA-F]{32}$/.test(sid.trim())) throw new Error('Account SID should look like ACxxxxxxxx… (34 characters).')
    if (token.trim().length < 20) throw new Error('Auth token looks too short.')
    this.secrets.set(TWILIO_SID, sid.trim()); this.secrets.set(TWILIO_TOKEN, token.trim())
  }
  clearCredentials() { this.secrets.delete(TWILIO_SID); this.secrets.delete(TWILIO_TOKEN) }
  private auth() { return 'Basic ' + Buffer.from(`${this.secrets.get(TWILIO_SID)}:${this.secrets.get(TWILIO_TOKEN)}`).toString('base64') }

  spentThisMonthUsd(): number {
    const d = new Date(); const start = new Date(d.getFullYear(), d.getMonth(), 1).getTime()
    return this.db.get<{ s: number }>(`SELECT COALESCE(SUM(est_cost_usd),0) AS s FROM calls WHERE ts>=? AND status NOT IN ('blocked','failed')`, start)?.s ?? 0
  }
  status(): PhoneStatus { const s = this.getSettings().phone; return { configured: this.credentialsConfigured() && E164.test(s.userNumber) && E164.test(s.callerNumber), enabled: s.callsEnabled, spentThisMonthUsd: this.spentThisMonthUsd(), stopped: this.isStopped() } }
  history(limit = 100): CallRecord[] {
    return this.db.all('SELECT * FROM calls ORDER BY ts DESC LIMIT ?', limit).map((r: any) => ({ id: r.id, ts: r.ts, to: r.to_number, status: r.status, sid: r.sid ?? undefined, durationSec: r.duration_sec ?? undefined, estCostUsd: r.est_cost_usd, reason: r.reason }))
  }
  /** Worst-case cost estimate for one call, from the user's per-minute rate. Returns null if the rate is unknown. */
  estimateMaxCost(): number | null {
    const p = this.getSettings().phone
    if (!(p.estCostPerMinuteUsd > 0)) return null
    return Math.ceil(p.maxCallSeconds / 60) * p.estCostPerMinuteUsd
  }
  /** Look up the real outbound per-minute rate for the user's number from Twilio's Pricing API. */
  async fetchRate(): Promise<number> {
    const p = this.getSettings().phone
    if (!E164.test(p.userNumber)) throw new Error('Enter your phone number first.')
    const res = await fetch(`${this.pricingBase}/v2/Voice/Numbers/${encodeURIComponent(p.userNumber)}`, { headers: { authorization: this.auth() } })
    const j: any = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(`Twilio pricing lookup failed: ${j.message ?? res.status}`)
    const price = Number(j.outbound_call_price?.current_price ?? j.outbound_call_price?.base_price)
    if (!(price > 0)) throw new Error('Twilio did not return a price for that destination.')
    return price
  }

  /** All the gates a call must pass. Returns an error string, or null if the call may proceed. */
  gate(at = new Date()): string | null {
    const s = this.getSettings().phone
    if (this.isStopped()) return 'Calling is stopped (emergency stop). Resume it in Phone Calls.'
    if (!s.callsEnabled) return 'Phone calling is switched off. Enable it in Phone Calls after reviewing the costs.'
    if (!s.callsAcknowledgedCosts) return 'You have not yet acknowledged the provider charges.'
    if (!this.credentialsConfigured()) return 'Twilio credentials are not configured.'
    if (!E164.test(s.userNumber)) return 'Your phone number is missing or not in international format (+15551234567).'
    if (!E164.test(s.callerNumber)) return 'The Twilio caller number is missing or not in international format.'
    if (s.userNumber === s.callerNumber) return 'The caller number and your number must be different.'
    const cur = at.getHours() * 60 + at.getMinutes(), a = mins(s.callWindowStart), b = mins(s.callWindowEnd)
    if (!(a <= b ? cur >= a && cur <= b : cur >= a || cur <= b)) return `Outside your preferred calling hours (${s.callWindowStart}–${s.callWindowEnd}).`
    const est = this.estimateMaxCost()
    if (s.monthlySpendLimitUsd > 0) {
      if (est === null) return 'Set your per-minute rate (or use "Look up my rate") so the spending limit can be enforced.'
      if (this.spentThisMonthUsd() + est > s.monthlySpendLimitUsd) return `This call could exceed your monthly spending limit ($${s.monthlySpendLimitUsd.toFixed(2)}; spent so far ≈ $${this.spentThisMonthUsd().toFixed(2)}).`
    }
    return null
  }

  async placeCall(message: string, reason: string, at = new Date()): Promise<CallRecord> {
    const s = this.getSettings().phone
    const err = this.gate(at)
    const id = newId()
    if (err) { this.db.run('INSERT INTO calls(id,ts,to_number,status,est_cost_usd,reason) VALUES(?,?,?,?,0,?)', id, now(), s.userNumber || '-', 'blocked', `${reason} — ${err}`); throw new Error(err) }
    const voice = VOICE.test(s.callVoice) ? s.callVoice : 'Polly.Matthew'
    const twiml = `<Response><Say voice="${xml(voice)}">${xml(message.slice(0, 1200))}</Say><Pause length="1"/><Say voice="${xml(voice)}">This was an automated reminder from your J.A.R.V.I.S. A.I. assistant. Goodbye.</Say></Response>`
    const est = this.estimateMaxCost() ?? 0
    const body = new URLSearchParams({ To: s.userNumber, From: s.callerNumber, Twiml: twiml, TimeLimit: String(s.maxCallSeconds) })
    const res = await fetch(`${this.base}/2010-04-01/Accounts/${this.secrets.get(TWILIO_SID)}/Calls.json`, { method: 'POST', headers: { authorization: this.auth(), 'content-type': 'application/x-www-form-urlencoded' }, body })
    const j: any = await res.json().catch(() => ({}))
    if (!res.ok) {
      this.db.run('INSERT INTO calls(id,ts,to_number,status,est_cost_usd,reason) VALUES(?,?,?,?,0,?)', id, now(), s.userNumber, 'failed', `${reason} — ${j.message ?? res.status}`)
      throw new Error(`Twilio rejected the call: ${j.message ?? res.status}${j.code ? ` (code ${j.code})` : ''}`)
    }
    this.db.run('INSERT INTO calls(id,ts,to_number,status,sid,est_cost_usd,reason) VALUES(?,?,?,?,?,?,?)', id, now(), s.userNumber, j.status ?? 'queued', j.sid, est, reason)
    this.log.info('phone', `call placed sid=${j.sid}`)
    return this.history(1)[0]
  }

  /** Refresh status/duration/actual price of recent calls from Twilio. */
  async refresh(): Promise<void> {
    if (!this.credentialsConfigured()) return
    const rows = this.db.all<any>(`SELECT * FROM calls WHERE sid IS NOT NULL AND status IN ('queued','ringing','in-progress','initiated') AND ts>?`, now() - 6 * 3600_000)
    for (const r of rows) {
      const res = await fetch(`${this.base}/2010-04-01/Accounts/${this.secrets.get(TWILIO_SID)}/Calls/${r.sid}.json`, { headers: { authorization: this.auth() } }).catch(() => null)
      if (!res?.ok) continue
      const j: any = await res.json()
      const price = j.price != null ? Math.abs(Number(j.price)) : r.est_cost_usd
      this.db.run('UPDATE calls SET status=?, duration_sec=?, est_cost_usd=? WHERE id=?', j.status, j.duration ? Number(j.duration) : null, price, r.id)
    }
  }
}

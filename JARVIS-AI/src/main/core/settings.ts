import type { Settings } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/defaults'
import type { Db } from './db'
import type { Bus } from './events'

type Plain = Record<string, any>
const isObj = (v: unknown): v is Plain => !!v && typeof v === 'object' && !Array.isArray(v)

/** Deep-merge `patch` into `base`, only accepting keys that exist in `base` and have the same primitive type. */
export function mergeKnown<T extends Plain>(base: T, patch: Plain): T {
  const out: Plain = Array.isArray(base) ? [...base] : { ...base }
  for (const k of Object.keys(patch)) {
    if (!(k in base)) continue
    const b = (base as Plain)[k], p = patch[k]
    if (isObj(b) && isObj(p)) out[k] = mergeKnown(b, p)
    else if (Array.isArray(b) && Array.isArray(p)) out[k] = p.filter((x) => typeof x === typeof (b[0] ?? x))
    else if (typeof b === typeof p) out[k] = p
  }
  return out as T
}

export class SettingsStore {
  private cache: Settings
  constructor(private db: Db, private bus?: Bus) {
    let cur: Settings = structuredClone(DEFAULT_SETTINGS)
    for (const r of db.all<{ key: string; value: string }>('SELECT key,value FROM settings')) {
      try { cur = mergeKnown(cur, { [r.key]: JSON.parse(r.value) }) } catch { /* ignore corrupt row */ }
    }
    this.cache = cur
  }
  get(): Settings { return structuredClone(this.cache) }
  update(patch: Plain): Settings {
    const next = mergeKnown(this.cache as unknown as Plain, patch) as unknown as Settings
    next.ai.maxSteps = clamp(next.ai.maxSteps, 1, 25)
    next.voice.speechRate = clamp(next.voice.speechRate, 0.5, 2)
    next.voice.listenTimeoutSec = clamp(next.voice.listenTimeoutSec, 3, 60)
    next.phone.maxCallSeconds = clamp(next.phone.maxCallSeconds, 10, 900)
    next.phone.monthlySpendLimitUsd = Math.max(0, next.phone.monthlySpendLimitUsd)
    next.security.approvalTimeoutSec = clamp(next.security.approvalTimeoutSec, 10, 900)
    this.db.tx(() => {
      for (const k of Object.keys(next) as (keyof Settings)[]) {
        this.db.run(`INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, k, JSON.stringify(next[k]))
      }
    })
    this.cache = next
    this.bus?.emit('settings', this.get())
    return this.get()
  }
}
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo))

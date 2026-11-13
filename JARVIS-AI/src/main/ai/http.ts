import { ProviderError } from './types'

export interface FetchOpts { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal; timeoutMs?: number; retries?: number; backoffMs?: number }

const RETRY_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504, 529])
const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((res, rej) => {
  const t = setTimeout(res, ms)
  signal?.addEventListener('abort', () => { clearTimeout(t); rej(new ProviderError('cancelled')) }, { once: true })
})

/** fetch + JSON with timeout, bounded retry/backoff for transient errors, and readable error messages. */
export async function fetchJson<T = any>(url: string, o: FetchOpts = {}): Promise<T> {
  const retries = o.retries ?? 2
  let last: ProviderError | undefined
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (o.signal?.aborted) throw new ProviderError('cancelled')
    const ac = new AbortController()
    const t = setTimeout(() => ac.abort(), o.timeoutMs ?? 90_000)
    const onAbort = () => ac.abort()
    o.signal?.addEventListener('abort', onAbort, { once: true })
    try {
      const res = await fetch(url, { method: o.method ?? 'POST', headers: { 'content-type': 'application/json', ...o.headers }, body: o.body, signal: ac.signal })
      const text = await res.text()
      if (!res.ok) {
        let detail = text.slice(0, 400)
        try { const j = JSON.parse(text); detail = j.error?.message ?? j.error ?? j.message ?? detail } catch { /* not json */ }
        const retryable = RETRY_STATUS.has(res.status)
        const hint = res.status === 401 || res.status === 403 ? ' (check the API key / permissions)' : res.status === 429 ? ' (rate limited or out of quota)' : ''
        last = new ProviderError(`HTTP ${res.status}: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}${hint}`, res.status, retryable)
        if (!retryable) throw last
      } else {
        return (text ? JSON.parse(text) : {}) as T
      }
    } catch (e) {
      if (e instanceof ProviderError) { if (!e.retryable) throw e; last = e }
      else if (o.signal?.aborted) throw new ProviderError('cancelled')
      else last = new ProviderError(ac.signal.aborted ? `Request timed out after ${(o.timeoutMs ?? 90_000) / 1000}s` : `Network error: ${(e as Error).message}`, undefined, true)
    } finally {
      clearTimeout(t)
      o.signal?.removeEventListener('abort', onAbort)
    }
    if (attempt < retries) await sleep((o.backoffMs ?? 800) * 2 ** attempt, o.signal)
  }
  throw last ?? new ProviderError('Request failed')
}

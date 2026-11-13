import { createServer, type IncomingMessage, type Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCore, type CoreOptions } from '../src/main/core/container'
import type { Encryptor } from '../src/main/core/secrets'

/** Test-only reversible encryptor (the app uses Electron safeStorage / Windows DPAPI). */
export const testEncryptor: Encryptor = {
  available: () => true,
  encrypt: (s) => Buffer.from('ENC:' + Buffer.from(s).reverse().toString('base64')),
  decrypt: (b) => Buffer.from(b.toString().slice(4), 'base64').reverse().toString()
}

export function tmpDir(prefix = 'jarvis-test-') { const d = mkdtempSync(join(tmpdir(), prefix)); return { dir: d, cleanup: () => rmSync(d, { recursive: true, force: true }) } }
export function makeCore(extra: Partial<CoreOptions> = {}, dbPath = ':memory:') { return createCore({ dbPath, encryptor: testEncryptor, ...extra }) }

export interface MockServer { url: string; requests: { method: string; url: string; headers: IncomingMessage['headers']; body: any }[]; close(): Promise<void>; setHandler(h: Handler): void }
type Handler = (req: { method: string; url: string; headers: IncomingMessage['headers']; body: any }, res: import('node:http').ServerResponse) => void

export async function mockServer(handler: Handler): Promise<MockServer> {
  const requests: MockServer['requests'] = []
  let h = handler
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString()
      let body: any = raw
      try { body = raw ? JSON.parse(raw) : undefined } catch { /* keep raw */ }
      const r = { method: req.method ?? 'GET', url: req.url ?? '/', headers: req.headers, body }
      requests.push(r)
      h(r, res)
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as any).port
  return { url: `http://127.0.0.1:${port}`, requests, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()) }), setHandler: (x) => { h = x } }
}
export const json = (res: import('node:http').ServerResponse, obj: unknown, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)) }

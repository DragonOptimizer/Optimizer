import { arch, cpus, freemem, hostname, platform, release, totalmem, uptime } from 'node:os'
import { promises as fs } from 'node:fs'
import type { Tool } from '../core/tools'
import type { MemoryStore } from '../core/memory'
import type { SettingsStore } from '../core/settings'
import type { Host } from './host'
import type { FileSandbox } from './files'
import { checkUrl } from './browser'

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim()
}

export async function extractPdfText(data: Uint8Array, maxChars = 60_000): Promise<{ text: string; pages: number }> {
  const { extractText, getDocumentProxy } = await import('unpdf')
  const pdf = await getDocumentProxy(new Uint8Array(data))
  const { text, totalPages } = await extractText(pdf, { mergePages: true })
  return { text: (Array.isArray(text) ? text.join('\n') : text).slice(0, maxChars), pages: totalPages }
}

export function builtinTools(o: { memory: MemoryStore; settings: SettingsStore; host: Host; sandbox: FileSandbox }): Tool[] {
  return [
    {
      name: 'get_datetime', category: 'system', risk: 'safe', description: 'Get the current local date, time and time zone.', inputSchema: { type: 'object', properties: {} }, summarize: () => 'Checking the time',
      async run() { return { content: `${new Date().toString()} (${Intl.DateTimeFormat().resolvedOptions().timeZone})` } }
    },
    {
      name: 'system_info', category: 'system', risk: 'safe', description: 'Basic information about this computer (OS, CPU, memory, uptime).', inputSchema: { type: 'object', properties: {} }, summarize: () => 'Reading system info',
      async run() {
        const c = cpus()
        return { content: `Host ${hostname()} · ${platform()} ${release()} ${arch()} · CPU ${c[0]?.model} ×${c.length} · RAM ${(freemem() / 2 ** 30).toFixed(1)} GB free of ${(totalmem() / 2 ** 30).toFixed(1)} GB · uptime ${(uptime() / 3600).toFixed(1)} h` }
      }
    },
    {
      name: 'remember', category: 'memory', risk: 'moderate', unattendedOk: false, description: 'Save a durable fact or preference about the user to persistent memory. Never store passwords, tokens or financial data.',
      inputSchema: { type: 'object', required: ['content'], properties: { content: { type: 'string', maxLength: 500 }, kind: { type: 'string', enum: ['preference', 'fact', 'goal', 'project', 'note'] } } },
      summarize: (a) => `Remembering: ${String(a.content).slice(0, 80)}`,
      async run(a) { const m = o.memory.add(a.content, a.kind ?? 'note'); return { content: `Saved to memory (${m.kind}): ${m.content}` } }
    },
    {
      name: 'recall', category: 'memory', risk: 'safe', description: 'Search persistent memory.', inputSchema: { type: 'object', required: ['query'], properties: { query: { type: 'string' } } }, summarize: (a) => `Searching memory for "${a.query}"`,
      async run(a) { const r = o.memory.search(a.query, 10); return { content: r.length ? r.map((m) => `(${m.id.slice(0, 8)}) [${m.kind}] ${m.content}`).join('\n') : 'Nothing in memory matches.' } }
    },
    {
      name: 'forget', category: 'memory', risk: 'moderate', description: 'Delete a memory by the id prefix shown by recall.', inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string', minLength: 4 } as any } }, summarize: (a) => `Forgetting memory ${a.id}`,
      async run(a) {
        const hit = o.memory.list().filter((m) => m.id.startsWith(a.id))
        if (hit.length !== 1) throw new Error(hit.length ? 'Ambiguous id' : 'No such memory')
        o.memory.delete(hit[0].id); return { content: `Forgot: ${hit[0].content}` }
      }
    },
    {
      name: 'notify_user', category: 'system', risk: 'moderate', unattendedOk: true, description: 'Show a desktop notification (and optionally speak it aloud).',
      inputSchema: { type: 'object', required: ['message'], properties: { title: { type: 'string', maxLength: 80 }, message: { type: 'string', maxLength: 400 }, speak: { type: 'boolean' } } },
      summarize: (a) => `Showing notification: ${String(a.message).slice(0, 60)}`,
      async run(a) { o.host.notify(a.title ?? 'JARVIS', a.message); if (a.speak) o.host.speak(a.message); return { content: 'Notification shown.' } }
    },
    {
      name: 'fetch_url', category: 'web', risk: 'moderate', untrusted: true, taintExempt: true, unattendedOk: true, timeoutMs: 30_000,
      description: 'Download a web page over HTTP(S) without opening the browser and return its text (no JavaScript). Good for quick reads of articles/docs.',
      inputSchema: { type: 'object', required: ['url'], properties: { url: { type: 'string', maxLength: 2000 } } }, summarize: (a) => `Fetching ${a.url}`,
      async run(a, ctx) {
        const u = checkUrl(a.url, o.settings.get().computer.allowLocalBrowsing)
        const res = await fetch(u, { signal: ctx.signal, redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 JARVIS-Assistant' } })
        const final = checkUrl(res.url, o.settings.get().computer.allowLocalBrowsing)
        const ct = res.headers.get('content-type') ?? ''
        if (!res.ok) throw new Error(`HTTP ${res.status} from ${final.host}`)
        if (/pdf/.test(ct)) { const { text, pages } = await extractPdfText(new Uint8Array(await res.arrayBuffer())); return { content: `PDF (${pages} pages):\n${text}` } }
        if (!/text|json|xml/.test(ct)) throw new Error(`Unsupported content type ${ct}`)
        const body = (await res.text()).slice(0, 2_000_000)
        return { content: `URL: ${final.href}\n${/html/.test(ct) ? htmlToText(body) : body}` }
      }
    },
    {
      name: 'pdf_read', category: 'files', risk: 'safe', untrusted: true, description: 'Extract text from a PDF file in an allowed folder (e.g. a Classroom PDF saved to Downloads).',
      inputSchema: { type: 'object', required: ['path'], properties: { path: { type: 'string' } } }, summarize: (a) => `Reading PDF ${a.path}`,
      async run(a) {
        const p = o.sandbox.check(a.path)
        const { text, pages } = await extractPdfText(new Uint8Array(await fs.readFile(p)))
        if (!text.trim()) return { content: `PDF has ${pages} page(s) but no extractable text (it may be scanned images; OCR is not supported).` }
        return { content: `PDF "${p}" (${pages} pages):\n${text}` }
      }
    }
  ]
}

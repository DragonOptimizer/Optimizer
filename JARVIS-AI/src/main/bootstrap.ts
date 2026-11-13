import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { arch, cpus, freemem, platform, release, totalmem } from 'node:os'
import type { DiagnosticCheck, ScheduleChannel, ScheduleRecord } from '@shared/types'
import { createCore } from './core/container'
import type { Encryptor } from './core/secrets'
import type { Host } from './tools/host'
import { FileSandbox, fileTools } from './tools/files'
import { builtinTools } from './tools/builtin'
import { computerTools } from './tools/computer'
import { BrowserManager, browserTools } from './tools/browser'
import { googleTools, phoneTools, scheduleTools, videoTools } from './tools/integrations'
import { VideoService } from './services/video'
import { GoogleAuth, GOOGLE_SCOPES, type GoogleEndpoints, REAL_ENDPOINTS } from './services/google'
import { GmailApi } from './services/gmail'
import { ClassroomApi } from './services/classroom'
import { PhoneService } from './services/phone'
import { TelegramService } from './services/telegram'
import { Scheduler } from './services/scheduler'
import { SpeechService, type SpeechEndpoints } from './services/stt'
import { WakeWordService } from './services/wakeword'
import { providerConfigured, makeProvider } from './ai'
import { newId } from './core/ids'

export interface BootstrapOptions {
  dataDir: string
  host: Host
  encryptor: Encryptor
  version?: string
  googleEndpoints?: GoogleEndpoints
  telegramBase?: string
  twilioBase?: string
  speech?: SpeechEndpoints
  providerBaseUrl?: string
  ffmpegPath?: string
  startServices?: boolean
}

const run = (cmd: string, args: string[], timeout = 4000) => new Promise<string | null>((res) => execFile(cmd, args, { timeout, windowsHide: true }, (e, out) => res(e ? null : String(out).trim())))

export async function findBrowsers(): Promise<string[]> {
  const found: string[] = []
  if (platform() === 'win32') {
    const pf = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA].filter(Boolean) as string[]
    for (const base of pf) for (const rel of ['Google\\Chrome\\Application\\chrome.exe', 'Microsoft\\Edge\\Application\\msedge.exe']) { const p = join(base, rel); if (existsSync(p)) found.push(p) }
  } else for (const b of ['google-chrome', 'chromium', 'microsoft-edge']) { const p = await run('which', [b]); if (p) found.push(p) }
  return found
}

export function bootstrap(o: BootstrapOptions) {
  const { host } = o
  const core = createCore({
    dbPath: join(o.dataDir, 'jarvis.db'), logFile: join(o.dataDir, 'logs', 'jarvis.log'), encryptor: o.encryptor,
    providerOverride: o.providerBaseUrl ? () => makeProvider(core.settings.get().ai.provider, () => core.settings.get(), core.secrets, o.providerBaseUrl) : undefined
  })
  const metrics: Record<string, number[]> = { stt_ms: [], llm_task_ms: [], tts_ms: [] }
  const sample = (k: string, v: number) => { const a = metrics[k] ?? (metrics[k] = []); a.push(Math.round(v)); if (a.length > 20) a.shift() }

  const sandbox = new FileSandbox(host, core.settings)
  const video = new VideoService(join(host.userDirs.workspace, 'videos'), o.ffmpegPath ?? 'ffmpeg', o.ffmpegPath ? o.ffmpegPath.replace(/ffmpeg(\.exe)?$/i, (m) => m.replace('ffmpeg', 'ffprobe')) : 'ffprobe')
  const speech = new SpeechService(core.secrets, () => core.settings.get(), o.speech)
  const ep = o.googleEndpoints ?? REAL_ENDPOINTS
  const google = new GoogleAuth(core.secrets, core.db, core.log, () => core.settings.get().google.clientId, (u) => host.openExternal(u), ep)
  const gmail = new GmailApi(google, ep), classroom = new ClassroomApi(google, ep)
  const phone = new PhoneService(core.db, core.secrets, () => core.settings.get(), core.log, o.twilioBase, o.twilioBase)
  const browser = new BrowserManager(host, core.settings, core.log)

  const stopAll = (reason: string) => {
    core.perms.setStopped(true); core.agent.cancelAll(); core.perms.denyAllPending(reason); phone.setStopped(true)
    void browser.close(); wake.stop()
    core.log.warn('stop', `EMERGENCY STOP: ${reason}`); core.bus.emit('stop', { reason })
  }
  const resume = () => { core.perms.setStopped(false); phone.setStopped(false); applyWake() }

  const telegramConv = () => {
    const k = core.db.get<{ value: string }>(`SELECT value FROM kv WHERE key='telegram.conversation'`)?.value
    if (k && core.db.get('SELECT 1 FROM conversations WHERE id=?', k)) return k
    const id = core.conversations.create('Telegram'); core.db.run(`INSERT INTO kv(key,value) VALUES('telegram.conversation',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, id); return id
  }
  const telegram = new TelegramService(core.db, core.secrets, core.log, core.bus, {
    onMessage: async (text, chat) => {
      core.log.info('telegram', `request from paired chat ${chat.id}`)
      const r = await core.agent.run({ text, source: 'telegram', unattended: true, conversationId: telegramConv() }); return r.reply
    },
    onStop: () => stopAll('Stopped from paired phone')
  }, o.telegramBase)

  const deliver = async (channels: ScheduleChannel[], title: string, text: string): Promise<string> => {
    const results: string[] = [], failures: string[] = []
    for (const ch of channels) {
      try {
        if (ch === 'notification') { host.notify(title, text); results.push('notification: shown') }
        else if (ch === 'speech') { core.bus.emit('speak', { text: `${title}. ${text}` }); results.push('speech: requested') }
        else if (ch === 'telegram') { const n = await telegram.notify(`${title}\n${text}`); results.push(`telegram: sent to ${n} chat(s)`) }
        else if (ch === 'call') { const c = await phone.placeCall(`${title}. ${text}`, `Scheduled: ${title}`); results.push(`call: ${c.status}`) }
      } catch (e) { failures.push(`${ch}: ${(e as Error).message}`) }
    }
    if (!results.length) throw new Error(failures.join(' | ') || 'No delivery channels')
    return [...results, ...failures.map((f) => `FAILED ${f}`)].join('; ')
  }
  const scheduler = new Scheduler(core.db, {
    async fire(s: ScheduleRecord) {
      let text = s.message
      if (s.kind === 'agent') {
        const r = await core.agent.run({ text: s.message, source: 'scheduler', unattended: true, ephemeral: true })
        if (r.status !== 'completed') throw new Error(`Workflow ${r.status}: ${r.reply.slice(0, 200)}`)
        text = r.reply
      }
      return deliver(s.channels, s.title, text)
    }
  }, core.log)

  const wake = new WakeWordService(core.log, (c) => { core.log.info('wakeword', `wake phrase heard (confidence ${c})`); core.bus.emit('ptt', { mode: 'wake' }) })
  const applyWake = () => { const v = core.settings.get().voice; if (v.enabled && v.wakeWordEnabled && !v.muted && !core.perms.isStopped()) wake.start(v.wakePhrase); else wake.stop() }

  for (const t of [...builtinTools({ memory: core.memory, settings: core.settings, host, sandbox }), ...fileTools(sandbox, host), ...computerTools({ host }), ...browserTools(browser),
    ...googleTools(gmail, classroom, core.settings), ...scheduleTools(scheduler), ...phoneTools(telegram, phone, sandbox),
    ...videoTools(video, sandbox, core.settings, core.secrets, () => speech.sttBase())]) core.tools.register(t)

  const startedAt = Date.now()
  core.bus.on('activity', (e) => { if (e.kind === 'task' && ['completed', 'failed', 'cancelled'].includes(e.status)) { const t = core.tasks.list(1)[0]; if (t?.finishedAt) sample('llm_task_ms', t.finishedAt - t.startedAt) } })

  async function diagnostics(): Promise<DiagnosticCheck[]> {
    const ck: DiagnosticCheck[] = []
    const add = (id: string, label: string, status: DiagnosticCheck['status'], detail: string) => ck.push({ id, label, status, detail })
    add('os', 'Operating system', platform() === 'win32' ? 'ok' : 'warn', `${platform()} ${release()} ${arch()} · ${cpus().length} CPU threads · ${(freemem() / 2 ** 30).toFixed(1)}/${(totalmem() / 2 ** 30).toFixed(1)} GB RAM free`)
    if (platform() !== 'win32') add('os-support', 'Windows automation', 'warn', 'Computer-control tools use Windows APIs and are disabled on this OS.')
    try { core.db.get('SELECT 1'); add('db', 'Database', 'ok', `SQLite OK at ${join(o.dataDir, 'jarvis.db')}`) } catch (e) { add('db', 'Database', 'fail', (e as Error).message) }
    add('secure', 'Secure credential storage', core.secrets.available() ? 'ok' : 'fail', core.secrets.available() ? 'Windows DPAPI via Electron safeStorage (keys encrypted for your Windows account).' : 'Unavailable: API keys cannot be saved.')
    const online = await fetch('https://www.gstatic.com/generate_204', { signal: AbortSignal.timeout(4000) }).then((r) => r.status === 204 || r.ok).catch(() => false)
    add('net', 'Internet', online ? 'ok' : 'fail', online ? 'Reachable.' : 'No internet. Cloud AI/voice and integrations are unavailable (Ollama still works).')
    const s = core.settings.get()
    const prov = s.ai.provider
    add('ai', 'AI provider', providerConfigured(prov, core.secrets) ? 'ok' : 'warn', providerConfigured(prov, core.secrets) ? `${prov} · model ${s.ai.models[prov]}` : `${prov}: no API key saved (Settings → AI).`)
    const ff = await video.available(); add('ffmpeg', 'FFmpeg (video)', ff.ok ? 'ok' : 'warn', ff.ok ? ff.version! : `${ff.error} Install: winget install Gyan.FFmpeg`)
    const br = await findBrowsers(); add('browser', 'Chrome / Edge (browser automation)', br.length ? 'ok' : 'warn', br.length ? br.join(', ') : 'No Chrome/Edge found.')
    add('stt', 'Speech recognition', speech.sttReady() ? 'ok' : 'warn', speech.sttReady() ? `${s.voice.sttProvider} (${s.voice.sttModel})` : 'No speech-to-text key configured: voice input needs one (push-to-talk).')
    const ws = wake.getStatus(); add('wake', 'Wake word', !s.voice.wakeWordEnabled ? 'unknown' : ws.active ? 'ok' : 'warn', !s.voice.wakeWordEnabled ? 'Disabled.' : ws.active ? `Listening offline for "${s.voice.wakePhrase}".` : ws.error ?? 'Not running.')
    const tg = telegram.status(); add('telegram', 'Telegram', tg.running ? 'ok' : tg.configured ? 'warn' : 'unknown', tg.configured ? `Bot @${tg.botUsername ?? '?'} · ${tg.pairedChats.length} paired${tg.lastError ? ' · ' + tg.lastError : ''}` : 'Not configured.')
    const gs = google.status(); add('google', 'Google (Gmail/Classroom)', gs.connected ? 'ok' : 'unknown', gs.connected ? `Connected as ${gs.email ?? 'unknown'}` : gs.clientConfigured ? 'Client ID set; not signed in.' : 'Not configured.')
    const ps = phone.status(); add('phone', 'Phone calls', ps.stopped ? 'warn' : ps.configured && ps.enabled ? 'ok' : 'unknown', `${ps.configured ? 'configured' : 'not configured'} · ${ps.enabled ? 'enabled' : 'disabled'}${ps.stopped ? ' · STOPPED' : ''} · spent this month ≈ $${ps.spentThisMonthUsd.toFixed(2)}`)
    add('sched', 'Scheduler', 'ok', `${scheduler.list().filter((x) => x.enabled).length} active schedule(s)`)
    const errs = core.log.recent(500).filter((l) => l.level === 'error').length; add('logs', 'Recent errors', errs ? 'warn' : 'ok', `${errs} error entries in the current session log.`)
    const avg = (k: string) => metrics[k]?.length ? `${Math.round(metrics[k].reduce((a, b) => a + b, 0) / metrics[k].length)} ms avg over ${metrics[k].length}` : 'no samples yet'
    add('perf', 'Measured performance (this PC)', 'unknown', `Speech recognition: ${avg('stt_ms')} · Task completion: ${avg('llm_task_ms')} · Speech synthesis: ${avg('tts_ms')} · Uptime ${Math.round((Date.now() - startedAt) / 60000)} min`)
    return ck
  }

  function wipe(scope: 'conversations' | 'memory' | 'history' | 'secrets' | 'everything') {
    if (scope === 'conversations' || scope === 'everything') core.conversations.clearAll()
    if (scope === 'memory' || scope === 'everything') core.memory.clear()
    if (scope === 'history' || scope === 'everything') { core.activity.clear(); core.audit.clear(); core.db.run('DELETE FROM tasks'); core.db.run('DELETE FROM usage'); core.db.run('DELETE FROM calls'); core.db.run('DELETE FROM schedule_runs') }
    if (scope === 'secrets' || scope === 'everything') { telegram.disconnect(); void google.disconnect(); core.secrets.deleteAll(); core.perms.revokeGrants() }
  }

  if (o.startServices !== false) { core.tasks.recoverCrashed(); scheduler.start(); telegram.start(); applyWake() }
  void newId; void GOOGLE_SCOPES
  return { ...core, sandbox, video, speech, google, gmail, classroom, phone, telegram, scheduler, browser, wake, applyWake, deliver, stopAll, resume, diagnostics, wipe, metrics, sample, shutdown: async () => { scheduler.stop(); telegram.stop(); wake.stop(); await browser.close(); core.db.close() } }
}
export type App = ReturnType<typeof bootstrap>

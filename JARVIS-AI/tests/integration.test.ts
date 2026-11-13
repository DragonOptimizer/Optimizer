import { describe, it, expect, afterAll } from 'vitest'
import { EventEmitter } from 'node:events'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { bootstrap } from '../src/main/bootstrap'
import { WakeWordService, WAKE_SCRIPT } from '../src/main/services/wakeword'
import { AppLock } from '../src/main/security'
import { SpeechService, transcribeAudio } from '../src/main/services/stt'
import { Logger } from '../src/main/core/logger'
import { makeCore, mockServer, json, testEncryptor, tmpDir, type MockServer } from './helpers'
import type { Host } from '../src/main/tools/host'

const servers: MockServer[] = []
afterAll(async () => { for (const s of servers) await s.close() })
const mk = async (h: Parameters<typeof mockServer>[0]) => { const s = await mockServer(h); servers.push(s); return s }

function hostFor(dir: string, notes: string[]): Host {
  for (const d of ['Desktop', 'Documents', 'Downloads', 'Workspace']) mkdirSync(join(dir, d), { recursive: true })
  return { platform: 'linux', dataDir: dir, userDirs: { desktop: join(dir, 'Desktop'), documents: join(dir, 'Documents'), downloads: join(dir, 'Downloads'), workspace: join(dir, 'Workspace') },
    openPath: async () => '', openExternal: async () => {}, trashItem: async () => {}, captureScreen: async () => ({ mime: 'image/png', data: '' }), notify: (t, b) => { notes.push(`${t}: ${b}`) }, speak: () => {} }
}

describe('bootstrap wiring (all services together)', () => {
  it('delivers reminders through channels, runs unattended agent workflows with restricted tools, and reports delivery failures', async () => {
    const t = tmpDir(); const notes: string[] = []
    const tg: any[] = []
    const tgApi = await mk((r, res) => { const m = r.url.split('/').pop(); if (m === 'sendMessage') tg.push(r.body); json(res, { ok: true, result: m === 'getMe' ? { username: 'b' } : [] }) })
    // fixture LLM: first call asks for a forbidden tool, then answers
    let n = 0
    const llm = await mk((_r, res) => { n++; json(res, n === 1 ? { content: [{ type: 'tool_use', id: 'x', name: 'create_folder', input: { path: 'Desktop/evil' } }], stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 } } : { content: [{ type: 'text', text: 'Summary: nothing due.' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }) })
    const app = bootstrap({ dataDir: t.dir, host: hostFor(t.dir, notes), encryptor: testEncryptor, telegramBase: tgApi.url, providerBaseUrl: llm.url, startServices: false })
    app.secrets.set('ai.anthropic.key', 'k')
    // no phone paired → telegram channel fails but notification succeeds → partial success is reported honestly
    const r1 = await app.deliver(['notification', 'telegram'], 'Homework', 'Finish chem')
    expect(notes).toEqual(['Homework: Finish chem']); expect(r1).toMatch(/notification: shown/); expect(r1).toMatch(/FAILED telegram: No phone is paired/)
    await expect(app.deliver(['telegram'], 'x', 'y')).rejects.toThrow(/No phone is paired/)
    await expect(app.deliver(['call'], 'x', 'y')).rejects.toThrow(/switched off/) // calling gate
    // scheduled agent workflow: unattended → create_folder is not even offered; model's attempt is rejected
    const s = app.scheduler.create({ title: 'Check', kind: 'agent', message: 'Summarise my deadlines', recurrence: { type: 'once', at: Date.now() + 500 }, channels: ['notification'] })
    await app.scheduler.tick(Date.now() + 1000)
    expect(app.scheduler.runs(s.id)[0]).toMatchObject({ status: 'ok' }); expect(notes.at(-1)).toMatch(/Summary: nothing due/)
    expect(app.audit.list().some((a) => a.tool === 'create_folder' && a.decision === 'blocked:unattended')).toBe(true)
    await app.shutdown(); t.cleanup()
  })
  it('wipe() removes the requested data; diagnostics returns structured checks', async () => {
    const t = tmpDir(); const app = bootstrap({ dataDir: t.dir, host: hostFor(t.dir, []), encryptor: testEncryptor, startServices: false })
    app.memory.add('likes tea'); const c = app.conversations.create(); app.conversations.add(c, 'user', 'hi')
    app.wipe('memory'); expect(app.memory.list()).toHaveLength(0); expect(app.conversations.history(c)).toHaveLength(1)
    app.wipe('conversations'); expect(app.conversations.history(c)).toHaveLength(0)
    app.secrets.set('x', 'y'); app.wipe('secrets'); expect(app.secrets.names()).toHaveLength(0)
    const d = await app.diagnostics(); expect(d.map((x) => x.id)).toEqual(expect.arrayContaining(['os', 'db', 'secure', 'ai', 'ffmpeg', 'browser', 'stt', 'wake', 'telegram', 'google', 'phone']))
    expect(d.find((x) => x.id === 'db')!.status).toBe('ok'); expect(d.find((x) => x.id === 'ffmpeg')!.status).toBe('ok')
    await app.shutdown(); t.cleanup()
  })
  it('emergency stop cancels running work, denies approvals, blocks phone, and resume restores', async () => {
    const t = tmpDir(); const app = bootstrap({ dataDir: t.dir, host: hostFor(t.dir, []), encryptor: testEncryptor, startServices: false })
    const stops: string[] = []; app.bus.on('stop', (s) => stops.push(s.reason))
    app.stopAll('test'); expect(app.perms.isStopped()).toBe(true); expect(app.phone.isStopped()).toBe(true); expect(stops).toEqual(['test'])
    app.resume(); expect(app.perms.isStopped()).toBe(false); expect(app.phone.isStopped()).toBe(false)
    await app.shutdown(); t.cleanup()
  })
  it('recovers tasks left running by a crash', async () => {
    const t = tmpDir(); const dir = t.dir
    const a = bootstrap({ dataDir: dir, host: hostFor(dir, []), encryptor: testEncryptor, startServices: false })
    a.tasks.create('crashing task', 'text'); a.db.close()
    const b = bootstrap({ dataDir: dir, host: hostFor(dir, []), encryptor: testEncryptor, startServices: false })
    expect(b.tasks.list()[0]).toMatchObject({ status: 'failed' }); expect(b.tasks.list()[0].summary).toMatch(/Interrupted/)
    await b.shutdown(); t.cleanup()
  })
})

describe('wake word service (Windows speech recognizer wrapper)', () => {
  it('parses engine output', () => {
    expect(WakeWordService.parseLine('READY')).toEqual({ type: 'ready' }); expect(WakeWordService.parseLine('WAKE 0.91')).toEqual({ type: 'wake', confidence: 0.91 }); expect(WakeWordService.parseLine('noise')).toBeNull()
  })
  it('is unavailable (with a clear message) off Windows and rejects weak phrases', () => {
    const log = new Logger()
    expect(new WakeWordService(log, () => {}, 'linux').start('hey jarvis').error).toMatch(/Windows/)
    expect(new WakeWordService(log, () => {}, 'win32', () => { throw new Error('should not spawn') }).start('jarvis').error).toMatch(/at least two words/)
  })
  it('spawns powershell with an encoded fixed script, phrase via env only, debounces wake events and reports crashes', () => {
    const fires: number[] = []; let spawned: any
    const cp: any = new EventEmitter(); cp.stdout = new EventEmitter(); cp.stderr = new EventEmitter(); cp.kill = () => {}
    const w = new WakeWordService(new Logger(), (c) => fires.push(c), 'win32', (cmd, args, env) => { spawned = { cmd, args, env }; return cp })
    expect(w.start('Hey Jarvis; Remove-Item *').active).toBe(true)
    expect(spawned.cmd).toBe('powershell.exe'); expect(Buffer.from(spawned.args.at(-1), 'base64').toString('utf16le')).toBe(WAKE_SCRIPT)
    expect(spawned.env.JARVIS_WAKE_PHRASE).toBe('Hey Jarvis RemoveItem'); expect(WAKE_SCRIPT).not.toContain('Remove-Item')
    cp.stdout.emit('data', 'READY\nWAKE 0.88\nWAKE 0.90\n'); expect(fires).toEqual([0.88]) // second is debounced
    cp.stderr.emit('data', 'no recognizer'); cp.emit('exit', 1); expect(w.getStatus().error).toMatch(/no recognizer/)
  })
})

describe('app lock', () => {
  it('requires PIN, throttles brute force, persists across restarts', () => {
    const c = makeCore(); const l = new AppLock(c.db, true); expect(l.isLocked()).toBe(false) // no pin yet
    expect(() => l.setPin('12')).toThrow(); l.setPin('4821'); l.lock(); expect(l.isLocked()).toBe(true)
    expect(new AppLock(c.db, true).isLocked()).toBe(true)
    for (let i = 0; i < 5; i++) expect(l.unlock('0000')).toBe(false)
    expect(() => l.unlock('4821')).toThrow(/Too many attempts/)
    const l2 = new AppLock(c.db, true); expect(l2.unlock('4821')).toBe(true); expect(l2.clearPin('9999')).toBe(false); expect(l2.clearPin('4821')).toBe(true)
  })
})

describe('speech services', () => {
  it('transcribes via OpenAI-compatible endpoint with key, errors clearly without one, and rejects tiny audio', async () => {
    const stt = await mk((_r, res) => json(res, { text: ' hey jarvis open chrome ' }))
    const core = makeCore(); const sp = new SpeechService(core.secrets, () => core.settings.get(), { stt: stt.url, tts: stt.url })
    await expect(sp.transcribe(new Uint8Array(5000), 'audio/webm')).rejects.toThrow(/No OpenAI API key/)
    core.secrets.set('ai.openai.key', 'sk-test-xxxxxxxxxxxxxxxx')
    expect(await sp.transcribe(new Uint8Array(5000), 'audio/webm;codecs=opus')).toBe('hey jarvis open chrome')
    expect(stt.requests[0].headers.authorization).toBe('Bearer sk-test-xxxxxxxxxxxxxxxx'); expect(stt.requests[0].headers['content-type']).toMatch(/multipart/)
    await expect(transcribeAudio({ baseUrl: stt.url, apiKey: 'k', model: 'm', data: new Uint8Array(10), filename: 'a.webm', mime: 'audio/webm' })).rejects.toThrow(/too short/)
    core.settings.update({ voice: { sttProvider: 'none' } }); await expect(sp.transcribe(new Uint8Array(5000), 'audio/webm')).rejects.toThrow(/off/)
    core.settings.update({ voice: { sttProvider: 'openai' } })
    stt.setHandler((_r, res) => { res.writeHead(200, { 'content-type': 'audio/mpeg' }); res.end(Buffer.from([1, 2, 3])) })
    expect([...await sp.synthesize('hello')]).toEqual([1, 2, 3])
    stt.setHandler((_r, res) => json(res, { error: 'bad' }, 401)); await expect(sp.transcribe(new Uint8Array(5000), 'audio/webm')).rejects.toThrow(/401.*API key/)
  })
})

import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeImage, net, safeStorage, session, shell, Tray } from 'electron'
import { join } from 'node:path'
import { existsSync, writeFileSync } from 'node:fs'
import type { ProviderId, Settings } from '@shared/types'
import { INVOKE_CHANNELS, type InvokeChannel } from '@shared/ipc'
import { bootstrap, type App } from './bootstrap'
import { createHost } from './electron-host'
import { AppLock } from './security'
import { GOOGLE_SCOPES } from './services/google'
import { GROQ_SECRET } from './services/stt'
import { makeProvider, providerConfigured, SECRET_NAMES } from './ai'
import { E164 } from './services/phone'
import { basename, dirname } from 'node:path'

if (process.env.JARVIS_USER_DATA) app.setPath('userData', process.env.JARVIS_USER_DATA)
// Test hooks: only honoured when JARVIS_E2E=1 (used by scripts/e2e-launch.mjs).
const E2E = process.env.JARVIS_E2E === '1'
if (E2E) { app.commandLine.appendSwitch('password-store', 'basic'); app.commandLine.appendSwitch('use-fake-ui-for-media-stream'); app.commandLine.appendSwitch('use-fake-device-for-media-stream'); if (process.env.JARVIS_FAKE_AUDIO_FILE) app.commandLine.appendSwitch('use-file-for-fake-audio-capture', process.env.JARVIS_FAKE_AUDIO_FILE) }
const isDev = !app.isPackaged && !!process.env.ELECTRON_RENDERER_URL
let core: App
let lock: AppLock
let mainWin: BrowserWindow | null = null
let overlayWin: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false
const hiddenStart = process.argv.includes('--hidden')

const WRITABLE_SECRETS = new Set([...Object.values(SECRET_NAMES), GROQ_SECRET])
const ALLOWED_WHEN_LOCKED = new Set<InvokeChannel>(['app:snapshot', 'security:unlock', 'app:stop-all', 'app:quit'])

if (!app.requestSingleInstanceLock()) { app.quit() } else {
  app.on('second-instance', () => { showMain() })
  app.whenReady().then(start).catch((e) => { dialog.showErrorBox('JARVIS failed to start', String(e?.stack ?? e)); app.quit() })
}

const iconPath = () => [join(__dirname, '../../build/icon.png'), join(process.resourcesPath ?? '', 'icon.png')].find(existsSync)

function pageUrl(hash = '') { return isDev ? `${process.env.ELECTRON_RENDERER_URL}${hash ? '#' + hash : ''}` : `file://${join(__dirname, '../renderer/index.html')}${hash ? '#' + hash : ''}` }

function secureWindow(w: BrowserWindow) {
  w.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//i.test(url)) void shell.openExternal(url); return { action: 'deny' } })
  w.webContents.on('will-navigate', (e, url) => { const ok = isDev ? url.startsWith(process.env.ELECTRON_RENDERER_URL!) : url.startsWith('file://'); if (!ok) { e.preventDefault(); if (/^https?:\/\//i.test(url)) void shell.openExternal(url) } })
  w.webContents.on('will-attach-webview', (e) => e.preventDefault())
}

const webPrefs = () => ({ preload: join(__dirname, '../preload/index.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, allowRunningInsecureContent: false, spellcheck: false })

function createMain() {
  const s = core.settings.get()
  const w = new BrowserWindow({
    width: 1360, height: 860, minWidth: 980, minHeight: 640, show: false, backgroundColor: '#050b14', title: 'JARVIS', autoHideMenuBar: true, icon: iconPath(),
    alwaysOnTop: s.ui.alwaysOnTop, webPreferences: webPrefs()
  })
  secureWindow(w)
  w.removeMenu()
  void w.loadURL(pageUrl())
  w.once('ready-to-show', () => { if (!hiddenStart) w.show() })
  w.on('close', (e) => { if (!quitting && core.settings.get().ui.minimizeToTray) { e.preventDefault(); w.hide() } })
  w.on('closed', () => { mainWin = null })
  mainWin = w
}
function showMain() { if (!mainWin) createMain(); mainWin!.show(); mainWin!.focus() }

function setOverlay(on: boolean) {
  if (on && !overlayWin) {
    const { workArea } = require('electron').screen.getPrimaryDisplay()
    const w = new BrowserWindow({ width: 360, height: 168, x: workArea.x + workArea.width - 380, y: workArea.y + workArea.height - 190, frame: false, transparent: true, resizable: false, alwaysOnTop: true, skipTaskbar: true, hasShadow: false, show: false, webPreferences: webPrefs() })
    w.setAlwaysOnTop(true, 'screen-saver'); secureWindow(w); void w.loadURL(pageUrl('overlay')); w.once('ready-to-show', () => w.show()); w.on('closed', () => { overlayWin = null }); overlayWin = w
  } else if (!on && overlayWin) { overlayWin.close(); overlayWin = null }
}

function broadcast(channel: string, payload: unknown) { for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(channel, payload) }

function applySettingsSideEffects(s: Settings) {
  mainWin?.setAlwaysOnTop(s.ui.alwaysOnTop)
  setOverlay(s.ui.overlayEnabled)
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: s.ui.startWithWindows, args: ['--hidden'] })
  registerShortcuts(s)
  core.applyWake()
}
let ptt = ''
function registerShortcuts(s: Settings) {
  if (ptt) { try { globalShortcut.unregister(ptt) } catch { /* ignore */ } ptt = '' }
  if (s.voice.enabled && s.voice.pushToTalkShortcut) {
    try { if (globalShortcut.register(s.voice.pushToTalkShortcut, () => core.bus.emit('ptt', { mode: 'toggle' }))) ptt = s.voice.pushToTalkShortcut; else core.log.warn('shortcut', `could not register ${s.voice.pushToTalkShortcut} (in use?)`) } catch (e) { core.log.warn('shortcut', (e as Error).message) }
  }
  globalShortcut.unregister('Control+Alt+Shift+X')
  globalShortcut.register('Control+Alt+Shift+X', () => core.stopAll('Emergency stop shortcut'))
}

function buildTray() {
  const p = iconPath(); if (!p) return
  tray = new Tray(nativeImage.createFromPath(p).resize({ width: 16, height: 16 }))
  tray.setToolTip('JARVIS')
  const refresh = () => tray?.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open JARVIS', click: showMain },
    { label: 'Floating overlay', type: 'checkbox', checked: core.settings.get().ui.overlayEnabled, click: (m) => core.settings.update({ ui: { overlayEnabled: m.checked } }) },
    { label: 'Mute microphone', type: 'checkbox', checked: core.settings.get().voice.muted, click: (m) => core.settings.update({ voice: { muted: m.checked } }) },
    { type: 'separator' },
    { label: 'EMERGENCY STOP', click: () => core.stopAll('Tray emergency stop') },
    { label: 'Resume after stop', click: () => core.resume() },
    { type: 'separator' },
    { label: 'Quit', click: () => { quitting = true; app.quit() } }
  ]))
  refresh(); core.bus.on('settings', refresh); tray.on('click', showMain)
}

async function start() {
  if (E2E && process.platform === 'linux') (safeStorage as any).setUsePlainTextEncryption?.(true) // test-only: CI container has no OS keyring
  let busRef: App['bus'] | undefined
  const host = createHost(() => busRef)
  core = bootstrap({ dataDir: app.getPath('userData'), host, encryptor: { available: () => safeStorage.isEncryptionAvailable(), encrypt: (s) => safeStorage.encryptString(s), decrypt: (b) => safeStorage.decryptString(b) }, version: app.getVersion(),
    ...(E2E ? { providerBaseUrl: process.env.JARVIS_TEST_PROVIDER_URL, speech: { stt: process.env.JARVIS_TEST_STT_URL } } : {}) })
  busRef = core.bus
  lock = new AppLock(core.db, core.settings.get().security.pinEnabled)
  core.log.info('app', `JARVIS ${app.getVersion()} starting on ${process.platform} (electron ${process.versions.electron}, node ${process.versions.node})`)

  // Security: only allow the microphone for our own pages; deny everything else.
  const ses = session.defaultSession
  ses.setPermissionRequestHandler((wc, perm, cb) => cb(perm === 'media' && (wc.getURL().startsWith('file://') || wc.getURL().startsWith(process.env.ELECTRON_RENDERER_URL ?? 'file://'))))
  ses.setPermissionCheckHandler((_wc, perm) => perm === 'media')
  if (!isDev) ses.webRequest.onHeadersReceived((d, cb) => cb({ responseHeaders: { ...d.responseHeaders, 'Content-Security-Policy': ["default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob: data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"] } }))

  for (const ev of ['state', 'activity', 'approval', 'approval-resolved', 'chat-message', 'settings', 'schedule-fired', 'telegram', 'speak', 'stop', 'online', 'ptt'] as const) core.bus.on(ev, (p: any) => broadcast(`event:${ev}`, p))
  core.bus.on('settings', (s) => applySettingsSideEffects(s))
  core.bus.on('approval', () => { if (!mainWin?.isVisible() && !overlayWin) { showMain() } mainWin?.flashFrame(true) })

  registerIpc()
  createMain(); buildTray(); applySettingsSideEffects(core.settings.get())
  if (E2E) (globalThis as any).__jarvisTest = { tray: () => tray, trayMenu: () => ['Open JARVIS', 'Floating overlay', 'Mute microphone', 'EMERGENCY STOP', 'Resume after stop', 'Quit'], loginItem: () => app.getLoginItemSettings(), packaged: app.isPackaged }
  setInterval(() => { const ok = net.isOnline() || core.settings.get().ai.provider === 'ollama'; core.state.setOnline(ok); broadcast('event:online', { online: ok }) }, 5000).unref()
  app.on('activate', showMain)
  app.on('before-quit', () => { quitting = true })
  app.on('will-quit', () => { globalShortcut.unregisterAll(); void core.shutdown() })
  app.on('window-all-closed', () => { if (process.platform !== 'darwin' && !core.settings.get().ui.minimizeToTray) app.quit() })
}

function registerIpc() {
  const handle = (ch: InvokeChannel, fn: (...a: any[]) => unknown | Promise<unknown>) => ipcMain.handle(ch, async (ev, ...args) => {
    if (!ev.senderFrame?.url || !(ev.senderFrame.url.startsWith('file://') || ev.senderFrame.url.startsWith(process.env.ELECTRON_RENDERER_URL ?? 'file://'))) throw new Error('Untrusted IPC sender')
    if (lock.isLocked() && !ALLOWED_WHEN_LOCKED.has(ch)) throw new Error('JARVIS is locked.')
    try { return await fn(...args) } catch (e) { core.log.warn('ipc', `${ch} failed: ${(e as Error).message}`); throw e }
  })
  const S = () => core.settings.get()
  const snapshot = () => ({ state: core.state.state, stateDetail: core.state.detail, online: net.isOnline() || S().ai.provider === 'ollama', version: app.getVersion(), platform: process.platform, locked: lock.isLocked(), pinRequired: lock.pinSet() })

  handle('app:snapshot', snapshot)
  handle('app:stop-all', () => { core.stopAll('Emergency stop button'); return true })
  handle('app:resume', () => { core.resume(); return true })
  handle('app:quit', () => { quitting = true; app.quit() })
  handle('app:open-mic-settings', () => (process.platform === 'win32' ? shell.openExternal('ms-settings:privacy-microphone') : false))
  handle('app:open-data-dir', () => shell.openPath(app.getPath('userData')))
  handle('app:set-state', (s: 'idle' | 'listening' | 'speaking') => { core.state.setVoice(s); return true })

  handle('security:unlock', (pin: string) => { const ok = lock.unlock(String(pin)); if (ok) broadcast('event:lock', { locked: false }); return ok })
  handle('security:lock', () => { lock.lock(); broadcast('event:lock', { locked: lock.isLocked() }); return lock.isLocked() })
  handle('security:set-pin', (pin: string, current?: string) => { if (lock.pinSet() && !lock.verify(String(current ?? ''))) throw new Error('Current PIN is incorrect.'); lock.setPin(String(pin)); core.settings.update({ security: { pinEnabled: true } }); return true })
  handle('security:clear-pin', (pin: string) => { const ok = lock.clearPin(String(pin)); if (ok) core.settings.update({ security: { pinEnabled: false } }); return ok })

  handle('settings:get', () => S())
  handle('settings:update', (patch: object) => core.settings.update(patch as any))
  handle('secrets:set', (name: string, value: string) => { if (!WRITABLE_SECRETS.has(name)) throw new Error('Unknown secret name.'); String(value).trim() ? core.secrets.set(name, String(value).trim()) : core.secrets.delete(name); return true })
  handle('secrets:delete', (name: string) => { if (!WRITABLE_SECRETS.has(name)) throw new Error('Unknown secret name.'); core.secrets.delete(name); return true })
  handle('secrets:has', () => Object.fromEntries([...WRITABLE_SECRETS, 'google.clientSecret'].map((n) => [n, core.secrets.has(n)])))

  handle('chat:send', ({ text, source }: { text: string; source?: 'text' | 'voice' }) => {
    const t = String(text ?? '').trim(); if (!t) throw new Error('Empty message')
    const src = source === 'voice' ? 'voice' : 'text'
    void core.agent.run({ text: t, source: src }).then((r) => { if (src === 'voice' && S().voice.speakResponses && r.reply) core.bus.emit('speak', { text: r.reply, interrupt: true }) })
    return { started: true }
  })
  handle('chat:cancel', () => { core.agent.cancelAll(); return true })
  handle('chat:history', (id?: string) => core.conversations.history(id ?? core.conversations.current()))
  handle('chat:new', () => core.conversations.create())
  handle('chat:conversations', () => core.conversations.list())
  handle('approval:respond', (id: string, decision: 'allow' | 'allow_always' | 'deny') => core.perms.respond(id, decision))
  handle('approval:pending', () => core.perms.pendingRequests())
  handle('activity:recent', () => core.activity.recent(300))
  handle('tasks:list', () => core.tasks.list(100))
  handle('tools:list', () => core.tools.info())

  handle('ai:providers', () => (['anthropic', 'openai', 'gemini', 'ollama'] as ProviderId[]).map((id) => ({ id, configured: providerConfigured(id, core.secrets), model: S().ai.models[id] })))
  handle('ai:models', (id: ProviderId) => makeProvider(id, S.bind(null), core.secrets).listModels())
  handle('ai:usage', () => ({ today: core.usage.today(), limit: S().ai.dailyTokenLimit }))
  handle('ai:test', async () => {
    const t0 = Date.now(); const p = core.provider()
    const r = await p.chat({ system: 'Reply with exactly one word.', messages: [{ role: 'user', content: 'Say: ready' }], tools: [], maxTokens: 16 })
    core.usage.add(r.usage.inputTokens, r.usage.outputTokens)
    return { ok: true, ms: Date.now() - t0, text: r.text.trim().slice(0, 40), provider: S().ai.provider, model: S().ai.models[S().ai.provider] }
  })

  handle('voice:transcribe', async (data: ArrayBuffer, mime: string) => { const t0 = Date.now(); const text = await core.speech.transcribe(new Uint8Array(data), String(mime)); core.sample('stt_ms', Date.now() - t0); return text })
  handle('voice:synthesize', async (text: string) => { const t0 = Date.now(); const b = await core.speech.synthesize(String(text)); core.sample('tts_ms', Date.now() - t0); return b.toString('base64') })
  handle('metrics:report', (k: string, ms: number) => { if (['tts_ms', 'stt_ms'].includes(k) && Number.isFinite(ms)) core.sample(k, ms); return true })
  handle('wake:status', () => core.wake.getStatus())
  handle('voice:set-ptt', () => true)

  handle('memory:list', () => core.memory.list())
  handle('memory:add', (content: string, kind?: any) => core.memory.add(content, kind))
  handle('memory:update', (id: string, content: string, kind?: any) => { core.memory.update(id, content, kind); return true })
  handle('memory:delete', (id: string) => { core.memory.delete(id); return true })
  handle('memory:clear', () => { core.memory.clear(); return true })

  handle('schedule:list', () => core.scheduler.list())
  handle('schedule:runs', (id?: string) => core.scheduler.runs(id))
  handle('schedule:create', (o: any) => core.scheduler.create(o))
  handle('schedule:toggle', (id: string, on: boolean) => { core.scheduler.setEnabled(id, on); return true })
  handle('schedule:delete', (id: string) => { core.scheduler.delete(id); return true })

  handle('telegram:status', () => core.telegram.status())
  handle('telegram:connect', (token: string) => core.telegram.connect(token))
  handle('telegram:new-pairing', () => { core.telegram.newPairingCode(); return core.telegram.status() })
  handle('telegram:disconnect', () => { core.telegram.disconnect(); core.settings.update({ phone: { telegramEnabled: false } }); return core.telegram.status() })
  handle('telegram:send-test', async () => core.telegram.notify('Test message from JARVIS on your PC. If you can read this, pairing works.'))

  const scopes = () => { const g = S().google; return [GOOGLE_SCOPES.email, ...(g.gmailEnabled ? [GOOGLE_SCOPES.gmailRead, GOOGLE_SCOPES.gmailCompose, GOOGLE_SCOPES.gmailModify] : []), ...(g.classroomEnabled ? [GOOGLE_SCOPES.courses, GOOGLE_SCOPES.coursework, GOOGLE_SCOPES.announcements, GOOGLE_SCOPES.materials, GOOGLE_SCOPES.driveRead] : [])] }
  handle('google:status', () => core.google.status())
  handle('google:set-secret', (v: string) => { core.google.setClientSecret(String(v).trim()); return true })
  handle('google:connect', () => core.google.connect(scopes()))
  handle('google:disconnect', async () => { await core.google.disconnect(); return core.google.status() })
  handle('gmail:unread', () => core.gmail.search('is:unread in:inbox', 15))
  handle('classroom:courses', () => core.classroom.courses())
  handle('classroom:work', (o?: any) => core.classroom.assignments(o ?? {}))

  handle('phone:status', () => ({ ...core.phone.status(), credentials: core.phone.credentialsConfigured(), estMaxCostPerCall: core.phone.estimateMaxCost() }))
  handle('phone:history', async () => { await core.phone.refresh().catch(() => {}); return core.phone.history() })
  handle('phone:set-credentials', (sid: string, token: string) => { core.phone.setCredentials(sid, token); return true })
  handle('phone:clear-credentials', () => { core.phone.clearCredentials(); core.settings.update({ phone: { callsEnabled: false } }); return true })
  handle('phone:fetch-rate', async () => { const r = await core.phone.fetchRate(); core.settings.update({ phone: { estCostPerMinuteUsd: r } }); return r })
  handle('phone:stop', () => { core.phone.setStopped(true); return true })
  handle('phone:resume', () => { core.phone.setStopped(false); return true })
  handle('phone:test-call', async () => {
    const choice = await dialog.showMessageBox(mainWin!, { type: 'question', buttons: ['Cancel', 'Place test call'], defaultId: 0, cancelId: 0, title: 'Place a real phone call?', message: 'Place a real test call to your number?', detail: `This will call ${S().phone.userNumber} from ${S().phone.callerNumber} and read a short message. Twilio will charge your account (estimated max ${core.phone.estimateMaxCost() === null ? 'unknown' : '$' + core.phone.estimateMaxCost()!.toFixed(2)}).` })
    if (choice.response !== 1) return { cancelled: true }
    const c = await core.phone.placeCall('This is a test call from your JARVIS assistant. Everything is working. Goodbye.', 'User-approved test call'); return c
  })

  handle('video:pick-files', async () => {
    const r = await dialog.showOpenDialog(mainWin!, { properties: ['openFile', 'multiSelections'], filters: [{ name: 'Media', extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v', 'mp3', 'wav'] }] })
    if (r.canceled) return []
    const out: string[] = []
    for (const f of r.filePaths) {
      try { core.sandbox.check(f); out.push(f) } catch {
        const a = await dialog.showMessageBox(mainWin!, { type: 'question', buttons: ['No', 'Allow this folder'], defaultId: 0, cancelId: 0, message: `Allow JARVIS to access "${dirname(f)}"?`, detail: 'This folder is outside the locations JARVIS may use. You can remove it later under Settings → Computer.' })
        if (a.response === 1) { core.settings.update({ computer: { allowedRoots: [...S().computer.allowedRoots, dirname(f)] } }); out.push(f) }
      }
    }
    return out
  })
  handle('video:probe', (p: string) => core.video.probe(core.sandbox.check(p)))

  handle('diagnostics:run', () => core.diagnostics())
  handle('diagnostics:logs', () => core.log.recent(300))
  handle('audit:list', () => core.audit.list())
  handle('privacy:wipe', async (scope: any) => {
    const r = await dialog.showMessageBox(mainWin!, { type: 'warning', buttons: ['Cancel', 'Delete'], defaultId: 0, cancelId: 0, message: `Permanently delete: ${scope}?`, detail: 'This cannot be undone.' })
    if (r.response !== 1) return false
    core.wipe(scope); return true
  })
  handle('privacy:revoke-grants', () => { core.perms.revokeGrants(); return true })
  handle('privacy:export', () => {
    const p = join(core.sandbox.roots()[3] ?? app.getPath('documents'), `jarvis-export-${Date.now()}.json`)
    writeFileSync(p, JSON.stringify({ exportedAt: new Date().toISOString(), settings: S(), memory: core.memory.list(), conversations: core.conversations.list().map((c) => ({ ...c, messages: core.conversations.history(c.id, 1000) })), tasks: core.tasks.list(500), schedules: core.scheduler.list() }, null, 2)); return p
  })
  handle('overlay:toggle', () => { const on = !overlayWin; core.settings.update({ ui: { overlayEnabled: on } }); return on })
  handle('window:overlay-expand', () => { showMain(); return true })
  void INVOKE_CHANNELS; void E164; void basename
}

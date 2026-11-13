// End-to-end test: launches the real built Electron app (needs a display; use xvfb-run on Linux CI),
// drives the real UI with Playwright and a local fixture server standing in for the AI/STT cloud APIs.
import { _electron as electron } from 'playwright-core'
import { createServer } from 'node:http'
import { mkdtempSync, mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = resolve(fileURLToPath(import.meta.url), '../..')
const shots = process.env.SHOT_DIR ?? mkdtempSync(join(tmpdir(), 'jarvis-shots-'))
mkdirSync(shots, { recursive: true })
const home = mkdtempSync(join(tmpdir(), 'jarvis-home-'))
for (const d of ['Desktop', 'Documents', 'Downloads']) mkdirSync(join(home, d), { recursive: true })
const userData = join(home, 'userdata')
// Synthetic "speech": 1.2 s of silence, 1.6 s of a voiced-sounding tone mix, then silence (loops). Not real speech: it only exercises capture + VAD + upload.
const wav = join(home, 'fake-mic.wav')
execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'aevalsrc=0.6*sin(2*PI*180*t)*(1+0.5*sin(2*PI*4*t))+0.3*sin(2*PI*540*t)+0.2*sin(2*PI*1100*t):d=1.6:s=48000', '-af', 'adelay=1200|1200,apad=pad_dur=3', '-t', '6', '-ac', '1', '-ar', '48000', wav])
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }

// ── fixture "cloud": Anthropic messages API + OpenAI-compatible transcription
let script = []
const aiRequests = []
const server = createServer((req, res) => {
  const chunks = []; req.on('data', (c) => chunks.push(c)); req.on('end', () => {
    const raw = Buffer.concat(chunks)
    if (req.url.startsWith('/v1/audio/transcriptions')) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ text: 'what time is it' })) }
    if (req.url.startsWith('/v1/messages')) {
      const body = JSON.parse(raw.toString()); aiRequests.push(body)
      const step = script.shift() ?? { text: 'Fixture script exhausted.' }
      res.writeHead(200, { 'content-type': 'application/json' })
      const content = step.tool ? [{ type: 'tool_use', id: 'tu_' + aiRequests.length, name: step.tool, input: step.input }] : [{ type: 'text', text: step.text }]
      return res.end(JSON.stringify({ content, stop_reason: step.tool ? 'tool_use' : 'end_turn', usage: { input_tokens: 20, output_tokens: 10 } }))
    }
    res.writeHead(404).end()
  })
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}`

const EXE = process.env.JARVIS_EXE // when set, test the INSTALLED app instead of out/main
const launch = () => electron.launch({
  ...(EXE ? { executablePath: EXE } : {}),
  args: [...(EXE ? [] : [join(root, 'out/main/index.js')]), '--no-sandbox', '--disable-gpu'],
  env: { ...process.env, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: join(home, '.config'), JARVIS_E2E: '1', JARVIS_FAKE_AUDIO_FILE: wav, JARVIS_USER_DATA: userData, JARVIS_TEST_PROVIDER_URL: base, JARVIS_TEST_STT_URL: base, ELECTRON_RENDERER_URL: '' }
})
const errors = []
const hook = (page) => { page.on('pageerror', (e) => errors.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) }) }
const nav = async (page, label) => { await page.locator('nav a', { hasText: label }).click(); await page.waitForTimeout(250) }
const sendChat = async (page, text) => { await page.locator('.composer input').fill(text); await page.locator('.composer button').click() }

let app
try {
  app = await launch()
  const desktop = await app.evaluate(({ app: a }) => a.getPath('desktop')); mkdirSync(desktop, { recursive: true })
  const page = await app.firstWindow(); hook(page)
  await page.setViewportSize({ width: 1360, height: 860 }).catch(() => {})
  await page.waitForSelector('.orb-canvas', { timeout: 30000 })
  check('app launches and renders the orb', true)
  check('window title', (await page.title()) === 'JARVIS')
  await page.screenshot({ path: join(shots, '01-home-idle.png') })

  // ── first-run: fresh profile must show the setup wizard; paid/sensitive integrations must be OFF by default
  const d0 = await page.evaluate(async () => ({ s: await window.jarvis.invoke('settings:get'), tg: await window.jarvis.invoke('telegram:status'), g: await window.jarvis.invoke('google:status'), ph: await window.jarvis.invoke('phone:status') }))
  check('integrations are OFF by default (Gmail, Classroom, Telegram, calls)', !d0.s.google.gmailEnabled && !d0.s.google.classroomEnabled && !d0.s.phone.callsEnabled && !d0.s.phone.telegramEnabled && !d0.tg.configured && !d0.g.connected && !d0.ph.enabled && !d0.ph.credentials)
  check('wake word & start-with-Windows are OFF by default', !d0.s.voice.wakeWordEnabled && !d0.s.ui.startWithWindows)
  await page.waitForSelector('.wizard', { timeout: 15000 })
  check('first-run setup wizard appears on a fresh profile', true)
  await page.screenshot({ path: join(shots, '00-wizard-welcome.png') })
  const next = () => page.locator('.wizard .btn.primary', { hasText: 'Next' }).click()
  await next()
  script = [{ text: 'ready' }]
  await page.locator('.wiz-key').fill('sk-ant-e2e-0000000000')
  await page.locator('.wizard .btn', { hasText: 'Save & test' }).click()
  const aiOk = await page.waitForSelector('.wiz-ok:has-text("Connected")', { timeout: 20000 }).then(() => true, () => false)
  check('wizard: AI key saved and connection tested', aiOk)
  await page.screenshot({ path: join(shots, '00-wizard-ai.png') })
  await next()
  await page.locator('.wizard .btn', { hasText: 'Test microphone' }).click()
  const micOk = await page.waitForSelector('.wiz-ok:has-text("Microphone works"), .wiz-bad', { timeout: 15000 }).then((e) => e.evaluate((n) => n.classList.contains('wiz-ok')), () => false)
  check('wizard: microphone permission + signal test (fake mic device)', micOk)
  await next()
  await page.locator('.wiz-stt-key').fill('sk-e2e-stt-0000000000000')
  await page.locator('.wizard .btn', { hasText: 'Save speech settings' }).click()
  check('wizard: speech-recognition key saved', await page.waitForSelector('.wiz-ok:has-text("Key saved")', { timeout: 10000 }).then(() => true, () => false))
  await page.locator('.wizard .btn', { hasText: 'Hear a sample' }).click().catch(() => {})
  await page.waitForTimeout(500)
  await next()
  await page.locator('.wizard .toggle', { hasText: 'Start JARVIS when I sign in' }).click()
  await page.waitForTimeout(600)
  const li = await app.evaluate(() => ({ packaged: globalThis.__jarvisTest?.packaged, openAtLogin: globalThis.__jarvisTest?.loginItem().openAtLogin }))
  if (li.packaged) check('installed app registers start-with-Windows (login item)', li.openAtLogin === true, JSON.stringify(li)); else console.log('SKIP  login item check (only meaningful in the installed/packaged app)')
  await page.screenshot({ path: join(shots, '00-wizard-windows.png') })
  await next()
  await page.locator('.wizard .btn', { hasText: 'Finish setup' }).click()
  await page.waitForSelector('.wizard', { state: 'detached', timeout: 8000 })
  const d1 = await page.evaluate(() => window.jarvis.invoke('settings:get'))
  check('wizard completes and choices are persisted', d1.ui.onboardingDone && d1.ui.startWithWindows && d1.ai.provider === 'anthropic')
  await page.evaluate(() => window.jarvis.invoke('settings:update', { ui: { startWithWindows: false } }))
  const tray = await app.evaluate(() => ({ has: !!globalThis.__jarvisTest?.tray(), menu: globalThis.__jarvisTest?.trayMenu() }))
  check('system tray icon created with STOP/Resume/Quit menu', tray.has && tray.menu.includes('EMERGENCY STOP'), JSON.stringify(tray))

  // security posture of the renderer
  const sec = await page.evaluate(async () => ({ req: typeof window.require, proc: typeof window.process, jarvis: typeof window.jarvis, bad: await window.jarvis.invoke('shell:exec').then(() => 'allowed', (e) => String(e.message)) }))
  check('renderer has no Node access', sec.req === 'undefined' && sec.proc === 'undefined')
  check('IPC bridge rejects non-allow-listed channels', /Blocked IPC channel/.test(sec.bad), sec.bad)

  // secure key storage + settings persistence
  await page.evaluate(() => window.jarvis.invoke('secrets:set', 'ai.anthropic.key', 'sk-ant-e2e-0000000000'))
  await page.evaluate(() => window.jarvis.invoke('secrets:set', 'ai.openai.key', 'sk-e2e-stt-0000000000000'))
  await page.evaluate(() => window.jarvis.invoke('settings:update', { profile: { preferredName: 'Tony' }, voice: { speakResponses: false } }))
  check('API key stored (encrypted)', await page.evaluate(() => window.jarvis.invoke('secrets:has')).then((h) => h['ai.anthropic.key']))

  // chat → AI → tool call → real folder created & verified
  script = [{ tool: 'declare_plan', input: { steps: ['Create the folder', 'Verify it'] } }, { tool: 'create_folder', input: { path: 'Desktop/School Projects' } }, { text: 'Done, Tony. The School Projects folder is on your desktop.' }]
  await sendChat(page, 'Create a folder called School Projects on my desktop')
  await page.waitForSelector('.msg.assistant .bubble:has-text("School Projects folder is on your desktop")', { timeout: 20000 })
  check('chat → AI → tool → reply', true)
  check('folder really exists on disk', existsSync(join(desktop, 'School Projects')))
  const feed = await page.locator('.feed').first().innerText()
  check('activity feed shows real tool events', /Plan:|Creating folder/.test(feed) && /Done: Creating folder|Creating folder/.test(feed), feed.replace(/\n/g, ' | ').slice(0, 160))
  const chatReq = aiRequests.find((r) => r.tools?.length) ?? aiRequests[0]
  check('system prompt carried preferred name & rules', /Tony/.test(chatReq.system) && /untrusted_content/.test(chatReq.system))
  check('tools were offered to the model', chatReq.tools.some((t) => t.name === 'open_application'))
  await page.screenshot({ path: join(shots, '02-chat-tool-run.png') })

  // approval flow: sensitive overwrite → dialog → deny, then allow
  writeFileSync(join(desktop, 'note.txt'), 'original')
  script = [{ tool: 'write_text_file', input: { path: 'Desktop/note.txt', content: 'changed', overwrite: true } }, { text: 'I was not permitted to overwrite that.' }]
  await sendChat(page, 'overwrite my note')
  await page.waitForSelector('.modal', { timeout: 15000 })
  check('approval dialog shown for sensitive action', /Overwriting file/.test(await page.locator('.approval-sum').innerText()))
  check('orb reports awaiting authorization', /AWAITING/.test(await page.locator('.state-label').innerText()))
  await page.screenshot({ path: join(shots, '03-approval.png') })
  await page.locator('.modal .btn.danger').click()
  await page.waitForSelector('.msg.assistant .bubble:has-text("not permitted")', { timeout: 15000 })
  check('denied action did NOT run', readFileSync(join(desktop, 'note.txt'), 'utf8') === 'original')
  script = [{ tool: 'write_text_file', input: { path: 'Desktop/note.txt', content: 'changed', overwrite: true } }, { text: 'Overwritten as you approved.' }]
  await sendChat(page, 'overwrite my note again')
  await page.waitForSelector('.modal')
  await page.locator('.modal .btn.primary').click()
  await page.waitForSelector('.msg.assistant .bubble:has-text("Overwritten as you approved")', { timeout: 15000 })
  check('approved action ran and was verified', readFileSync(join(desktop, 'note.txt'), 'utf8') === 'changed')

  // memory tool + persistence across restart
  script = [{ tool: 'remember', input: { content: 'User prefers short explanations', kind: 'preference' } }, { text: "I'll use shorter explanations." }]
  await sendChat(page, 'Remember that I prefer short explanations')
  await page.waitForSelector('.msg.assistant .bubble:has-text("shorter explanations")', { timeout: 15000 })

  // voice: Chromium fake microphone → VAD → STT endpoint → chat
  script = [{ text: 'It is a fine time to ask, Tony.' }]
  await page.locator('.mic-row .btn', { hasText: 'Talk' }).click()
  const live = await page.waitForSelector('.mic-badge', { timeout: 5000 }).then(() => true, () => false)
  check('microphone indicator shows when listening', live)
  await page.screenshot({ path: join(shots, '04-listening.png') })
  const heard = await page.waitForSelector('.msg.user .bubble:has-text("what time is it")', { timeout: 25000 }).then(() => true, () => false)
  check('voice → VAD → speech-to-text → chat (fake mic device)', heard)
  if (heard) await page.waitForSelector('.msg.assistant .bubble:has-text("fine time")', { timeout: 15000 }).catch(() => {})
  await page.evaluate(() => window.jarvis.invoke('chat:cancel')); await page.waitForTimeout(300)

  // every page renders without errors
  for (const label of ['Computer', 'Connected apps', 'Email', 'Classroom', 'Video editing', 'Phone calls', 'Messaging', 'Task history', 'Automations', 'Memory', 'Settings', 'Privacy', 'Diagnostics']) {
    await nav(page, label)
    const txt = await page.locator('.content').innerText()
    check(`page renders: ${label}`, txt.length > 40, `${txt.length} chars`)
    await page.screenshot({ path: join(shots, `page-${label.replace(/\W+/g, '-').toLowerCase()}.png`) })
  }
  await nav(page, 'Memory'); check('memory panel lists saved memory', /prefers short explanations/.test(await page.locator('.content').innerText()))
  await nav(page, 'Task history'); check('task history lists tasks', /Create a folder called School Projects/.test(await page.locator('.content').innerText()))
  await nav(page, 'Diagnostics'); await page.waitForTimeout(2500)
  const dtxt = await page.locator('.content').innerText()
  check('diagnostics show FFmpeg / browser / database checks', /FFmpeg/.test(dtxt) && /Database/.test(dtxt) && /Secure credential storage/.test(dtxt), dtxt.split('\n').slice(0, 6).join(' | '))

  await nav(page, 'Conversation')
  // scheduler end-to-end through UI-created reminder (fires within seconds, shown in runs log)
  await page.evaluate(() => window.jarvis.invoke('schedule:create', { title: 'E2E reminder', kind: 'reminder', message: 'Time to stretch', recurrence: { type: 'once', at: Date.now() + 1500 }, channels: ['notification'] }))
  await page.waitForTimeout(13000)
  const runs = await page.evaluate(() => window.jarvis.invoke('schedule:runs'))
  check('scheduled reminder fired and was logged', runs.some((r) => r.status === 'ok' && /notification/.test(r.detail)), JSON.stringify(runs[0] ?? {}))

  // overlay window + emergency stop
  await page.evaluate(() => window.jarvis.invoke('overlay:toggle')); await page.waitForTimeout(1500)
  check('floating overlay window opens', app.windows().length === 2)
  const ov = app.windows().find((w) => w !== page)
  if (ov) { await ov.waitForSelector('.overlay', { timeout: 8000 }).catch(() => {}); await ov.screenshot({ path: join(shots, '05-overlay.png') }).catch(() => {}) }
  await page.locator('.topbar .btn.stop').click(); await page.waitForTimeout(400)
  script = [{ tool: 'get_datetime', input: {} }, { text: 'x' }]
  await sendChat(page, 'what time is it now?'); await page.waitForTimeout(2500)
  check('emergency stop blocks tools until resumed', /NOT PERFORMED|Emergency stop/.test(JSON.stringify(aiRequests.at(-1)?.messages ?? '')) || /Emergency stop/.test(await page.locator('.feed').first().innerText().catch(() => '')))
  await page.evaluate(() => window.jarvis.invoke('app:resume'))

  // restart: settings + memory persist
  await app.close()
  app = await launch(); const p2 = await app.firstWindow(); hook(p2)
  await p2.waitForSelector('.orb-canvas', { timeout: 30000 })
  const s2 = await p2.evaluate(() => window.jarvis.invoke('settings:get'))
  const m2 = await p2.evaluate(() => window.jarvis.invoke('memory:list'))
  const h2 = await p2.evaluate(() => window.jarvis.invoke('chat:history'))
  check('settings persist across restart', s2.profile.preferredName === 'Tony')
  check('memory persists across restart', m2.some((m) => /short explanations/.test(m.content)))
  check('conversation history persists across restart', h2.length >= 4)
  await p2.screenshot({ path: join(shots, '06-after-restart.png') })
  check('no uncaught renderer errors', errors.filter((e) => !/Autofill|favicon|DevTools/.test(e)).length === 0, errors.slice(0, 3).join(' || '))
} catch (e) {
  check('e2e run completed without exception', false, String(e?.stack ?? e).split('\n').slice(0, 4).join(' '))
} finally {
  await app?.close().catch(() => {}); server.close()
}
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed. Screenshots: ${shots}`)
process.exit(failed.length ? 1 : 0)

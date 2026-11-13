// Windows-only: drives the REAL computer-control tools (app launcher, window list/focus, typing, UI Automation read, close with approval)
// through the real Electron app with a scripted fixture "AI". Exits non-zero if any check fails.
import { _electron as electron } from 'playwright-core'
import { createServer } from 'node:http'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.platform !== 'win32') { console.log('SKIP: Windows only'); process.exit(0) }
const root = resolve(fileURLToPath(import.meta.url), '../..')
const home = mkdtempSync(join(tmpdir(), 'jarvis-wt-')); mkdirSync(join(home, 'ud'), { recursive: true })
const results = []; const check = (n, ok, d = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + String(d).replace(/\s+/g, ' ').slice(0, 300) : ''}`) }
const lastToolResult = (body) => { const m = [...body.messages].reverse().find((x) => x.role === 'user' && Array.isArray(x.content) && x.content.some((b) => b.type === 'tool_result')); return JSON.stringify(m?.content ?? '') }
let phase = 0; const toolOutputs = []
const server = createServer((req, res) => {
  const ch = []; req.on('data', (c) => ch.push(c)); req.on('end', () => {
    if (!req.url.startsWith('/v1/messages')) { res.writeHead(404).end(); return }
    const body = JSON.parse(Buffer.concat(ch).toString())
    if (phase > 0) toolOutputs.push(lastToolResult(body))
    const tool = (name, input) => ({ content: [{ type: 'tool_use', id: 'tu' + phase, name, input }], stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 } })
    let out
    if (phase === 0) out = tool('list_applications', { query: 'notepad' })
    else if (phase === 1) out = tool('open_application', { name: 'Notepad' })
    else if (phase === 2) out = tool('list_windows', {})
    else if (phase === 3) out = tool('type_text', { text: 'hello from jarvis' })
    else if (phase === 4) out = tool('read_screen_text', {})
    else if (phase === 5) { const m = /pid (\d+)[^\d]*[,)"]|pid (\d+)/.exec(toolOutputs[1] ?? '') ?? /pid (\d+)/.exec(toolOutputs[2] ?? ''); out = tool('close_application', { pid: Number(m?.[1] ?? m?.[2] ?? 0) || 1 }) }
    else out = { content: [{ type: 'text', text: 'Finished the Windows tool tour.' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }
    phase++
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(out))
  })
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const EXE = process.env.JARVIS_EXE
const app = await electron.launch({ ...(EXE ? { executablePath: EXE } : {}), args: [...(EXE ? [] : [join(root, 'out/main/index.js')]), '--no-sandbox', '--disable-gpu'],
  env: { ...process.env, JARVIS_E2E: '1', JARVIS_USER_DATA: join(home, 'ud'), JARVIS_TEST_PROVIDER_URL: `http://127.0.0.1:${server.address().port}`, ELECTRON_RENDERER_URL: '' } })
try {
  const page = await app.firstWindow()
  await page.waitForSelector('.orb-canvas', { timeout: 30000 })
  await page.evaluate(() => window.jarvis.invoke('settings:update', { ui: { onboardingDone: true } }))
  await page.evaluate(() => window.jarvis.invoke('secrets:set', 'ai.anthropic.key', 'sk-ant-e2e-0000000000'))
  await page.locator('.composer input').fill('Open Notepad, type a line, read the screen, then close it')
  await page.locator('.composer button').click()
  // the close_application call is "sensitive": the approval dialog must appear and Notepad must stay open until we allow it
  await page.waitForSelector('.modal', { timeout: 90000 })
  const sum = await page.locator('.approval-sum').innerText()
  check('close_application asks for approval', /Closing application/.test(sum), sum)
  const before = execFileSync('tasklist', ['/FI', 'IMAGENAME eq notepad.exe'], { encoding: 'utf8' })
  check('Notepad is still running while approval is pending', /notepad\.exe/i.test(before))
  await page.locator('.modal .btn.primary').click()
  await page.waitForSelector('.msg.assistant .bubble:has-text("Windows tool tour")', { timeout: 60000 })
  check('app launcher: list_applications found Notepad or fell back to built-in', /notepad/i.test(toolOutputs[0] ?? ''), toolOutputs[0])
  check('app launcher: open_application verified a real window', /Verified: .*is open/.test(toolOutputs[1] ?? ''), toolOutputs[1])
  check('list_windows sees the Notepad window', /notepad/i.test(toolOutputs[2] ?? ''), toolOutputs[2])
  check('type_text ran', /Typed the text/.test(toolOutputs[3] ?? ''), toolOutputs[3])
  check('read_screen_text returned untrusted UI Automation content', /untrusted_content/.test(toolOutputs[4] ?? '') && !/FAILED/.test(toolOutputs[4] ?? ''), toolOutputs[4])
  check('close_application result reported', /closed|still-running/.test(toolOutputs[5] ?? ''), toolOutputs[5])
  await new Promise((r) => setTimeout(r, 1500))
  const after = execFileSync('tasklist', ['/FI', 'IMAGENAME eq notepad.exe'], { encoding: 'utf8' })
  check('Notepad actually closed', !/notepad\.exe/i.test(after))
} catch (e) { check('windows tool tour completed', false, e?.stack ?? e) }
finally { await app.close().catch(() => {}); server.close() }
console.log(`\n${results.filter(Boolean).length}/${results.length} Windows tool checks passed`)
process.exit(results.every(Boolean) ? 0 : 1)

import { describe, it, expect } from 'vitest'
import { makeCore } from './helpers'
import { bootstrap } from '../src/main/bootstrap'
import { testEncryptor, tmpDir } from './helpers'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const ctx = () => ({ taskId: 't', actor: 'user' as const, unattended: false, tainted: false, signal: new AbortController().signal })

describe('sensitive / paid integrations are disabled until the user configures them', () => {
  it('defaults are off', () => {
    const s = makeCore().settings.get()
    expect(s.google).toMatchObject({ gmailEnabled: false, classroomEnabled: false, clientId: '' })
    expect(s.phone).toMatchObject({ callsEnabled: false, callsAcknowledgedCosts: false, telegramEnabled: false, userNumber: '', callerNumber: '' })
    expect(s.voice.wakeWordEnabled).toBe(false); expect(s.ui.startWithWindows).toBe(false); expect(s.ui.onboardingDone).toBe(false)
  })
  it('their tools refuse to run (no network call) until enabled and connected', async () => {
    const t = tmpDir(); for (const d of ['Desktop', 'Documents', 'Downloads', 'Workspace']) mkdirSync(join(t.dir, d))
    const host: any = { platform: 'linux', dataDir: t.dir, userDirs: { desktop: join(t.dir, 'Desktop'), documents: join(t.dir, 'Documents'), downloads: join(t.dir, 'Downloads'), workspace: join(t.dir, 'Workspace') }, openPath: async () => '', openExternal: async () => {}, trashItem: async () => {}, captureScreen: async () => ({ mime: 'image/png', data: '' }), notify() {}, speak() {} }
    const app = bootstrap({ dataDir: t.dir, host, encryptor: testEncryptor, startServices: false })
    const off = app.bus.on('approval', (a) => app.perms.respond(a.id, 'allow'))
    const run = (n: string, a: object) => app.tools.execute(n, a, ctx())
    expect((await run('gmail_search', { query: 'is:unread' })).content).toMatch(/switched off/)
    expect((await run('classroom_courses', {})).content).toMatch(/switched off/)
    expect((await run('send_phone_message', { text: 'x' })).content).toMatch(/No phone is paired/)
    expect((await run('call_me', { message: 'x' })).content).toMatch(/switched off/)
    app.settings.update({ google: { gmailEnabled: true } })
    expect((await run('gmail_search', { query: 'x' })).content).toMatch(/not connected/i)
    expect(app.telegram.status().running).toBe(false); expect(app.phone.status().enabled).toBe(false)
    off(); await app.shutdown(); t.cleanup()
  })
})

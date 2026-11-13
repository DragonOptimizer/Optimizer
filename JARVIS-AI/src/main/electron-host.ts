import { app, desktopCapturer, Notification, screen, shell } from 'electron'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import type { Host } from './tools/host'
import type { Bus } from './core/events'

export function createHost(bus: () => Bus | undefined): Host {
  const documents = app.getPath('documents')
  const workspace = join(documents, 'JARVIS Workspace')
  mkdirSync(workspace, { recursive: true })
  return {
    platform: process.platform,
    dataDir: app.getPath('userData'),
    userDirs: { desktop: app.getPath('desktop'), documents, downloads: app.getPath('downloads'), workspace },
    openPath: (p) => shell.openPath(p),
    openExternal: (u) => shell.openExternal(u),
    trashItem: (p) => shell.trashItem(p),
    async captureScreen() {
      const d = screen.getPrimaryDisplay()
      const w = Math.min(1600, Math.round(d.size.width * d.scaleFactor)), h = Math.round(w * (d.size.height / d.size.width))
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: w, height: h } })
      const src = sources.find((s) => s.display_id === String(d.id)) ?? sources[0]
      if (!src) throw new Error('No screen source available.')
      return { mime: 'image/png', data: src.thumbnail.toPNG().toString('base64') }
    },
    notify: (title, body) => { if (Notification.isSupported()) new Notification({ title, body, silent: false }).show() },
    speak: (text) => bus()?.emit('speak', { text })
  }
}

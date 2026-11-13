import type { ToolImage } from '../core/tools'

/** Operations that need the Electron main process (or an OS shell). Injected so tools stay testable. */
export interface Host {
  platform: NodeJS.Platform
  dataDir: string
  /** Standard user folders: Desktop, Documents, Downloads, plus a JARVIS workspace. */
  userDirs: { desktop: string; documents: string; downloads: string; workspace: string }
  openPath(path: string): Promise<string> // '' on success, else error string
  openExternal(url: string): Promise<void>
  trashItem(path: string): Promise<void>
  captureScreen(): Promise<ToolImage>
  notify(title: string, body: string): void
  speak(text: string): void
}

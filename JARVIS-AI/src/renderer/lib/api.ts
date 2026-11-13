import type { JarvisBridge } from '@shared/ipc'

declare global { interface Window { jarvis: JarvisBridge; jarvisEnv: { platform: string } } }

export const api = {
  invoke: <T = any>(ch: Parameters<JarvisBridge['invoke']>[0], ...a: unknown[]) => window.jarvis.invoke<T>(ch, ...a),
  on: (ch: Parameters<JarvisBridge['on']>[0], cb: (p: any) => void) => window.jarvis.on(ch, cb)
}
export const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

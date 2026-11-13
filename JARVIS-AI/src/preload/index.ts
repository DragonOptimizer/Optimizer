import { contextBridge, ipcRenderer } from 'electron'
import { EVENT_CHANNELS, INVOKE_CHANNELS, type EventChannel, type InvokeChannel, type JarvisBridge } from '../shared/ipc'

const invokeAllowed = new Set<string>(INVOKE_CHANNELS)
const eventAllowed = new Set<string>(EVENT_CHANNELS)

const bridge: JarvisBridge = {
  invoke: (channel: InvokeChannel, ...args: unknown[]) => {
    if (!invokeAllowed.has(channel)) return Promise.reject(new Error(`Blocked IPC channel: ${channel}`))
    return ipcRenderer.invoke(channel, ...args)
  },
  on: (channel: EventChannel, cb: (payload: any) => void) => {
    if (!eventAllowed.has(channel)) throw new Error(`Blocked IPC event: ${channel}`)
    const h = (_e: unknown, payload: unknown) => cb(payload)
    ipcRenderer.on(channel, h)
    return () => ipcRenderer.removeListener(channel, h)
  }
}
contextBridge.exposeInMainWorld('jarvis', bridge)
contextBridge.exposeInMainWorld('jarvisEnv', { platform: process.platform })

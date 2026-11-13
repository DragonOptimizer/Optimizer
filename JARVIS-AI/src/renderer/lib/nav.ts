import { useSyncExternalStore } from 'react'
import { api, errMsg } from './api'
import { toast } from './store'

const get = () => (window.location.hash.replace(/^#\/?/, '') || 'home')
export const useRoute = () => useSyncExternalStore((f) => { window.addEventListener('hashchange', f); return () => window.removeEventListener('hashchange', f) }, get)
export const go = (r: string) => { window.location.hash = `#/${r}` }
/** Send a request to the assistant and jump to the conversation so the user can watch it work. */
export async function ask(text: string, navigate = true) {
  try { await api.invoke('chat:send', { text, source: 'text' }); if (navigate) go('home') } catch (e) { toast(errMsg(e), 'error') }
}
export function useAsyncAction() { return async (fn: () => Promise<unknown>, ok?: string) => { try { await fn(); if (ok) toast(ok) } catch (e) { toast(errMsg(e), 'error') } } }

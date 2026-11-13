import { useSyncExternalStore } from 'react'
import type { ActivityEvent, ApprovalRequest, AppSnapshot, AssistantState, ChatMessage, Settings, TaskRecord } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/defaults'
import { api } from './api'

export interface UiState {
  ready: boolean
  snapshot: AppSnapshot
  settings: Settings
  messages: ChatMessage[]
  activity: ActivityEvent[]
  approvals: ApprovalRequest[]
  tasks: TaskRecord[]
  orb: AssistantState
  orbDetail: string
  busy: boolean
  toast: { id: number; text: string; kind: 'info' | 'error' } | null
  voiceNote: string
  micLive: boolean
  conversationMode: boolean
}
const initial: UiState = {
  ready: false, snapshot: { state: 'idle', stateDetail: 'Ready', online: true, version: '', platform: '', locked: false, pinRequired: false },
  settings: DEFAULT_SETTINGS, messages: [], activity: [], approvals: [], tasks: [], orb: 'idle', orbDetail: 'Ready', busy: false, toast: null, voiceNote: '', micLive: false, conversationMode: false
}
let state = initial
const subs = new Set<() => void>()
export const getState = () => state
export function setState(p: Partial<UiState> | ((s: UiState) => Partial<UiState>)) { state = { ...state, ...(typeof p === 'function' ? p(state) : p) }; subs.forEach((f) => f()) }
export function useUi<T>(sel: (s: UiState) => T): T { return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f) }, () => sel(state)) }
let toastId = 0
export const toast = (text: string, kind: 'info' | 'error' = 'info') => { const id = ++toastId; setState({ toast: { id, text, kind } }); setTimeout(() => { if (state.toast?.id === id) setState({ toast: null }) }, kind === 'error' ? 7000 : 3500) }

let started = false
export async function initStore() {
  if (started) return; started = true
  const [snapshot, settings] = await Promise.all([api.invoke<AppSnapshot>('app:snapshot'), api.invoke<Settings>('settings:get').catch(() => DEFAULT_SETTINGS)])
  setState({ snapshot, settings, orb: snapshot.state, orbDetail: snapshot.stateDetail, ready: true })
  await loadData()
  api.on('event:state', ({ state: s, detail }) => setState({ orb: s, orbDetail: detail, busy: s === 'processing' || s === 'acting' || s === 'awaiting_approval' }))
  api.on('event:activity', (e: ActivityEvent) => setState((s) => ({ activity: [...s.activity.slice(-299), e] })))
  api.on('event:approval', (a: ApprovalRequest) => setState((s) => ({ approvals: [...s.approvals.filter((x) => x.id !== a.id), a] })))
  api.on('event:approval-resolved', ({ id }) => setState((s) => ({ approvals: s.approvals.filter((x) => x.id !== id) })))
  api.on('event:chat-message', (m: ChatMessage) => setState((s) => ({ messages: s.messages.some((x) => x.id === m.id) ? s.messages : [...s.messages, m] })))
  api.on('event:settings', (settings: Settings) => setState({ settings }))
  api.on('event:online', ({ online }) => setState((s) => ({ snapshot: { ...s.snapshot, online } })))
  api.on('event:lock', ({ locked }) => { setState((s) => ({ snapshot: { ...s.snapshot, locked } })); if (!locked) void loadData() })
  api.on('event:stop', ({ reason }) => { toast(`Emergency stop: ${reason}`, 'error'); void refreshTasks() })
  api.on('event:schedule-fired', () => void refreshTasks())
  setInterval(() => void refreshTasks(), 15000)
}
export async function loadData() {
  try {
    const [messages, activity, approvals, tasks] = await Promise.all([api.invoke<ChatMessage[]>('chat:history'), api.invoke<ActivityEvent[]>('activity:recent'), api.invoke<ApprovalRequest[]>('approval:pending'), api.invoke<TaskRecord[]>('tasks:list')])
    setState({ messages, activity, approvals, tasks })
  } catch { /* locked */ }
}
export async function refreshTasks() { try { setState({ tasks: await api.invoke<TaskRecord[]>('tasks:list') }) } catch { /* ignore */ } }
export async function updateSettings(patch: object) { const s = await api.invoke<Settings>('settings:update', patch); setState({ settings: s }); return s }

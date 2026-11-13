// The complete, allow-listed IPC surface. The preload script exposes ONLY these channels.

export const INVOKE_CHANNELS = [
  'app:snapshot', 'app:stop-all', 'app:quit', 'app:open-data-dir', 'app:set-state',
  'security:unlock', 'security:set-pin', 'security:lock', 'security:clear-pin',
  'settings:get', 'settings:update',
  'secrets:set', 'secrets:has', 'secrets:delete',
  'chat:send', 'chat:history', 'chat:cancel', 'chat:new', 'chat:conversations',
  'approval:respond', 'approval:pending',
  'activity:recent', 'tasks:list',
  'tools:list',
  'ai:providers', 'ai:models', 'ai:test', 'ai:usage',
  'voice:transcribe', 'voice:synthesize', 'voice:set-ptt',
  'memory:list', 'memory:add', 'memory:update', 'memory:delete', 'memory:clear',
  'schedule:list', 'schedule:create', 'schedule:toggle', 'schedule:delete', 'schedule:runs',
  'telegram:status', 'telegram:connect', 'telegram:new-pairing', 'telegram:disconnect', 'telegram:send-test',
  'google:status', 'google:connect', 'google:disconnect',
  'gmail:unread', 'classroom:courses', 'classroom:work',
  'phone:status', 'phone:history', 'phone:stop', 'phone:resume', 'phone:test-call',
  'video:probe', 'video:pick-files',
  'diagnostics:run', 'diagnostics:logs',
  'audit:list', 'privacy:wipe', 'privacy:export',
  'phone:set-credentials', 'phone:clear-credentials', 'phone:fetch-rate', 'metrics:report', 'wake:status', 'app:resume', 'privacy:revoke-grants', 'google:set-secret',
  'app:open-mic-settings', 'overlay:toggle', 'window:overlay-expand'
] as const
export type InvokeChannel = (typeof INVOKE_CHANNELS)[number]

export const EVENT_CHANNELS = [
  'event:state', 'event:activity', 'event:approval', 'event:approval-resolved', 'event:chat-message',
  'event:settings', 'event:schedule-fired', 'event:telegram', 'event:log', 'event:ptt', 'event:speak', 'event:lock', 'event:online', 'event:stop'
] as const
export type EventChannel = (typeof EVENT_CHANNELS)[number]

export interface JarvisBridge {
  invoke<T = unknown>(channel: InvokeChannel, ...args: unknown[]): Promise<T>
  on(channel: EventChannel, cb: (payload: any) => void): () => void
}

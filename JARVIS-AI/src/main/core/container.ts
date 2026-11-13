import { Db } from './db'
import { Logger } from './logger'
import { Bus } from './events'
import { SettingsStore } from './settings'
import { SecretStore, type Encryptor } from './secrets'
import { MemoryStore } from './memory'
import { ConversationStore } from './conversations'
import { ActivityStore, AuditStore, TaskStore, UsageStore } from './stores'
import { PermissionManager } from './permissions'
import { ToolRegistry } from './tools'
import { StateMachine } from './state'
import { Agent } from '../ai/agent'
import { makeProvider } from '../ai'
import type { Provider } from '../ai/types'

export interface CoreOptions { dbPath: string; logFile?: string; encryptor: Encryptor; providerOverride?: () => Provider }

export function createCore(o: CoreOptions) {
  const db = new Db(o.dbPath)
  const log = new Logger(o.logFile)
  const bus = new Bus()
  const settings = new SettingsStore(db, bus)
  const secrets = new SecretStore(db, o.encryptor)
  const memory = new MemoryStore(db)
  const conversations = new ConversationStore(db)
  const tasks = new TaskStore(db)
  const activity = new ActivityStore(db)
  const audit = new AuditStore(db)
  const usage = new UsageStore(db)
  const perms = new PermissionManager(db, settings, bus, audit)
  const tools = new ToolRegistry(perms, bus, activity, log)
  const state = new StateMachine(bus)
  bus.on('approval', () => state.setApprovals(perms.pendingRequests().length))
  bus.on('approval-resolved', () => queueMicrotask(() => state.setApprovals(perms.pendingRequests().length)))
  const provider = o.providerOverride ?? (() => makeProvider(settings.get().ai.provider, () => settings.get(), secrets))
  const agent = new Agent({ provider, settings, memory, conversations, tasks, usage, tools, bus, log, state })
  const recovered = tasks.recoverCrashed()
  if (recovered) log.warn('core', `Marked ${recovered} interrupted task(s) from a previous run as failed`)
  return { db, log, bus, settings, secrets, memory, conversations, tasks, activity, audit, usage, perms, tools, state, agent, provider }
}
export type Core = ReturnType<typeof createCore>

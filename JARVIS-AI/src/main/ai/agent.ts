import { arch, platform, release } from 'node:os'
import type { ChatMessage, MessageSource, TaskStatus } from '@shared/types'
import type { ToolRegistry } from '../core/tools'
import type { SettingsStore } from '../core/settings'
import type { MemoryStore } from '../core/memory'
import type { ConversationStore } from '../core/conversations'
import type { TaskStore, UsageStore } from '../core/stores'
import type { Bus } from '../core/events'
import type { Logger } from '../core/logger'
import type { StateMachine } from '../core/state'
import type { PermissionContext } from '../core/permissions'
import type { Msg, Provider, ToolSpec } from './types'
import { buildSystemPrompt } from './prompts'

export interface AgentDeps {
  provider: () => Provider
  settings: SettingsStore
  memory: MemoryStore
  conversations: ConversationStore
  tasks: TaskStore
  usage: UsageStore
  tools: ToolRegistry
  bus: Bus
  log: Logger
  state: StateMachine
}
export interface RunOptions {
  text: string
  source: MessageSource
  conversationId?: string
  unattended?: boolean
  /** Do not read/write persistent conversation history (used by scheduler runs). */
  ephemeral?: boolean
  actor?: PermissionContext['actor']
}
export interface RunResult { taskId: string; reply: string; status: TaskStatus; conversationId: string }

const DECLARE_PLAN: ToolSpec = {
  name: 'declare_plan',
  description: 'Declare a short step-by-step plan before starting a multi-step task. The plan is shown to the user.',
  inputSchema: { type: 'object', properties: { steps: { type: 'array', items: { type: 'string' }, description: 'Ordered plan steps' } }, required: ['steps'] }
}

export class Agent {
  private running = new Map<string, AbortController>()
  constructor(private d: AgentDeps) {}

  activeTaskIds() { return [...this.running.keys()] }
  cancel(taskId: string) { this.running.get(taskId)?.abort(); return this.running.has(taskId) }
  cancelAll() { for (const ac of this.running.values()) ac.abort() }

  async run(o: RunOptions): Promise<RunResult> {
    const { d } = this
    const settings = d.settings.get()
    const unattended = !!o.unattended
    const actor = o.actor ?? (o.source === 'telegram' ? 'telegram' : o.source === 'scheduler' ? 'scheduler' : 'user')
    const convId = o.conversationId ?? (o.ephemeral ? '' : d.conversations.current())
    const task = d.tasks.create(o.text, o.source)
    const ac = new AbortController()
    this.running.set(task.id, ac)
    const emit = (kind: 'task' | 'plan' | 'info' | 'error', status: TaskStatus, message: string, detail?: string) => d.tools.emit(task.id, kind, status, message, { detail })

    const history: Msg[] = []
    if (!o.ephemeral && convId) {
      for (const m of d.conversations.history(convId, 24)) if (m.role !== 'system') history.push(m.role === 'user' ? { role: 'user', content: m.content } : { role: 'assistant', text: m.content, toolCalls: [] })
      d.conversations.add(convId, 'user', o.text, o.source)
      d.bus.emit('chat-message', d.conversations.history(convId, 1)[0])
    }
    history.push({ role: 'user', content: o.text })
    const messages = history
    const system = buildSystemPrompt({ settings, memories: d.memory.forPrompt(o.text), unattended, actor, os: `${platform()} ${release()} ${arch()}`, now: new Date(), toolNames: [] })
    const specs: ToolSpec[] = [DECLARE_PLAN, ...d.tools.forContext(unattended).map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }))]
    const ctx: PermissionContext = { taskId: task.id, actor, unattended, tainted: false, signal: ac.signal }

    emit('task', 'running', `Task started: ${o.text.slice(0, 120)}`)
    d.state.setAgent('processing', 'Thinking…')

    let reply = '', status: TaskStatus = 'completed', tokens = 0
    const seenCalls = new Map<string, number>()
    try {
      const provider = d.provider()
      let step = 0
      for (; step < settings.ai.maxSteps; step++) {
        if (ac.signal.aborted) throw new CancelError()
        this.checkBudget(tokens)
        d.state.setAgent('processing', step === 0 ? 'Thinking…' : 'Reviewing results…')
        const res = await provider.chat({ system, messages, tools: specs, signal: ac.signal })
        tokens += res.usage.inputTokens + res.usage.outputTokens
        d.usage.add(res.usage.inputTokens, res.usage.outputTokens)
        d.tasks.addTokens(task.id, res.usage.inputTokens, res.usage.outputTokens)
        messages.push({ role: 'assistant', text: res.text, toolCalls: res.toolCalls, raw: res.raw })
        if (!res.toolCalls.length) { reply = res.text.trim(); break }

        for (const call of res.toolCalls.slice(0, 8)) {
          if (ac.signal.aborted) throw new CancelError()
          const key = call.name + JSON.stringify(call.args)
          const n = (seenCalls.get(key) ?? 0) + 1
          seenCalls.set(key, n)
          if (n > 2) {
            messages.push({ role: 'tool', toolCallId: call.id, name: call.name, content: 'FAILED: identical call repeated too many times; stop and report to the user.', isError: true })
            continue
          }
          if (call.name === 'declare_plan') {
            const steps = Array.isArray(call.args.steps) ? (call.args.steps as unknown[]).map(String) : []
            emit('plan', 'planned', `Plan: ${steps.join(' → ')}`, steps.map((s, i) => `${i + 1}. ${s}`).join('\n'))
            messages.push({ role: 'tool', toolCallId: call.id, name: call.name, content: 'Plan recorded. Proceed.' })
            continue
          }
          d.state.setAgent('acting', call.name)
          const r = await d.tools.execute(call.name, call.args, ctx)
          messages.push({ role: 'tool', toolCallId: call.id, name: call.name, content: r.content, isError: !r.ok, images: r.images })
          if (ac.signal.aborted) throw new CancelError()
        }
        if (res.toolCalls.length > 8) messages.push({ role: 'user', content: '(System: only the first 8 tool calls of that batch were executed. Continue if needed.)' })
      }
      if (!reply && !ac.signal.aborted) {
        status = 'failed'
        reply = `I stopped after ${settings.ai.maxSteps} steps without finishing, to avoid running in circles. Here is where things stand: ${lastToolSummary(messages)}`
      }
    } catch (e) {
      if (e instanceof CancelError || ac.signal.aborted) { status = 'cancelled'; reply = 'Cancelled. Nothing further was done.' }
      else { status = 'failed'; reply = `I couldn't complete that: ${(e as Error).message}`; d.log.error('agent', 'task failed', e); d.state.flashError((e as Error).message.slice(0, 120)) }
    } finally {
      this.running.delete(task.id)
      d.state.setAgent('idle')
    }
    d.tasks.setStatus(task.id, status, reply.slice(0, 500))
    emit('task', status, status === 'completed' ? 'Task completed' : status === 'cancelled' ? 'Task cancelled' : 'Task failed', status === 'failed' ? reply : undefined)
    if (!o.ephemeral && convId) {
      const saved = d.conversations.add(convId, 'assistant', reply, o.source)
      d.bus.emit('chat-message', saved as ChatMessage)
    }
    return { taskId: task.id, reply, status, conversationId: convId }
  }

  private checkBudget(taskTokens: number) {
    const s = this.d.settings.get().ai
    const today = this.d.usage.today()
    if (s.dailyTokenLimit > 0 && today.tokensIn + today.tokensOut >= s.dailyTokenLimit) throw new Error(`Daily token limit reached (${s.dailyTokenLimit.toLocaleString()}). Raise it in Settings → AI to continue.`)
    if (s.taskTokenLimit > 0 && taskTokens >= s.taskTokenLimit) throw new Error(`This task exceeded its token limit (${s.taskTokenLimit.toLocaleString()}) and was stopped.`)
  }
}

class CancelError extends Error {}
function lastToolSummary(messages: Msg[]): string {
  const last = [...messages].reverse().find((m) => m.role === 'tool')
  return last && last.role === 'tool' ? `last tool "${last.name}" returned: ${last.content.slice(0, 200)}` : 'no tools had completed.'
}

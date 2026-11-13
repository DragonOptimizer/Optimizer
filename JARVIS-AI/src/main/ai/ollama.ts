import type { ChatRequest, ChatResponse, Msg, Provider, ToolCall } from './types'
import { fetchJson } from './http'

export interface OllamaConfig { baseUrl: () => string; model: () => string }

export class OllamaProvider implements Provider {
  id = 'ollama' as const
  constructor(private cfg: OllamaConfig) {}
  toApi(system: string, messages: Msg[]) {
    const out: any[] = [{ role: 'system', content: system }]
    for (const m of messages) {
      if (m.role === 'user') out.push({ role: 'user', content: m.content, ...(m.images?.length ? { images: m.images.map((i) => i.data) } : {}) })
      else if (m.role === 'assistant') out.push({ role: 'assistant', content: m.text, ...(m.toolCalls.length ? { tool_calls: m.toolCalls.map((c) => ({ function: { name: c.name, arguments: c.args } })) } : {}) })
      else {
        out.push({ role: 'tool', tool_name: m.name, content: m.content || '(no output)' })
        if (m.images?.length) out.push({ role: 'user', content: `(Image output of tool ${m.name})`, images: m.images.map((i) => i.data) })
      }
    }
    return out
  }
  async chat(req: ChatRequest): Promise<ChatResponse> {
    const body = {
      model: this.cfg.model(), stream: false, messages: this.toApi(req.system, req.messages),
      ...(req.tools.length ? { tools: req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } })) } : {})
    }
    let r: any
    try { r = await fetchJson(`${this.cfg.baseUrl()}/api/chat`, { body: JSON.stringify(body), signal: req.signal, timeoutMs: 300_000, retries: 1 }) }
    catch (e) { throw new Error(`${(e as Error).message}. Is Ollama running at ${this.cfg.baseUrl()} and is the model "${this.cfg.model()}" pulled (ollama pull ${this.cfg.model()})?`) }
    const toolCalls: ToolCall[] = (r.message?.tool_calls ?? []).map((c: any, i: number) => ({ id: `ollama-${Date.now()}-${i}`, name: c.function.name, args: typeof c.function.arguments === 'string' ? safeParse(c.function.arguments) : c.function.arguments ?? {} }))
    return {
      text: r.message?.content ?? '', toolCalls, usage: { inputTokens: r.prompt_eval_count ?? 0, outputTokens: r.eval_count ?? 0 },
      stop: toolCalls.length ? 'tool_use' : r.done_reason === 'length' ? 'length' : 'end'
    }
  }
  async listModels(signal?: AbortSignal) {
    const r = await fetchJson(`${this.cfg.baseUrl()}/api/tags`, { method: 'GET', signal, retries: 0, timeoutMs: 5000 })
    return (r.models ?? []).map((m: any) => m.name as string)
  }
}
const safeParse = (s: string) => { try { return JSON.parse(s) } catch { return {} } }

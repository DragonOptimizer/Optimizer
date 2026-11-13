import type { ChatRequest, ChatResponse, Msg, Provider, ToolCall } from './types'
import type { ProviderConfig } from './anthropic'
import { fetchJson } from './http'

export class OpenAIProvider implements Provider {
  id = 'openai' as const
  constructor(private cfg: ProviderConfig) {}
  private base() { return this.cfg.baseUrl ?? 'https://api.openai.com' }
  private headers() {
    const key = this.cfg.apiKey()
    if (!key) throw new Error('No OpenAI API key configured. Add one in Settings → AI.')
    return { authorization: `Bearer ${key}` }
  }
  toApi(system: string, messages: Msg[]) {
    const out: any[] = [{ role: 'system', content: system }]
    for (const m of messages) {
      if (m.role === 'user') {
        if (m.images?.length) out.push({ role: 'user', content: [{ type: 'text', text: m.content }, ...m.images.map((i) => ({ type: 'image_url', image_url: { url: `data:${i.mime};base64,${i.data}` } }))] })
        else out.push({ role: 'user', content: m.content })
      } else if (m.role === 'assistant') {
        out.push({ role: 'assistant', content: m.text || null,
          ...(m.toolCalls.length ? { tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })) } : {}) })
      } else {
        out.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content || '(no output)' })
        // Chat Completions tool messages cannot carry images; attach them as a follow-up user message.
        if (m.images?.length) out.push({ role: 'user', content: [{ type: 'text', text: `(Image output of tool ${m.name})` }, ...m.images.map((i) => ({ type: 'image_url', image_url: { url: `data:${i.mime};base64,${i.data}` } }))] })
      }
    }
    return out
  }
  async chat(req: ChatRequest): Promise<ChatResponse> {
    const body = {
      model: this.cfg.model(), messages: this.toApi(req.system, req.messages),
      ...(req.tools.length ? { tools: req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } })) } : {})
    }
    const r = await fetchJson(`${this.base()}/v1/chat/completions`, { headers: this.headers(), body: JSON.stringify(body), signal: req.signal })
    const choice = r.choices?.[0]
    if (!choice) throw new Error('OpenAI returned no choices')
    const toolCalls: ToolCall[] = (choice.message?.tool_calls ?? []).map((c: any) => {
      let args: Record<string, unknown> = {}
      try { args = JSON.parse(c.function.arguments || '{}') } catch { /* leave empty; validation will report */ }
      return { id: c.id, name: c.function.name, args }
    })
    return {
      text: choice.message?.content ?? '', toolCalls, usage: { inputTokens: r.usage?.prompt_tokens ?? 0, outputTokens: r.usage?.completion_tokens ?? 0 },
      stop: toolCalls.length ? 'tool_use' : choice.finish_reason === 'length' ? 'length' : choice.finish_reason === 'stop' ? 'end' : 'other'
    }
  }
  async listModels(signal?: AbortSignal) {
    const r = await fetchJson(`${this.base()}/v1/models`, { method: 'GET', headers: this.headers(), signal, retries: 1 })
    return (r.data ?? []).map((m: any) => m.id as string).sort()
  }
}

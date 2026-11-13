import type { ChatRequest, ChatResponse, Msg, Provider, ToolCall } from './types'
import { fetchJson } from './http'

export interface ProviderConfig { apiKey: () => string | undefined; model: () => string; baseUrl?: string }

export class AnthropicProvider implements Provider {
  id = 'anthropic' as const
  constructor(private cfg: ProviderConfig) {}
  private base() { return this.cfg.baseUrl ?? 'https://api.anthropic.com' }
  private headers() {
    const key = this.cfg.apiKey()
    if (!key) throw new Error('No Anthropic API key configured. Add one in Settings → AI.')
    return { 'x-api-key': key, 'anthropic-version': '2023-06-01' }
  }
  toApi(messages: Msg[]) {
    const out: any[] = []
    for (const m of messages) {
      if (m.role === 'user') {
        const content: any[] = [{ type: 'text', text: m.content }]
        for (const i of m.images ?? []) content.push({ type: 'image', source: { type: 'base64', media_type: i.mime, data: i.data } })
        out.push({ role: 'user', content })
      } else if (m.role === 'assistant') {
        const content: any[] = []
        if (m.text) content.push({ type: 'text', text: m.text })
        for (const c of m.toolCalls) content.push({ type: 'tool_use', id: c.id, name: c.name, input: c.args })
        out.push({ role: 'assistant', content })
      } else {
        const inner: any[] = [{ type: 'text', text: m.content || '(no output)' }]
        for (const i of m.images ?? []) inner.push({ type: 'image', source: { type: 'base64', media_type: i.mime, data: i.data } })
        const block = { type: 'tool_result', tool_use_id: m.toolCallId, content: inner, is_error: m.isError ?? false }
        const prev = out[out.length - 1]
        if (prev && prev.role === 'user' && prev.content.every((b: any) => b.type === 'tool_result')) prev.content.push(block)
        else out.push({ role: 'user', content: [block] })
      }
    }
    return out
  }
  async chat(req: ChatRequest): Promise<ChatResponse> {
    const body = {
      model: this.cfg.model(), max_tokens: req.maxTokens ?? 4096, system: req.system, messages: this.toApi(req.messages),
      ...(req.tools.length ? { tools: req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema })) } : {})
    }
    const r = await fetchJson(`${this.base()}/v1/messages`, { headers: this.headers(), body: JSON.stringify(body), signal: req.signal })
    const toolCalls: ToolCall[] = []
    let text = ''
    for (const b of r.content ?? []) {
      if (b.type === 'text') text += b.text
      else if (b.type === 'tool_use') toolCalls.push({ id: b.id, name: b.name, args: b.input ?? {} })
    }
    return {
      text, toolCalls, usage: { inputTokens: r.usage?.input_tokens ?? 0, outputTokens: r.usage?.output_tokens ?? 0 },
      stop: r.stop_reason === 'tool_use' ? 'tool_use' : r.stop_reason === 'max_tokens' ? 'length' : r.stop_reason === 'end_turn' ? 'end' : 'other'
    }
  }
  async listModels(signal?: AbortSignal) {
    const r = await fetchJson(`${this.base()}/v1/models?limit=100`, { method: 'GET', headers: this.headers(), signal, retries: 1 })
    return (r.data ?? []).map((m: any) => m.id as string)
  }
}

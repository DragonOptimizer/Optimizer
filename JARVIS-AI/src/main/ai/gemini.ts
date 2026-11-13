import type { ChatRequest, ChatResponse, Msg, Provider, ToolCall } from './types'
import type { ProviderConfig } from './anthropic'
import { fetchJson } from './http'
import type { JsonSchema } from '../core/schema'

/** Gemini accepts an OpenAPI subset; strip keywords it rejects. */
export function geminiSchema(s: JsonSchema): any {
  const o: any = { type: s.type }
  if (s.description) o.description = s.description
  if (s.enum) o.enum = s.enum.map(String)
  if (s.properties) o.properties = Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, geminiSchema(v)]))
  if (s.required?.length) o.required = s.required
  if (s.items) o.items = geminiSchema(s.items)
  if (s.type === 'object' && !s.properties) delete o.type, o.type = 'object'
  return o
}

export class GeminiProvider implements Provider {
  id = 'gemini' as const
  constructor(private cfg: ProviderConfig) {}
  private base() { return this.cfg.baseUrl ?? 'https://generativelanguage.googleapis.com' }
  private headers() {
    const key = this.cfg.apiKey()
    if (!key) throw new Error('No Gemini API key configured. Add one in Settings → AI.')
    return { 'x-goog-api-key': key }
  }
  toApi(messages: Msg[]) {
    const out: any[] = []
    for (const m of messages) {
      if (m.role === 'user') {
        out.push({ role: 'user', parts: [{ text: m.content }, ...(m.images ?? []).map((i) => ({ inlineData: { mimeType: i.mime, data: i.data } }))] })
      } else if (m.role === 'assistant') {
        // Replay the model's own parts verbatim (preserves thought signatures required by newer Gemini models).
        const parts = Array.isArray(m.raw) ? m.raw : [...(m.text ? [{ text: m.text }] : []), ...m.toolCalls.map((c) => ({ functionCall: { name: c.name, args: c.args } }))]
        out.push({ role: 'model', parts })
      } else {
        const part = { functionResponse: { name: m.name, response: m.isError ? { error: m.content } : { output: m.content } } }
        const prev = out[out.length - 1]
        if (prev && prev.role === 'user' && prev.parts.every((p: any) => p.functionResponse)) prev.parts.push(part)
        else out.push({ role: 'user', parts: [part] })
        if (m.images?.length) out.push({ role: 'user', parts: [{ text: `(Image output of tool ${m.name})` }, ...m.images.map((i) => ({ inlineData: { mimeType: i.mime, data: i.data } }))] })
      }
    }
    return out
  }
  async chat(req: ChatRequest): Promise<ChatResponse> {
    const body = {
      systemInstruction: { parts: [{ text: req.system }] }, contents: this.toApi(req.messages),
      ...(req.tools.length ? { tools: [{ functionDeclarations: req.tools.map((t) => ({ name: t.name, description: t.description, ...(Object.keys(t.inputSchema.properties ?? {}).length ? { parameters: geminiSchema(t.inputSchema) } : {}) })) }] } : {})
    }
    const model = this.cfg.model().replace(/^models\//, '')
    const r = await fetchJson(`${this.base()}/v1beta/models/${encodeURIComponent(model)}:generateContent`, { headers: this.headers(), body: JSON.stringify(body), signal: req.signal })
    const cand = r.candidates?.[0]
    if (!cand) throw new Error(`Gemini returned no candidates${r.promptFeedback?.blockReason ? ` (blocked: ${r.promptFeedback.blockReason})` : ''}`)
    const parts: any[] = cand.content?.parts ?? []
    let text = ''
    const toolCalls: ToolCall[] = []
    parts.forEach((p, i) => {
      if (typeof p.text === 'string' && !p.thought) text += p.text
      if (p.functionCall) toolCalls.push({ id: `gemini-${Date.now()}-${i}`, name: p.functionCall.name, args: p.functionCall.args ?? {} })
    })
    return {
      text, toolCalls, raw: parts, usage: { inputTokens: r.usageMetadata?.promptTokenCount ?? 0, outputTokens: (r.usageMetadata?.candidatesTokenCount ?? 0) + (r.usageMetadata?.thoughtsTokenCount ?? 0) },
      stop: toolCalls.length ? 'tool_use' : cand.finishReason === 'MAX_TOKENS' ? 'length' : cand.finishReason === 'STOP' ? 'end' : 'other'
    }
  }
  async listModels(signal?: AbortSignal) {
    const r = await fetchJson(`${this.base()}/v1beta/models?pageSize=100`, { method: 'GET', headers: this.headers(), signal, retries: 1 })
    return (r.models ?? []).filter((m: any) => (m.supportedGenerationMethods ?? []).includes('generateContent')).map((m: any) => String(m.name).replace(/^models\//, ''))
  }
}

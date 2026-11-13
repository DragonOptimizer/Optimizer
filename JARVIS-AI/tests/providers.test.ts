import { describe, it, expect, afterAll } from 'vitest'
import { mockServer, json, type MockServer } from './helpers'
import { AnthropicProvider } from '../src/main/ai/anthropic'
import { OpenAIProvider } from '../src/main/ai/openai'
import { GeminiProvider } from '../src/main/ai/gemini'
import { OllamaProvider } from '../src/main/ai/ollama'
import { fetchJson } from '../src/main/ai/http'
import type { ChatRequest } from '../src/main/ai/types'

const tools = [{ name: 'open_application', description: 'open', inputSchema: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } } as const }]
const req: ChatRequest = {
  system: 'sys', tools: tools as any,
  messages: [
    { role: 'user', content: 'open chrome' },
    { role: 'assistant', text: '', toolCalls: [{ id: 't1', name: 'open_application', args: { name: 'chrome' } }] },
    { role: 'tool', toolCallId: 't1', name: 'open_application', content: 'Verified open' }
  ]
}
const servers: MockServer[] = []
afterAll(async () => { for (const s of servers) await s.close() })

describe('Anthropic provider', () => {
  it('maps tool calls/results and parses usage', async () => {
    const s = await mockServer((r, res) => json(res, { content: [{ type: 'text', text: 'Done.' }, { type: 'tool_use', id: 'x1', name: 'open_application', input: { name: 'edge' } }], stop_reason: 'tool_use', usage: { input_tokens: 11, output_tokens: 7 } }))
    servers.push(s)
    const p = new AnthropicProvider({ apiKey: () => 'k', model: () => 'claude-x', baseUrl: s.url })
    const r = await p.chat(req)
    expect(r.toolCalls).toEqual([{ id: 'x1', name: 'open_application', args: { name: 'edge' } }])
    expect(r.usage).toEqual({ inputTokens: 11, outputTokens: 7 })
    expect(r.stop).toBe('tool_use')
    const body = s.requests[0].body
    expect(s.requests[0].headers['x-api-key']).toBe('k')
    expect(body.tools[0].input_schema.required).toEqual(['name'])
    expect(body.messages[2].content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 't1' })
  })
  it('errors clearly without a key', async () => {
    await expect(new AnthropicProvider({ apiKey: () => undefined, model: () => 'm', baseUrl: 'http://127.0.0.1:1' }).chat(req)).rejects.toThrow(/No Anthropic API key/)
  })
})

describe('OpenAI provider', () => {
  it('maps messages and tool calls', async () => {
    const s = await mockServer((r, res) => json(res, { choices: [{ message: { content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'open_application', arguments: '{"name":"notepad"}' } }] }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 5, completion_tokens: 3 } }))
    servers.push(s)
    const r = await new OpenAIProvider({ apiKey: () => 'sk-x', model: () => 'm', baseUrl: s.url }).chat(req)
    expect(r.toolCalls[0]).toEqual({ id: 'c1', name: 'open_application', args: { name: 'notepad' } })
    expect(r.usage.inputTokens).toBe(5)
    const msgs = s.requests[0].body.messages
    expect(msgs[0].role).toBe('system'); expect(msgs[2].tool_calls[0].function.arguments).toBe('{"name":"chrome"}'); expect(msgs[3]).toMatchObject({ role: 'tool', tool_call_id: 't1' })
    expect(s.requests[0].headers.authorization).toBe('Bearer sk-x')
  })
})

describe('Gemini provider', () => {
  it('maps function calls and replays raw parts', async () => {
    const s = await mockServer((r, res) => json(res, { candidates: [{ content: { parts: [{ functionCall: { name: 'open_application', args: { name: 'x' } }, thoughtSignature: 'sig' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 2 } }))
    servers.push(s)
    const p = new GeminiProvider({ apiKey: () => 'g', model: () => 'models/gemini-x', baseUrl: s.url })
    const r = await p.chat(req)
    expect(r.toolCalls[0].name).toBe('open_application'); expect(r.stop).toBe('tool_use')
    expect(s.requests[0].url).toContain('/v1beta/models/gemini-x:generateContent')
    expect(s.requests[0].body.tools[0].functionDeclarations[0].parameters.properties.name.type).toBe('string')
    await p.chat({ ...req, messages: [...req.messages, { role: 'assistant', text: '', toolCalls: r.toolCalls, raw: r.raw }, { role: 'user', content: 'ok' }] })
    expect(JSON.stringify(s.requests[1].body.contents)).toContain('thoughtSignature')
  })
})

describe('Ollama provider', () => {
  it('parses tool calls, lists models, explains connection failures', async () => {
    const s = await mockServer((r, res) => r.url === '/api/tags' ? json(res, { models: [{ name: 'llama3.1:latest' }] }) : json(res, { message: { content: '', tool_calls: [{ function: { name: 'open_application', arguments: { name: 'calc' } } }] }, prompt_eval_count: 9, eval_count: 4, done: true }))
    servers.push(s)
    const p = new OllamaProvider({ baseUrl: () => s.url, model: () => 'llama3.1' })
    expect((await p.chat(req)).toolCalls[0].args).toEqual({ name: 'calc' })
    expect(await p.listModels()).toEqual(['llama3.1:latest'])
    await expect(new OllamaProvider({ baseUrl: () => 'http://127.0.0.1:1', model: () => 'm' }).chat({ ...req })).rejects.toThrow(/Is Ollama running/)
  })
})

describe('http retry', () => {
  it('retries transient 503 then succeeds; does not retry 401', async () => {
    let n = 0
    const s = await mockServer((r, res) => { n++; if (r.url === '/auth') return json(res, { error: { message: 'bad key' } }, 401); n < 3 ? json(res, { error: 'overloaded' }, 503) : json(res, { ok: true }) })
    servers.push(s)
    expect(await fetchJson(s.url + '/x', { body: '{}', backoffMs: 5 })).toEqual({ ok: true })
    expect(n).toBe(3)
    await expect(fetchJson(s.url + '/auth', { body: '{}', backoffMs: 5 })).rejects.toThrow(/401.*API key/)
  })
  it('honours cancellation', async () => {
    const s = await mockServer(() => { /* hang */ }); servers.push(s)
    const ac = new AbortController(); setTimeout(() => ac.abort(), 50)
    await expect(fetchJson(s.url, { body: '{}', signal: ac.signal })).rejects.toThrow(/cancel/)
  })
})

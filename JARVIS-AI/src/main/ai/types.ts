import type { JsonSchema } from '../core/schema'
import type { ToolImage } from '../core/tools'

export interface ToolSpec { name: string; description: string; inputSchema: JsonSchema }
export interface ToolCall { id: string; name: string; args: Record<string, unknown> }
export type Msg =
  | { role: 'user'; content: string; images?: ToolImage[] }
  | { role: 'assistant'; text: string; toolCalls: ToolCall[]; raw?: unknown }
  | { role: 'tool'; toolCallId: string; name: string; content: string; isError?: boolean; images?: ToolImage[] }

export interface ChatRequest { system: string; messages: Msg[]; tools: ToolSpec[]; signal?: AbortSignal; maxTokens?: number }
export interface ChatResponse {
  text: string
  toolCalls: ToolCall[]
  usage: { inputTokens: number; outputTokens: number }
  stop: 'end' | 'tool_use' | 'length' | 'other'
  raw?: unknown
}
export interface Provider {
  id: 'anthropic' | 'openai' | 'gemini' | 'ollama'
  chat(req: ChatRequest): Promise<ChatResponse>
  listModels(signal?: AbortSignal): Promise<string[]>
}
export class ProviderError extends Error {
  constructor(message: string, public status?: number, public retryable = false) { super(message) }
}

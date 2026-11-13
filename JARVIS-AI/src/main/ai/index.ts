import type { Settings, ProviderId } from '@shared/types'
import type { Provider } from './types'
import type { SecretStore } from '../core/secrets'
import { AnthropicProvider } from './anthropic'
import { OpenAIProvider } from './openai'
import { GeminiProvider } from './gemini'
import { OllamaProvider } from './ollama'

export const SECRET_NAMES: Record<Exclude<ProviderId, 'ollama'>, string> = { anthropic: 'ai.anthropic.key', openai: 'ai.openai.key', gemini: 'ai.gemini.key' }

export function makeProvider(id: ProviderId, getSettings: () => Settings, secrets: SecretStore, baseUrlOverride?: string): Provider {
  const model = () => getSettings().ai.models[id]
  switch (id) {
    case 'anthropic': return new AnthropicProvider({ apiKey: () => secrets.get(SECRET_NAMES.anthropic), model, baseUrl: baseUrlOverride })
    case 'openai': return new OpenAIProvider({ apiKey: () => secrets.get(SECRET_NAMES.openai), model, baseUrl: baseUrlOverride })
    case 'gemini': return new GeminiProvider({ apiKey: () => secrets.get(SECRET_NAMES.gemini), model, baseUrl: baseUrlOverride })
    case 'ollama': return new OllamaProvider({ baseUrl: () => baseUrlOverride ?? getSettings().ai.ollamaUrl, model })
  }
}
export function providerConfigured(id: ProviderId, secrets: SecretStore): boolean {
  return id === 'ollama' ? true : secrets.has(SECRET_NAMES[id])
}
export type { Provider } from './types'

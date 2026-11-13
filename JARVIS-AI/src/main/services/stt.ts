import type { Settings } from '@shared/types'
import type { SecretStore } from '../core/secrets'
import { SECRET_NAMES } from '../ai'

export const STT_BASE = { openai: 'https://api.openai.com', groq: 'https://api.groq.com/openai' } as const
export const GROQ_SECRET = 'stt.groq.key'

export interface SpeechEndpoints { stt?: string; tts?: string }

/** Speech-to-text through an OpenAI-compatible /v1/audio/transcriptions endpoint (OpenAI, Groq). */
export async function transcribeAudio(o: { baseUrl: string; apiKey: string; model: string; data: Uint8Array; filename: string; mime: string; format?: 'json' | 'srt'; prompt?: string; language?: string; signal?: AbortSignal }): Promise<string> {
  if (o.data.byteLength < 800) throw new Error('Recording was too short to transcribe.')
  if (o.data.byteLength > 24 * 1024 * 1024) throw new Error('Audio is larger than the 25 MB transcription limit.')
  const form = new FormData()
  form.set('model', o.model); form.set('response_format', o.format === 'srt' ? 'srt' : 'json')
  if (o.prompt) form.set('prompt', o.prompt); if (o.language) form.set('language', o.language)
  form.set('file', new Blob([o.data as any], { type: o.mime }), o.filename)
  const res = await fetch(`${o.baseUrl}/v1/audio/transcriptions`, { method: 'POST', headers: { authorization: `Bearer ${o.apiKey}` }, body: form, signal: o.signal })
  const body = await res.text()
  if (!res.ok) throw new Error(`Speech recognition failed (HTTP ${res.status}): ${body.slice(0, 200)}${res.status === 401 ? ' (check the API key)' : ''}`)
  if (o.format === 'srt') return body
  try { return String(JSON.parse(body).text ?? '').trim() } catch { return body.trim() }
}

export class SpeechService {
  constructor(private secrets: SecretStore, private getSettings: () => Settings, private ep: SpeechEndpoints = {}) {}
  private sttKey() { const p = this.getSettings().voice.sttProvider; return p === 'groq' ? this.secrets.get(GROQ_SECRET) : p === 'openai' ? this.secrets.get(SECRET_NAMES.openai) : undefined }
  sttReady() { return this.getSettings().voice.sttProvider !== 'none' && !!this.sttKey() }
  sttBase() { return this.ep.stt ?? STT_BASE[this.getSettings().voice.sttProvider === 'groq' ? 'groq' : 'openai'] }
  async transcribe(data: Uint8Array, mime: string, signal?: AbortSignal): Promise<string> {
    const v = this.getSettings().voice
    if (v.sttProvider === 'none') throw new Error('Speech recognition is off. Choose a provider in Settings → Voice.')
    const key = this.sttKey(); if (!key) throw new Error(`No ${v.sttProvider === 'groq' ? 'Groq' : 'OpenAI'} API key is saved for speech recognition (Settings → Voice).`)
    const ext = /ogg/.test(mime) ? 'ogg' : /mp4|m4a/.test(mime) ? 'm4a' : /wav/.test(mime) ? 'wav' : 'webm'
    return transcribeAudio({ baseUrl: this.sttBase(), apiKey: key, model: v.sttModel || 'whisper-1', data, filename: `speech.${ext}`, mime, prompt: 'Jarvis, Hey Jarvis.', signal })
  }
  /** OpenAI text-to-speech; returns mp3 bytes. */
  async synthesize(text: string, signal?: AbortSignal): Promise<Buffer> {
    const v = this.getSettings().voice; const key = this.secrets.get(SECRET_NAMES.openai)
    if (!key) throw new Error('OpenAI TTS needs an OpenAI API key (Settings → AI).')
    const res = await fetch(`${this.ep.tts ?? 'https://api.openai.com'}/v1/audio/speech`, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: v.ttsModel || 'tts-1', voice: v.ttsVoice || 'onyx', input: text.slice(0, 4000), response_format: 'mp3', speed: v.speechRate }), signal })
    if (!res.ok) throw new Error(`Text-to-speech failed (HTTP ${res.status}): ${(await res.text()).slice(0, 200)}`)
    return Buffer.from(await res.arrayBuffer())
  }
}

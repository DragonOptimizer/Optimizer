import { useEffect, useState } from 'react'
import type { ProviderId, ProviderStatus } from '@shared/types'
import { api } from '../lib/api'
import { useUi, updateSettings, toast } from '../lib/store'
import { useAsyncAction } from '../lib/nav'
import { Card, Btn, Field, Toggle, Tag } from '../components/ui'

const PROVIDERS: { id: ProviderId; label: string; secret?: string; link: string; note: string }[] = [
  { id: 'anthropic', label: 'Anthropic Claude', secret: 'ai.anthropic.key', link: 'https://console.anthropic.com/', note: 'Requires an Anthropic API key with billing; a Claude.ai chat subscription does NOT include API credits.' },
  { id: 'openai', label: 'OpenAI', secret: 'ai.openai.key', link: 'https://platform.openai.com/api-keys', note: 'Requires an OpenAI API key with billing; a ChatGPT subscription does NOT include API credits.' },
  { id: 'gemini', label: 'Google Gemini', secret: 'ai.gemini.key', link: 'https://aistudio.google.com/apikey', note: 'Gemini API key from Google AI Studio (free tier limits and paid pricing apply).' },
  { id: 'ollama', label: 'Ollama (local)', link: 'https://ollama.com/download', note: 'Runs models on your PC: no per-token charges. Needs a model that supports tool calling (e.g. llama3.1, qwen3).' }
]

function KeyField({ name, label, has, onSaved }: { name: string; label: string; has: boolean; onSaved: () => void }) {
  const [v, setV] = useState(''); const act = useAsyncAction()
  return <Field label={label}><div className="row"><input type="password" value={v} onChange={(e) => setV(e.target.value)} placeholder={has ? '•••••••• saved (encrypted)' : 'paste key'} /><Btn disabled={!v} onClick={() => void act(async () => { await api.invoke('secrets:set', name, v); setV(''); onSaved() }, 'Key saved securely')}>Save</Btn>{has && <Btn kind="ghost" onClick={() => void act(async () => { await api.invoke('secrets:delete', name); onSaved() }, 'Key removed')}>Remove</Btn>}</div></Field>
}

export function Settings() {
  const s = useUi((x) => x.settings); const [has, setHas] = useState<Record<string, boolean>>({}); const [models, setModels] = useState<string[]>([]); const [provs, setProvs] = useState<ProviderStatus[]>([])
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]); const [devs, setDevs] = useState<MediaDeviceInfo[]>([]); const [usage, setUsage] = useState<any>(null); const [pin, setPin] = useState(''); const act = useAsyncAction(); const [testing, setTesting] = useState(false)
  const refresh = () => { void api.invoke('secrets:has').then(setHas); void api.invoke<ProviderStatus[]>('ai:providers').then(setProvs); void api.invoke('ai:usage').then(setUsage) }
  useEffect(() => {
    refresh()
    const load = () => setVoices(speechSynthesis.getVoices()); load(); speechSynthesis.onvoiceschanged = load
    void navigator.mediaDevices.enumerateDevices().then(setDevs).catch(() => {})
  }, [])
  const P = PROVIDERS.find((p) => p.id === s.ai.provider)!
  const set = (sec: string) => (patch: object) => void updateSettings({ [sec]: patch })
  const ai = set('ai'), voice = set('voice'), profile = set('profile'), ui = set('ui')
  return (
    <div className="page grid2">
      <div className="col">
        <Card title="Personality & profile">
          <Field label="What should JARVIS call you?"><input value={s.profile.preferredName} onChange={(e) => profile({ preferredName: e.target.value })} /></Field>
          <Field label="Personality"><select value={s.profile.personality} onChange={(e) => profile({ personality: e.target.value })}><option value="classic">Classic Jarvis</option><option value="professional">Professional</option><option value="friendly">Friendly</option><option value="humorous">Humorous</option><option value="custom">Custom</option></select></Field>
          {s.profile.personality === 'custom' && <Field label="Custom personality"><textarea rows={3} value={s.profile.customPersonality} onChange={(e) => profile({ customPersonality: e.target.value })} placeholder="Tone: calm, encouraging coach…" /></Field>}
          <Field label="Response length"><select value={s.profile.responseLength} onChange={(e) => profile({ responseLength: e.target.value })}><option value="short">Short</option><option value="medium">Medium</option><option value="long">Detailed</option></select></Field>
          <p className="muted small">JARVIS always identifies as an AI assistant and never impersonates a person.</p>
        </Card>
        <Card title="AI provider & model" right={<Tag kind={provs.find((p) => p.id === s.ai.provider)?.configured ? 'ok' : 'warn'}>{provs.find((p) => p.id === s.ai.provider)?.configured ? 'configured' : 'needs setup'}</Tag>}>
          <Field label="Provider"><select value={s.ai.provider} onChange={(e) => { ai({ provider: e.target.value }); setModels([]) }}>{PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></Field>
          <div className="warn-box"><b>Cost notice.</b> {P.note} Usage is billed per token by the provider; JARVIS does not know current prices. <a href={P.link} target="_blank" rel="noreferrer">Open provider page</a></div>
          {P.secret && <KeyField name={P.secret} label={`${P.label} API key`} has={!!has[P.secret]} onSaved={refresh} />}
          {s.ai.provider === 'ollama' && <Field label="Ollama URL"><input value={s.ai.ollamaUrl} onChange={(e) => ai({ ollamaUrl: e.target.value })} /></Field>}
          <Field label="Model" hint="Type any model id, or load the list from the provider."><div className="row"><input list="models" value={s.ai.models[s.ai.provider]} onChange={(e) => ai({ models: { [s.ai.provider]: e.target.value } })} /><datalist id="models">{models.map((m) => <option key={m} value={m} />)}</datalist>
            <Btn onClick={() => void act(async () => setModels(await api.invoke<string[]>('ai:models', s.ai.provider)), 'Model list loaded')}>Load list</Btn></div></Field>
          <div className="row"><Btn kind="primary" disabled={testing} onClick={() => { setTesting(true); void act(async () => { const r: any = await api.invoke('ai:test'); toast(`✔ ${r.provider}/${r.model} replied “${r.text}” in ${r.ms} ms`); refresh() }).finally(() => setTesting(false)) }}>{testing ? 'Testing…' : 'Test connection'}</Btn></div>
          <h4>Spending protection</h4>
          <div className="row"><Field label="Daily token limit (0 = none)"><input type="number" min={0} value={s.ai.dailyTokenLimit} onChange={(e) => ai({ dailyTokenLimit: Number(e.target.value) })} /></Field><Field label="Per-task token limit"><input type="number" min={0} value={s.ai.taskTokenLimit} onChange={(e) => ai({ taskTokenLimit: Number(e.target.value) })} /></Field><Field label="Max steps per task"><input type="number" min={1} max={25} value={s.ai.maxSteps} onChange={(e) => ai({ maxSteps: Number(e.target.value) })} /></Field></div>
          <div className="row"><Field label="Your $/1M input tokens (optional)"><input type="number" step="0.01" min={0} value={s.ai.costPerMTokIn} onChange={(e) => ai({ costPerMTokIn: Number(e.target.value) })} /></Field><Field label="$/1M output tokens"><input type="number" step="0.01" min={0} value={s.ai.costPerMTokOut} onChange={(e) => ai({ costPerMTokOut: Number(e.target.value) })} /></Field></div>
          {usage && <div className="cost-box">Today: {usage.today.tokensIn.toLocaleString()} in / {usage.today.tokensOut.toLocaleString()} out tokens{usage.limit ? ` of ${usage.limit.toLocaleString()} limit` : ''}{(s.ai.costPerMTokIn || s.ai.costPerMTokOut) ? ` · ≈ $${((usage.today.tokensIn * s.ai.costPerMTokIn + usage.today.tokensOut * s.ai.costPerMTokOut) / 1e6).toFixed(4)} using your rates` : ' · enter your provider’s rates above to see an estimate'}</div>}
        </Card>
      </div>
      <div className="col">
        <Card title="Voice">
          <Toggle checked={s.voice.enabled} onChange={(v) => voice({ enabled: v })} label="Voice conversation enabled" />
          <Toggle checked={s.voice.muted} onChange={(v) => voice({ muted: v })} label="Microphone muted" hint="Instantly stops all listening, including the wake word." />
          <Toggle checked={s.voice.wakeWordEnabled} onChange={(v) => voice({ wakeWordEnabled: v })} label="Wake word (“Hey Jarvis”)" hint="Windows only. Runs the built-in Windows speech recognizer locally/offline for this one phrase; no audio is uploaded. Accuracy varies, so push-to-talk is the dependable fallback." />
          <Field label="Wake phrase"><input value={s.voice.wakePhrase} onChange={(e) => voice({ wakePhrase: e.target.value })} /></Field>
          <Field label="Push-to-talk shortcut (global; press once to start, again to stop)"><input value={s.voice.pushToTalkShortcut} onChange={(e) => voice({ pushToTalkShortcut: e.target.value })} placeholder="Control+Alt+J" /></Field>
          <h4>Speech recognition (speech → text)</h4>
          <Field label="Provider" hint="Audio of your commands is uploaded to this provider for transcription and billed per audio minute by them. Groq and OpenAI both use the OpenAI-compatible API."><select value={s.voice.sttProvider} onChange={(e) => voice({ sttProvider: e.target.value })}><option value="openai">OpenAI (Whisper)</option><option value="groq">Groq (Whisper)</option><option value="none">Off (typing only)</option></select></Field>
          <Field label="Model"><input value={s.voice.sttModel} onChange={(e) => voice({ sttModel: e.target.value })} placeholder={s.voice.sttProvider === 'groq' ? 'whisper-large-v3-turbo' : 'whisper-1'} /></Field>
          {s.voice.sttProvider === 'groq' ? <KeyField name="stt.groq.key" label="Groq API key" has={!!has['stt.groq.key']} onSaved={refresh} /> : s.voice.sttProvider === 'openai' ? <p className="muted small">Uses your OpenAI key {has['ai.openai.key'] ? '(saved ✔)' : '(not saved yet — add it under AI provider → OpenAI)'}.</p> : null}
          <h4>Speech output (text → speech)</h4>
          <Toggle checked={s.voice.speakResponses} onChange={(v) => voice({ speakResponses: v })} label="Speak replies to voice requests" />
          <Field label="Voice engine"><select value={s.voice.ttsProvider} onChange={(e) => voice({ ttsProvider: e.target.value })}><option value="system">Windows voices (free, offline)</option><option value="openai">OpenAI TTS (more natural, billed)</option></select></Field>
          {s.voice.ttsProvider === 'system' ? <Field label="Voice"><select value={s.voice.ttsVoice} onChange={(e) => voice({ ttsVoice: e.target.value })}><option value="">System default</option>{voices.map((v) => <option key={v.name} value={v.name}>{v.name} ({v.lang})</option>)}</select></Field> : <Field label="OpenAI voice"><input value={s.voice.ttsVoice} onChange={(e) => voice({ ttsVoice: e.target.value })} placeholder="onyx" /></Field>}
          <div className="row"><Field label={`Speech speed ${s.voice.speechRate.toFixed(1)}×`}><input type="range" min={0.6} max={1.6} step={0.1} value={s.voice.speechRate} onChange={(e) => voice({ speechRate: Number(e.target.value) })} /></Field><Field label="Listening timeout (s)"><input type="number" min={3} max={60} value={s.voice.listenTimeoutSec} onChange={(e) => voice({ listenTimeoutSec: Number(e.target.value) })} /></Field></div>
          <Field label="Microphone"><select value={s.voice.inputDeviceId} onChange={(e) => voice({ inputDeviceId: e.target.value })}><option value="">Default</option>{devs.filter((d) => d.kind === 'audioinput').map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Microphone'}</option>)}</select></Field>
          <Field label="Audio output (applies to OpenAI TTS; Windows voices use the system default)"><select value={s.voice.outputDeviceId} onChange={(e) => voice({ outputDeviceId: e.target.value })}><option value="">Default</option>{devs.filter((d) => d.kind === 'audiooutput').map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Speaker'}</option>)}</select></Field>
        </Card>
        <Card title="Window & startup">
          <Toggle checked={s.ui.alwaysOnTop} onChange={(v) => ui({ alwaysOnTop: v })} label="Keep main window always on top" />
          <Toggle checked={s.ui.overlayEnabled} onChange={(v) => ui({ overlayEnabled: v })} label="Floating desktop assistant (compact overlay)" />
          <Toggle checked={s.ui.minimizeToTray} onChange={(v) => ui({ minimizeToTray: v })} label="Keep running in the system tray when closed" />
          <Toggle checked={s.ui.startWithWindows} onChange={(v) => ui({ startWithWindows: v })} label="Start with Windows (minimised to tray)" hint="Takes effect in the installed app." />
        </Card>
        <Card title="Setup">
          <Btn onClick={() => void updateSettings({ ui: { onboardingDone: false } })}>Run the first-run setup wizard again</Btn>
        </Card>
        <Card title="App lock (PIN)">
          <p className="small muted">Optional local PIN. While locked, JARVIS refuses all actions except the emergency stop.</p>
          <div className="row"><input type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="4–12 digit PIN" />
            <Btn onClick={() => void act(async () => { await api.invoke('security:set-pin', pin); setPin('') }, 'PIN set')} disabled={!pin}>{s.security.pinEnabled ? 'Change PIN' : 'Set PIN'}</Btn>
            {s.security.pinEnabled && <><Btn onClick={() => void api.invoke('security:lock')}>Lock now</Btn><Btn kind="danger" onClick={() => void act(async () => { const ok = await api.invoke('security:clear-pin', pin); if (!ok) throw new Error('Wrong PIN'); setPin('') }, 'PIN removed')}>Remove PIN</Btn></>}</div>
        </Card>
      </div>
    </div>
  )
}

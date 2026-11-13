import { useEffect, useRef, useState } from 'react'
import type { ProviderId } from '@shared/types'
import { api, errMsg } from '../lib/api'
import { useUi, updateSettings } from '../lib/store'
import { voice } from '../lib/voice'
import { Btn, Field, Toggle } from './ui'

const PROVIDERS: { id: ProviderId; label: string; secret?: string; link: string; note: string }[] = [
  { id: 'anthropic', label: 'Anthropic Claude', secret: 'ai.anthropic.key', link: 'https://console.anthropic.com/', note: 'Needs an Anthropic API key with billing. A Claude.ai chat subscription does NOT include API credits.' },
  { id: 'openai', label: 'OpenAI', secret: 'ai.openai.key', link: 'https://platform.openai.com/api-keys', note: 'Needs an OpenAI API key with billing. A ChatGPT subscription does NOT include API credits.' },
  { id: 'gemini', label: 'Google Gemini', secret: 'ai.gemini.key', link: 'https://aistudio.google.com/apikey', note: 'Gemini API key from Google AI Studio (free-tier limits and paid pricing apply).' },
  { id: 'ollama', label: 'Ollama (runs on this PC)', link: 'https://ollama.com/download', note: 'No per-token cost. Install Ollama, run "ollama pull llama3.1" (a tool-calling model), no key needed.' }
]
const STEPS = ['Welcome', 'AI provider', 'Microphone', 'Speech', 'Windows', 'Finish'] as const
type Result = { ok: boolean; text: string } | null

/** First-run setup: AI key, microphone permission, speech in/out, Windows integrations. Integrations that cost money or touch accounts stay off. */
export function Wizard() {
  const s = useUi((x) => x.settings)
  const [step, setStep] = useState(0)
  const [key, setKey] = useState(''); const [aiRes, setAiRes] = useState<Result>(null); const [busy, setBusy] = useState(false)
  const [micRes, setMicRes] = useState<Result>(null); const [level, setLevel] = useState(0)
  const [sttKey, setSttKey] = useState(''); const [sttRes, setSttRes] = useState<Result>(null); const [ttsRes, setTtsRes] = useState<Result>(null)
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]); const [has, setHas] = useState<Record<string, boolean>>({}); const [diag, setDiag] = useState<{ id: string; status: string; detail: string }[]>([])
  const P = PROVIDERS.find((p) => p.id === s.ai.provider)!
  const refreshHas = () => api.invoke<Record<string, boolean>>('secrets:has').then(setHas)
  useEffect(() => { void refreshHas(); const l = () => setVoices(speechSynthesis.getVoices()); l(); speechSynthesis.onvoiceschanged = l }, [])
  useEffect(() => { if (step === 4) void api.invoke<any[]>('diagnostics:run').then(setDiag) }, [step])

  const saveAndTestAI = async () => {
    setBusy(true); setAiRes(null)
    try {
      if (P.secret && key.trim()) { await api.invoke('secrets:set', P.secret, key.trim()); setKey(''); await refreshHas() }
      const r: any = await api.invoke('ai:test')
      setAiRes({ ok: true, text: `Connected: ${r.provider}/${r.model} replied “${r.text}” in ${r.ms} ms` })
    } catch (e) { setAiRes({ ok: false, text: errMsg(e) }) } finally { setBusy(false) }
  }
  const stream = useRef<MediaStream | null>(null)
  const testMic = async () => {
    setBusy(true); setMicRes(null); setLevel(0)
    try {
      const dev = s.voice.inputDeviceId
      const st = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, ...(dev ? { deviceId: { exact: dev } } : {}) } }); stream.current = st
      const ctx = new AudioContext(); const an = ctx.createAnalyser(); an.fftSize = 1024; ctx.createMediaStreamSource(st).connect(an)
      const buf = new Float32Array(an.fftSize); let peak = 0; const t0 = performance.now()
      await new Promise<void>((res) => { const iv = setInterval(() => { an.getFloatTimeDomainData(buf); let sum = 0; for (const x of buf) sum += x * x; const l = Math.sqrt(sum / buf.length); peak = Math.max(peak, l); setLevel(Math.min(1, l * 8)); if (performance.now() - t0 > 3500) { clearInterval(iv); res() } }, 50) })
      st.getTracks().forEach((t) => t.stop()); void ctx.close(); setLevel(0)
      const label = st.getAudioTracks()[0]?.label || 'default microphone'
      setMicRes(peak > 0.004 ? { ok: true, text: `Microphone works (${label}); signal detected.` } : { ok: false, text: `Microphone is allowed (${label}) but I heard almost no sound. Speak while testing, check it is not muted, or pick another device in Settings → Voice.` })
    } catch (e) {
      const n = (e as DOMException).name
      setMicRes({ ok: false, text: n === 'NotAllowedError' ? 'Windows or the app blocked the microphone. Open Windows microphone settings and allow desktop apps to use it.' : n === 'NotFoundError' ? 'No microphone was found. Plug one in or choose another input.' : errMsg(e) })
    } finally { setBusy(false) }
  }
  const saveStt = async () => {
    setBusy(true); setSttRes(null)
    try {
      const name = s.voice.sttProvider === 'groq' ? 'stt.groq.key' : 'ai.openai.key'
      if (sttKey.trim()) { await api.invoke('secrets:set', name, sttKey.trim()); setSttKey(''); await refreshHas() }
      const ok = s.voice.sttProvider === 'none' || (await api.invoke<Record<string, boolean>>('secrets:has'))[name]
      setSttRes(ok ? { ok: true, text: s.voice.sttProvider === 'none' ? 'Voice input off: you can type, and turn it on later.' : 'Key saved securely. It is used when you speak a command.' } : { ok: false, text: 'No key saved yet.' })
    } catch (e) { setSttRes({ ok: false, text: errMsg(e) }) } finally { setBusy(false) }
  }
  const hearSample = async () => {
    setTtsRes(null)
    try { await voice.speak(`Hello ${s.profile.preferredName || 'there'}. I am Jarvis, your A.I. assistant. Can you hear me?`, true); setTtsRes({ ok: true, text: 'Played. If you heard it, speech output works.' }) } catch (e) { setTtsRes({ ok: false, text: errMsg(e) }) }
  }
  const finish = async () => { await updateSettings({ ui: { onboardingDone: true } }) }
  const sttNeed = s.voice.sttProvider === 'groq' ? 'stt.groq.key' : 'ai.openai.key'
  const win = (window as any).jarvisEnv?.platform === 'win32'
  const speechLang = diag.find((d) => d.id === 'speechlang')

  return (
    <div className="modal-back wizard-back" role="dialog" aria-modal="true" aria-label="First-run setup">
      <div className="wizard wizard-box">
        <div className="wiz-steps">{STEPS.map((t, i) => <span key={t} className={`wiz-step ${i === step ? 'on' : i < step ? 'done' : ''}`}>{i + 1}. {t}</span>)}</div>
        <div className="wiz-body">
          {step === 0 && <><h2>Welcome to JARVIS</h2>
            <p>I’m an A.I. assistant that runs on this PC. This quick setup takes a couple of minutes: connect an AI provider, test your microphone and voice, and choose how I fit into Windows.</p>
            <ul className="small bullets"><li>Nothing sensitive runs without your approval: sending messages, calls, screenshots and deleting always ask first.</li><li><b>Email, Google Classroom, Telegram and phone calls are OFF.</b> They stay disabled until you set each one up yourself later.</li><li>Your keys are stored encrypted by Windows (DPAPI) and never shown again.</li></ul>
            <Field label="What should I call you?"><input value={s.profile.preferredName} onChange={(e) => void updateSettings({ profile: { preferredName: e.target.value } })} /></Field></>}

          {step === 1 && <><h2>Connect an AI provider</h2>
            <Field label="Provider"><select className="wiz-provider" value={s.ai.provider} onChange={(e) => { void updateSettings({ ai: { provider: e.target.value } }); setAiRes(null) }}>{PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></Field>
            <div className="warn-box"><b>Costs:</b> {P.note} Usage is billed by the provider; JARVIS limits tokens per day and per task (change in Settings). <a href={P.link} target="_blank" rel="noreferrer">Open provider page</a></div>
            {P.secret && <Field label={`${P.label} API key`} hint={has[P.secret] ? 'A key is already saved (encrypted). Leave blank to keep it.' : undefined}><input className="wiz-key" type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="paste your API key" autoComplete="off" /></Field>}
            <Field label="Model" hint="You can change it later; Settings can load the provider’s model list."><input value={s.ai.models[s.ai.provider]} onChange={(e) => void updateSettings({ ai: { models: { [s.ai.provider]: e.target.value } } })} /></Field>
            <Btn kind="primary" disabled={busy || (!!P.secret && !key.trim() && !has[P.secret])} onClick={() => void saveAndTestAI()}>{busy ? 'Testing…' : 'Save & test connection'}</Btn>
            {aiRes && <div className={`wiz-res ${aiRes.ok ? 'wiz-ok' : 'wiz-bad'}`}>{aiRes.text}</div>}</>}

          {step === 2 && <><h2>Microphone</h2>
            <p>Press the button and say a few words. You should see the meter move.</p>
            <div className="meter"><i style={{ width: `${Math.round(level * 100)}%` }} /></div>
            <div className="row"><Btn kind="primary" disabled={busy} onClick={() => void testMic()}>{busy ? 'Listening for 3 seconds…' : 'Test microphone'}</Btn>{win && <Btn onClick={() => void api.invoke('app:open-mic-settings')}>Open Windows microphone settings</Btn>}</div>
            {micRes && <div className={`wiz-res ${micRes.ok ? 'wiz-ok' : 'wiz-bad'}`}>{micRes.text}</div>}
            <p className="muted small">The microphone is only open while you talk to me; the main screen shows a red “MIC LIVE” badge whenever it is on. You can mute it instantly at any time.</p></>}

          {step === 3 && <><h2>Speech: hearing you and talking back</h2>
            <h4>Speech recognition (your voice → text)</h4>
            <Field label="Provider" hint="Your spoken commands are uploaded to this provider for transcription and billed per audio minute by them."><select className="wiz-stt" value={s.voice.sttProvider} onChange={(e) => { void updateSettings({ voice: { sttProvider: e.target.value } }); setSttRes(null) }}><option value="openai">OpenAI Whisper</option><option value="groq">Groq Whisper</option><option value="none">Off (typing only)</option></select></Field>
            {s.voice.sttProvider !== 'none' && <Field label={s.voice.sttProvider === 'groq' ? 'Groq API key' : 'OpenAI API key'} hint={has[sttNeed] ? 'A key is already saved. Leave blank to keep it.' : s.voice.sttProvider === 'openai' && s.ai.provider === 'openai' ? 'Use the same OpenAI key as above.' : undefined}><input className="wiz-stt-key" type="password" value={sttKey} onChange={(e) => setSttKey(e.target.value)} placeholder="paste key" autoComplete="off" /></Field>}
            <Btn disabled={busy} onClick={() => void saveStt()}>Save speech settings</Btn>
            {sttRes && <div className={`wiz-res ${sttRes.ok ? 'wiz-ok' : 'wiz-bad'}`}>{sttRes.text}</div>}
            <h4>Speech output (me → you)</h4>
            <Field label="Voice"><select value={s.voice.ttsVoice} onChange={(e) => void updateSettings({ voice: { ttsVoice: e.target.value, ttsProvider: 'system' } })}><option value="">Windows default</option>{voices.map((v) => <option key={v.name} value={v.name}>{v.name} ({v.lang})</option>)}</select></Field>
            <Toggle checked={s.voice.speakResponses} onChange={(v) => void updateSettings({ voice: { speakResponses: v } })} label="Speak replies to my voice commands" />
            <Btn onClick={() => void hearSample()}>🔊 Hear a sample</Btn>{ttsRes && <div className={`wiz-res ${ttsRes.ok ? 'wiz-ok' : 'wiz-bad'}`}>{ttsRes.text}</div>}</>}

          {step === 4 && <><h2>Windows integration</h2>
            <Toggle checked={s.ui.minimizeToTray} onChange={(v) => void updateSettings({ ui: { minimizeToTray: v } })} label="Keep running in the system tray when I close the window" hint="Needed for the wake word and scheduled reminders to keep working." />
            <Toggle checked={s.ui.startWithWindows} onChange={(v) => void updateSettings({ ui: { startWithWindows: v } })} label="Start JARVIS when I sign in to Windows" hint="Starts minimised to the tray. Works in the installed app." />
            <Toggle checked={s.ui.overlayEnabled} onChange={(v) => void updateSettings({ ui: { overlayEnabled: v } })} label="Show the small floating assistant" />
            <Toggle checked={s.voice.wakeWordEnabled} onChange={(v) => void updateSettings({ voice: { wakeWordEnabled: v } })} label="Wake word “Hey Jarvis” (offline, uses Windows speech recognition)" hint={win ? (speechLang ? (speechLang.status === 'ok' ? `Windows speech recognizer found (${speechLang.detail}).` : speechLang.detail) : 'Checking Windows speech recognizer…') : 'Windows only.'} />
            <Field label="Push-to-talk shortcut (works everywhere; press once to start)"><input value={s.voice.pushToTalkShortcut} onChange={(e) => void updateSettings({ voice: { pushToTalkShortcut: e.target.value } })} /></Field>
            <p className="muted small">The installer already created the Start menu and desktop shortcuts. Emergency stop: the red STOP button, the tray menu, or Ctrl+Alt+Shift+X.</p></>}

          {step === 5 && <><h2>All set, {s.profile.preferredName || 'sir'}</h2>
            <ul className="small bullets">
              <li>AI: {s.ai.provider} ({s.ai.models[s.ai.provider]}) {(P.secret ? has[P.secret] : true) ? '✔' : '— no key yet (Settings → AI)'}</li>
              <li>Voice input: {s.voice.sttProvider === 'none' ? 'off (typing)' : `${s.voice.sttProvider} ${has[sttNeed] ? '✔' : '— no key yet'}`}</li>
              <li>Wake word: {s.voice.wakeWordEnabled ? 'on' : 'off'} · Push-to-talk: {s.voice.pushToTalkShortcut}</li>
              <li>Gmail, Classroom, Telegram, phone calls: <b>off</b> (enable later under their pages)</li>
            </ul>
            <p>Try it: press <b>Finish</b>, click <b>Talk</b> and say “What time is it?”. Or type “Open Notepad.”</p></>}
        </div>
        <div className="wiz-foot">
          <Btn kind="ghost" onClick={() => void finish()}>Skip setup</Btn>
          <div className="row">{step > 0 && <Btn onClick={() => setStep(step - 1)}>Back</Btn>}{step < STEPS.length - 1 ? <Btn kind="primary" onClick={() => setStep(step + 1)}>Next</Btn> : <Btn kind="primary" onClick={() => void finish()}>Finish setup</Btn>}</div>
        </div>
      </div>
    </div>
  )
}

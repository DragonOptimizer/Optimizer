import { api, errMsg } from './api'
import { getState, setState, toast } from './store'

/** Real-time voice I/O in the renderer: mic capture + VAD, cloud STT via main, speech synthesis, barge-in. */
class VoiceEngine {
  level = 0          // live mic level 0..1 (read by the orb/visualizer every frame, no React re-render)
  outLevel = 0       // live output level 0..1
  freq: Uint8Array = new Uint8Array(0)
  private ctx: AudioContext | null = null
  private stream: MediaStream | null = null
  private analyser: AnalyserNode | null = null
  private rec: MediaRecorder | null = null
  private listening = false
  private cancelListen: (() => void) | null = null
  private audioEl: HTMLAudioElement | null = null
  private speakingFlag = false
  private bargeTimer: number | null = null
  private started = false

  start() {
    if (this.started) return; this.started = true
    api.on('event:ptt', ({ mode }) => { if (mode === 'wake') void this.onWake(); else this.toggle() })
    api.on('event:speak', ({ text, interrupt }) => { if (text) void this.speak(text, !!interrupt) })
    api.on('event:stop', () => { this.cancelAll() })
  }
  private s() { return getState().settings.voice }
  isListening() { return this.listening }
  isSpeaking() { return this.speakingFlag }

  toggle() { if (this.listening) this.cancelListen?.(); else void this.listenAndSend() }
  cancelAll() { this.cancelListen?.(); this.stopSpeaking(); setState({ conversationMode: false }) }

  private async onWake() {
    const v = this.s(); if (!v.enabled || v.muted) return
    this.stopSpeaking()
    const name = getState().settings.profile.preferredName || 'sir'
    await this.speak(`Yes, ${name}?`, true)
    await this.listenAndSend()
  }

  private async openMic(): Promise<AnalyserNode> {
    if (this.stream && this.analyser && this.ctx) return this.analyser
    const dev = this.s().inputDeviceId
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, ...(dev ? { deviceId: { exact: dev } } : {}) } })
    } catch (e) {
      const n = (e as DOMException).name
      throw new Error(n === 'NotAllowedError' ? 'Microphone access was denied. Allow it in Windows Settings → Privacy → Microphone.' : n === 'NotFoundError' ? 'No microphone was found.' : `Microphone error: ${(e as Error).message}`)
    }
    this.ctx = new AudioContext(); const src = this.ctx.createMediaStreamSource(this.stream)
    this.analyser = this.ctx.createAnalyser(); this.analyser.fftSize = 1024; this.analyser.smoothingTimeConstant = 0.6; src.connect(this.analyser)
    this.freq = new Uint8Array(this.analyser.frequencyBinCount)
    setState({ micLive: true })
    return this.analyser
  }
  closeMic() {
    this.stream?.getTracks().forEach((t) => t.stop()); this.stream = null
    void this.ctx?.close(); this.ctx = null; this.analyser = null; this.level = 0; setState({ micLive: false })
  }
  private rms(a: AnalyserNode, buf: Float32Array<ArrayBuffer>) { a.getFloatTimeDomainData(buf); let s = 0; for (const x of buf) s += x * x; a.getByteFrequencyData(this.freq as Uint8Array<ArrayBuffer>); return Math.sqrt(s / buf.length) }

  /** Records one utterance using voice-activity detection. Resolves with audio, or null if nobody spoke / cancelled. */
  private async recordUtterance(): Promise<Blob | null> {
    const a = await this.openMic()
    const buf = new Float32Array(a.fftSize)
    const timeout = this.s().listenTimeoutSec * 1000
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : ''
    const chunks: Blob[] = []
    this.rec = new MediaRecorder(this.stream!, mime ? { mimeType: mime } : undefined)
    this.rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
    return new Promise((resolve) => {
      let floor = 0.01, calib = 0, spoke = false, loud = 0, silentSince = 0
      const t0 = performance.now(); let done = false
      const finish = (keep: boolean) => {
        if (done) return; done = true; clearInterval(iv); this.cancelListen = null
        const r = this.rec!; r.onstop = () => resolve(keep && spoke ? new Blob(chunks, { type: r.mimeType || 'audio/webm' }) : null)
        r.state !== 'inactive' ? r.stop() : resolve(null)
      }
      this.cancelListen = () => finish(false)
      this.rec!.start(250)
      const iv = window.setInterval(() => {
        const l = this.rms(a, buf); this.level = Math.min(1, l * 6)
        const now = performance.now()
        if (now - t0 < 400) { floor = Math.max(floor * 0.5 + l * 0.5, 0.004); calib++; return }
        const thr = Math.max(0.018, floor * 3.2)
        if (l > thr) { loud++; silentSince = 0; if (loud >= 2) spoke = true } else { loud = 0; if (spoke && !silentSince) silentSince = now; else if (!spoke) floor = floor * 0.95 + l * 0.05 }
        if (spoke && silentSince && now - silentSince > 900) finish(true)
        else if (!spoke && now - t0 > timeout) finish(false)
        else if (now - t0 > 30_000) finish(true)
      }, 40)
      void calib
    })
  }

  async listenAndSend(): Promise<void> {
    const v = this.s()
    if (!v.enabled) return toast('Voice is disabled in Settings.', 'error')
    if (v.muted) return toast('Microphone is muted. Unmute to talk.', 'error')
    if (this.listening) return
    this.stopSpeaking(); this.listening = true
    void api.invoke('app:set-state', 'listening'); setState({ voiceNote: 'Listening…' })
    try {
      const blob = await this.recordUtterance()
      this.closeMic(); this.listening = false; void api.invoke('app:set-state', 'idle')
      if (!blob) { setState({ voiceNote: '' }); if (getState().conversationMode) setState({ conversationMode: false }); return }
      setState({ voiceNote: 'Transcribing…' })
      let text = ''
      const t0 = performance.now()
      for (let attempt = 0; attempt < 2; attempt++) {
        try { text = await api.invoke<string>('voice:transcribe', await blob.arrayBuffer(), blob.type); break }
        catch (e) { if (attempt === 1 || /key|denied|off|short/i.test(errMsg(e))) throw e; await new Promise((r) => setTimeout(r, 800)) } // automatic recovery from transient voice-service errors
      }
      void api.invoke('metrics:report', 'stt_ms', Math.round(performance.now() - t0))
      setState({ voiceNote: '' })
      text = text.trim()
      if (!text || /^(you\.?|thanks for watching\.?)$/i.test(text)) { toast('I did not catch that.'); return }
      await api.invoke('chat:send', { text, source: 'voice' })
    } catch (e) {
      this.closeMic(); this.listening = false; void api.invoke('app:set-state', 'idle'); setState({ voiceNote: '', conversationMode: false }); toast(errMsg(e), 'error')
    }
  }

  // ───────── speech output
  stopSpeaking() {
    if (this.bargeTimer) { clearInterval(this.bargeTimer); this.bargeTimer = null }
    window.speechSynthesis?.cancel(); if (this.audioEl) { this.audioEl.pause(); this.audioEl.src = '' ; this.audioEl = null }
    this.outLevel = 0
    if (!this.listening && this.stream) this.closeMic()
    if (this.speakingFlag) { this.speakingFlag = false; void api.invoke('app:set-state', 'idle') }
  }
  async speak(text: string, interrupt = false): Promise<void> {
    const v = this.s(); if (!v.enabled && !interrupt) return
    if (interrupt) this.stopSpeaking()
    const clean = text.replace(/[*_`#>]/g, '').replace(/\s+/g, ' ').trim(); if (!clean) return
    this.speakingFlag = true; void api.invoke('app:set-state', 'speaking')
    this.startBargeIn()
    const t0 = performance.now()
    try {
      if (v.ttsProvider === 'openai') await this.speakOpenAI(clean, t0)
      else await this.speakSystem(clean, t0)
    } catch (e) { toast(`Speech output failed: ${errMsg(e)}`, 'error'); if (v.ttsProvider === 'openai') await this.speakSystem(clean, t0).catch(() => {}) }
    const was = this.speakingFlag
    this.stopSpeaking()
    if (was && getState().conversationMode && !getState().settings.voice.muted) void this.listenAndSend()
  }
  private speakSystem(text: string, t0: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const synth = window.speechSynthesis; if (!synth) return reject(new Error('Speech synthesis is unavailable'))
      const u = new SpeechSynthesisUtterance(text); const v = this.s(); u.rate = v.speechRate
      const voice = synth.getVoices().find((x) => x.name === v.ttsVoice); if (voice) u.voice = voice
      let first = true
      u.onstart = () => { void api.invoke('metrics:report', 'tts_ms', Math.round(performance.now() - t0)) }
      u.onboundary = () => { if (first) first = false; this.outLevel = 0.9; setTimeout(() => { this.outLevel *= 0.5 }, 120) } // real word-boundary events
      u.onend = () => resolve(); u.onerror = (e) => (e.error === 'interrupted' || e.error === 'canceled') ? resolve() : reject(new Error(e.error))
      synth.speak(u)
    })
  }
  private async speakOpenAI(text: string, t0: number): Promise<void> {
    const b64 = await api.invoke<string>('voice:synthesize', text)
    const el = new Audio(`data:audio/mpeg;base64,${b64}`); this.audioEl = el
    const dev = this.s().outputDeviceId; if (dev && 'setSinkId' in el) await (el as any).setSinkId(dev).catch(() => {})
    const ac = new AudioContext(); const an = ac.createAnalyser(); an.fftSize = 512; ac.createMediaElementSource(el).connect(an); an.connect(ac.destination)
    const buf = new Float32Array(an.fftSize)
    const iv = window.setInterval(() => { an.getFloatTimeDomainData(buf); let s = 0; for (const x of buf) s += x * x; this.outLevel = Math.min(1, Math.sqrt(s / buf.length) * 5) }, 40)
    try { await new Promise<void>((res, rej) => { el.onended = () => res(); el.onerror = () => rej(new Error('Audio playback failed')); el.onpause = () => res(); void el.play().then(() => { void api.invoke('metrics:report', 'tts_ms', Math.round(performance.now() - t0)) }).catch(rej) }) }
    finally { clearInterval(iv); void ac.close() }
  }

  /** While the assistant speaks, watch the mic (echo-cancelled) and stop talking if the user starts speaking. */
  private startBargeIn() {
    const v = this.s(); if (!v.enabled || v.muted || this.bargeTimer) return
    void this.openMic().then((a) => {
      const buf = new Float32Array(a.fftSize); let over = 0
      this.bargeTimer = window.setInterval(() => {
        if (!this.speakingFlag) return
        const l = this.rms(a, buf); this.level = Math.min(1, l * 6)
        over = l > 0.09 ? over + 1 : 0
        if (over >= 8) { // ~320 ms of clear speech
          this.stopSpeaking(); this.closeMic(); void this.listenAndSend()
        }
      }, 40)
    }).catch(() => { /* barge-in is best-effort */ })
  }
}
export const voice = new VoiceEngine()

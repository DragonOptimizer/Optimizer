import { spawn, type ChildProcess } from 'node:child_process'
import type { Logger } from '../core/logger'

/**
 * Offline wake-phrase detection using the Windows built-in speech recognizer (System.Speech) with a tiny
 * single-phrase grammar. No audio leaves the PC and no extra software is installed. Windows only.
 */
export const WAKE_SCRIPT = `
Add-Type -AssemblyName System.Speech
$phrase = $env:JARVIS_WAKE_PHRASE
$min = [double]$env:JARVIS_WAKE_CONFIDENCE
$rec = New-Object System.Speech.Recognition.SpeechRecognitionEngine
$gb = New-Object System.Speech.Recognition.GrammarBuilder
$gb.Append($phrase)
$rec.LoadGrammar((New-Object System.Speech.Recognition.Grammar($gb)))
$rec.SetInputToDefaultAudioDevice()
Register-ObjectEvent -InputObject $rec -EventName SpeechRecognized -Action {
  if ($Event.SourceEventArgs.Result.Confidence -ge $min) { [Console]::Out.WriteLine('WAKE ' + $Event.SourceEventArgs.Result.Confidence); [Console]::Out.Flush() }
} | Out-Null
$rec.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple)
[Console]::Out.WriteLine('READY'); [Console]::Out.Flush()
while ($true) { Start-Sleep -Seconds 1 }
`

export type WakeStatus = { active: boolean; error?: string }
export type Spawner = (cmd: string, args: string[], env: NodeJS.ProcessEnv) => ChildProcess

export class WakeWordService {
  private proc: ChildProcess | null = null
  private lastFire = 0
  private status: WakeStatus = { active: false }
  constructor(private log: Logger, private onWake: (confidence: number) => void, private platform: NodeJS.Platform = process.platform, private spawner: Spawner = (c, a, e) => spawn(c, a, { env: e, windowsHide: true })) {}
  getStatus() { return this.status }
  /** Pure parser, unit-tested. */
  static parseLine(line: string): { type: 'ready' } | { type: 'wake'; confidence: number } | null {
    const t = line.trim(); if (t === 'READY') return { type: 'ready' }
    const m = /^WAKE\s+([0-9.]+)$/.exec(t); return m ? { type: 'wake', confidence: Number(m[1]) } : null
  }
  start(phrase: string, minConfidence = 0.75) {
    this.stop()
    if (this.platform !== 'win32') { this.status = { active: false, error: `Offline wake word uses the Windows speech recognizer and is unavailable on ${this.platform}. Use push-to-talk.` }; return this.status }
    const clean = phrase.replace(/[^\p{L}\p{N} ]/gu, '').trim()
    if (clean.split(/\s+/).length < 2 || clean.length < 5) { this.status = { active: false, error: 'The wake phrase should be at least two words (e.g. "hey jarvis"): single short words are unreliable.' }; return this.status }
    const encoded = Buffer.from(WAKE_SCRIPT, 'utf16le').toString('base64')
    const p = this.spawner('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { ...process.env, JARVIS_WAKE_PHRASE: clean, JARVIS_WAKE_CONFIDENCE: String(minConfidence) })
    this.proc = p; this.status = { active: true }
    let buf = ''
    p.stdout?.on('data', (d) => {
      buf += d; let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const ev = WakeWordService.parseLine(buf.slice(0, i)); buf = buf.slice(i + 1)
        if (ev?.type === 'wake' && Date.now() - this.lastFire > 2500) { this.lastFire = Date.now(); this.onWake(ev.confidence) }
      }
    })
    let err = ''
    p.stderr?.on('data', (d) => { err += d })
    p.on('exit', (code) => { if (this.proc === p) { this.proc = null; this.status = { active: false, error: code ? `Wake word engine stopped: ${err.trim().slice(0, 200) || 'exit ' + code} (is a Windows speech language installed and a microphone available?)` : undefined }; if (code) this.log.warn('wakeword', this.status.error!) } })
    p.on('error', (e) => { this.status = { active: false, error: e.message }; this.proc = null })
    return this.status
  }
  stop() { if (this.proc) { const p = this.proc; this.proc = null; try { p.kill() } catch { /* ignore */ } } this.status = { active: false } }
}

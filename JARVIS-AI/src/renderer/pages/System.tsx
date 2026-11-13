import { useEffect, useState } from 'react'
import type { AuditEntry, DiagnosticCheck, LogEntry } from '@shared/types'
import { api } from '../lib/api'
import { useUi } from '../lib/store'
import { useAsyncAction } from '../lib/nav'
import { Card, Btn, Tag, Toggle, fmtTime, fmtDateTime, RiskBadge } from '../components/ui'
import { updateSettings } from '../lib/store'

export function Privacy() {
  const s = useUi((x) => x.settings); const [audit, setAudit] = useState<AuditEntry[]>([]); const act = useAsyncAction(); const [stopped, setStopped] = useState(false)
  useEffect(() => { void api.invoke<AuditEntry[]>('audit:list').then(setAudit) }, [])
  const wipe = (scope: string) => act(async () => { const ok = await api.invoke('privacy:wipe', scope); if (ok) setAudit(await api.invoke('audit:list')) }, undefined)
  return (
    <div className="page grid2">
      <div className="col">
        <Card title="Emergency controls">
          <div className="row"><Btn kind="danger" onClick={() => void act(async () => { await api.invoke('app:stop-all'); setStopped(true) }, 'Everything stopped')}>■ EMERGENCY STOP</Btn><Btn onClick={() => void act(async () => { await api.invoke('app:resume'); setStopped(false) }, 'Resumed')}>Resume</Btn></div>
          <p className="small muted">Stops all running tasks, denies pending approvals, closes the automation browser, stops listening and the wake word, and blocks every tool and phone call until you resume. Also: global shortcut <code>Ctrl+Alt+Shift+X</code>, the tray menu, or <code>/stop</code> from your paired phone. {stopped && <b>Currently stopped.</b>}</p>
        </Card>
        <Card title="What JARVIS can access">
          <ul className="small bullets">
            <li><b>Microphone:</b> {s.voice.muted ? 'muted' : s.voice.enabled ? 'only opens while you talk (and briefly while it speaks, to let you interrupt)' : 'voice disabled'}. The indicator on the main screen shows when it is live.{s.voice.wakeWordEnabled && ' The offline wake word keeps listening locally for one phrase.'}</li>
            <li><b>Files:</b> Desktop, Documents, Downloads, JARVIS Workspace{s.computer.allowedRoots.length ? ' + ' + s.computer.allowedRoots.join(', ') : ''}. Deleting goes to the Recycle Bin and always asks.</li>
            <li><b>Computer control:</b> {s.computer.enabled ? `on (${s.computer.approvalMode} mode)` : 'off'}. Shell access is never given to the AI.</li>
            <li><b>Cloud:</b> your requests go to {s.ai.provider}{s.ai.provider === 'ollama' ? ' running locally (nothing leaves your PC)' : ''}{s.voice.sttProvider !== 'none' ? `; voice audio goes to ${s.voice.sttProvider}` : ''}.</li>
            <li><b>Web/email/PDF content</b> is treated as untrusted data. After JARVIS reads such content, further actions need your approval.</li>
            <li><b>Secrets</b> (API keys, tokens) are encrypted with Windows DPAPI and never shown or logged.</li>
          </ul>
        </Card>
        <Card title="Your data">
          <div className="row wrap">
            <Btn onClick={() => void act(async () => { const p = await api.invoke<string>('privacy:export'); return p }, 'Exported to your JARVIS Workspace folder')}>Export my data</Btn>
            <Btn onClick={() => void api.invoke('app:open-data-dir')}>Open data folder</Btn>
            <Btn onClick={() => void act(async () => { await api.invoke('privacy:revoke-grants') }, 'All “always allow” grants revoked')}>Revoke “always allow”</Btn>
          </div>
          <h4>Delete</h4>
          <div className="row wrap">{[['conversations', 'Conversations'], ['memory', 'Memory'], ['history', 'Task & activity history'], ['secrets', 'All keys & connections'], ['everything', 'Everything']].map(([k, l]) => <Btn key={k} kind="danger" onClick={() => void wipe(k)}>{l}</Btn>)}</div>
        </Card>
      </div>
      <Card title="Access log (every tool decision)">
        <div className="auditlist">{audit.map((a) => <div key={a.id} className="row between audit"><span className="small">{fmtDateTime(a.ts)} · {a.actor}</span><code>{a.tool}</code><RiskBadge r={a.risk} /><span className="small muted">{a.decision}</span></div>)}</div>
      </Card>
    </div>
  )
}

export function Diagnostics() {
  const [checks, setChecks] = useState<DiagnosticCheck[]>([]); const [logs, setLogs] = useState<LogEntry[]>([]); const [mic, setMic] = useState<DiagnosticCheck[]>([]); const [busy, setBusy] = useState(false); const act = useAsyncAction()
  const run = async () => {
    setBusy(true)
    try {
      setChecks(await api.invoke<DiagnosticCheck[]>('diagnostics:run')); setLogs(await api.invoke<LogEntry[]>('diagnostics:logs'))
      const m: DiagnosticCheck[] = []
      try { const p = await navigator.permissions.query({ name: 'microphone' as PermissionName }); m.push({ id: 'micperm', label: 'Microphone permission', status: p.state === 'granted' ? 'ok' : p.state === 'denied' ? 'fail' : 'warn', detail: p.state === 'prompt' ? 'Not asked yet; you will be prompted the first time you press Talk.' : p.state }) } catch { m.push({ id: 'micperm', label: 'Microphone permission', status: 'unknown', detail: 'Cannot query.' }) }
      const d = await navigator.mediaDevices.enumerateDevices(); m.push({ id: 'mics', label: 'Audio devices', status: d.some((x) => x.kind === 'audioinput') ? 'ok' : 'fail', detail: `${d.filter((x) => x.kind === 'audioinput').length} input(s), ${d.filter((x) => x.kind === 'audiooutput').length} output(s)` })
      m.push({ id: 'tts', label: 'Windows speech voices', status: speechSynthesis.getVoices().length ? 'ok' : 'warn', detail: `${speechSynthesis.getVoices().length} voices available` })
      setMic(m)
    } finally { setBusy(false) }
  }
  useEffect(() => { void run() }, [])
  const col = (s: string) => (s === 'ok' ? 'ok' : s === 'fail' ? 'err' : s === 'warn' ? 'warn' : 'mute') as any
  return (
    <div className="page grid2">
      <div className="col">
        <Card title="System diagnostics" right={<Btn onClick={() => void run()} disabled={busy}>{busy ? 'Checking…' : 'Re-run checks'}</Btn>}>
          {[...checks, ...mic].map((c) => <div key={c.id} className="check"><Tag kind={col(c.status)}>{c.status}</Tag><div><b>{c.label}</b><div className="muted small">{c.detail}</div></div></div>)}
        </Card>
        <Card title="Self-test"><div className="row"><Btn onClick={() => void act(async () => { const r: any = await api.invoke('ai:test'); return r }, 'AI test passed — see Settings for timing')}>Test AI request</Btn></div></Card>
      </div>
      <Card title="Structured log (this session)" right={<Btn kind="ghost" onClick={() => void api.invoke('app:open-data-dir')}>Open log folder</Btn>}>
        <div className="logs">{[...logs].reverse().map((l, i) => <div key={i} className={`log l-${l.level}`}><span>{fmtTime(l.ts)}</span><b>{l.level}</b><i>{l.scope}</i> {l.msg}</div>)}</div>
      </Card>
    </div>
  )
}
void Toggle; void updateSettings

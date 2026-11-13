import type React from 'react'
import { useEffect, useState } from 'react'
import { initStore, useUi, toast } from './lib/store'
import { useRoute, go } from './lib/nav'
import { api, errMsg } from './lib/api'
import { voice } from './lib/voice'
import { ApprovalDialog } from './components/Approval'
import { Home } from './pages/Home'
import { Computer } from './pages/Computer'
import { Apps, Email, Classroom, Messaging } from './pages/Apps'
import { Phone } from './pages/Phone'
import { Video } from './pages/Video'
import { History, Automations, Memory } from './pages/Data'
import { Settings } from './pages/Settings'
import { Privacy, Diagnostics } from './pages/System'
import { Overlay } from './pages/Overlay'

const NAV: [string, string, string][] = [
  ['home', '◉', 'Conversation'], ['computer', '🖥', 'Computer'], ['apps', '🧩', 'Connected apps'], ['email', '✉', 'Email'], ['classroom', '🎓', 'Classroom'], ['video', '🎬', 'Video editing'],
  ['phone', '📞', 'Phone calls'], ['messaging', '💬', 'Messaging'], ['history', '🕘', 'Task history'], ['automations', '⏱', 'Automations'], ['memory', '🧠', 'Memory'],
  ['settings', '⚙', 'Settings'], ['privacy', '🛡', 'Privacy & security'], ['diagnostics', '🩺', 'Diagnostics']
]
const PAGES: Record<string, () => React.JSX.Element> = { home: Home, computer: Computer, apps: Apps, email: Email, classroom: Classroom, video: Video, phone: Phone, messaging: Messaging, history: History, automations: Automations, memory: Memory, settings: Settings, privacy: Privacy, diagnostics: Diagnostics }

function Lock() {
  const [pin, setPin] = useState(''); const [err, setErr] = useState('')
  const submit = async () => { try { const ok = await api.invoke<boolean>('security:unlock', pin); if (!ok) setErr('Incorrect PIN') } catch (e) { setErr(errMsg(e)) } setPin('') }
  return <div className="lock-screen"><div className="lock-box"><h1>JARVIS</h1><p className="muted">Locked</p><form onSubmit={(e) => { e.preventDefault(); void submit() }}><input type="password" inputMode="numeric" autoFocus value={pin} onChange={(e) => setPin(e.target.value)} placeholder="PIN" /><button className="btn primary">Unlock</button></form>{err && <div className="err">{err}</div>}
    <button className="btn danger" onClick={() => void api.invoke('app:stop-all')}>Emergency stop</button></div></div>
}

export function App() {
  const ready = useUi((s) => s.ready), snap = useUi((s) => s.snapshot), orb = useUi((s) => s.orb), tst = useUi((s) => s.toast), approvals = useUi((s) => s.approvals), mic = useUi((s) => s.micLive)
  const route = useRoute(); const overlay = route === 'overlay'
  useEffect(() => { void initStore().then(() => voice.start()).catch((e) => toast(errMsg(e), 'error')) }, [])
  useEffect(() => { document.body.classList.toggle('overlay-body', overlay) }, [overlay])
  if (!ready) return <div className="boot">INITIALISING…</div>
  if (snap.locked) return <Lock />
  if (overlay) return <Overlay />
  const Page = PAGES[route] ?? Home
  return (
    <div className="shell">
      <aside className="side">
        <div className="brand"><span className={`brand-dot st-${orb}`} />J.A.R.V.I.S.<small>v{snap.version}</small></div>
        <nav>{NAV.map(([id, ico, label]) => <a key={id} className={route === id ? 'on' : ''} onClick={() => go(id)}><span>{ico}</span>{label}{id === 'privacy' && approvals.length > 0 && <em className="pill">{approvals.length}</em>}</a>)}</nav>
        <div className="side-f"><span className={`dot ${snap.online ? 'ok' : 'bad'}`} /> {snap.online ? 'Online' : 'Offline'}</div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="top-state"><span className={`dot st-${orb}`} /> {orb.replace('_', ' ')}</div>
          {mic && <div className="mic-badge"><span className="dot live" /> MIC LIVE</div>}
          <div className="grow" />
          <button className="btn ghost" onClick={() => void api.invoke('overlay:toggle')} title="Floating assistant">◲ Overlay</button>
          <button className="btn danger stop" onClick={() => { voice.cancelAll(); void api.invoke('app:stop-all') }} title="Cancel everything and block all actions (Ctrl+Alt+Shift+X)">■ STOP</button>
        </header>
        <div className="content"><Page /></div>
      </main>
      <ApprovalDialog />
      {tst && <div className={`toast ${tst.kind}`}>{tst.text}</div>}
    </div>
  )
}

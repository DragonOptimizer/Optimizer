import { useEffect, useState } from 'react'
import type { DiagnosticCheck, GoogleStatus, ProviderStatus, TelegramStatus } from '@shared/types'
import { api, errMsg } from '../lib/api'
import { useUi, toast, updateSettings } from '../lib/store'
import { ask, go, useAsyncAction } from '../lib/nav'
import { Card, Btn, Tag, Field, Toggle, Empty } from '../components/ui'

export function Apps() {
  const [diag, setDiag] = useState<DiagnosticCheck[]>([]); const [prov, setProv] = useState<ProviderStatus[]>([])
  useEffect(() => { void api.invoke<DiagnosticCheck[]>('diagnostics:run').then(setDiag); void api.invoke<ProviderStatus[]>('ai:providers').then(setProv) }, [])
  const d = (id: string) => diag.find((x) => x.id === id)
  const kind = (s?: string) => (s === 'ok' ? 'ok' : s === 'fail' ? 'err' : s === 'warn' ? 'warn' : 'mute') as any
  const cur = useUi((s) => s.settings.ai.provider)
  const card = (title: string, check: string, desc: string, action: () => void, label = 'Configure') => (
    <Card title={title} right={<Tag kind={kind(d(check)?.status)}>{d(check)?.status ?? '…'}</Tag>}>
      <p className="muted small">{d(check)?.detail ?? 'Checking…'}</p><p className="small">{desc}</p><Btn onClick={action}>{label}</Btn>
    </Card>)
  return (
    <div className="page cards">
      <Card title="AI provider" right={<Tag kind={prov.find((p) => p.id === cur)?.configured ? 'ok' : 'warn'}>{cur}</Tag>}>
        <p className="muted small">{prov.map((p) => `${p.id}: ${p.configured ? 'key saved' : 'no key'}`).join(' · ')}</p>
        <p className="small">The reasoning engine behind everything.</p><Btn onClick={() => go('settings')}>Choose provider & keys</Btn>
      </Card>
      {card('Telegram (phone)', 'telegram', 'Message your phone and give commands from it.', () => go('messaging'))}
      {card('Google (Gmail & Classroom)', 'google', 'Read mail, draft replies, check assignments.', () => go('email'))}
      {card('Phone calls (Twilio)', 'phone', 'Spoken reminder calls to your own number.', () => go('phone'))}
      {card('Browser automation', 'browser', 'Chrome/Edge driven by Playwright with your approval.', () => go('computer'))}
      {card('Video editing (FFmpeg)', 'ffmpeg', 'Trim, join, caption and export clips.', () => go('video'))}
      {card('Speech recognition', 'stt', 'Needed for voice input.', () => go('settings'))}
      {card('Wake word', 'wake', 'Offline “Hey Jarvis” using Windows speech recognition.', () => go('settings'))}
      <Card title="Instagram" right={<Tag kind="info">browser workflow</Tag>}>
        <p className="muted small">No official API access is assumed. JARVIS opens Instagram in the automated browser; you sign in yourself. It will not send messages or post without your approval, and reports when the site blocks an action.</p>
        <div className="chips"><button className="chip" onClick={() => void ask('Open Instagram in the browser.')}>Open Instagram</button><button className="chip" onClick={() => void ask('Open my Instagram profile page and tell me what is visible. If I am not logged in, tell me to sign in.')}>My profile</button><button className="chip" onClick={() => void ask('Help me draft 3 caption options for a photo of my desk setup. Do not post anything.')}>Draft captions</button></div>
      </Card>
    </div>
  )
}

export function Email() {
  const g = useUi((s) => s.settings.google); const [st, setSt] = useState<GoogleStatus | null>(null); const [mail, setMail] = useState<any[] | null>(null); const [sec, setSec] = useState('')
  const act = useAsyncAction(); const [busy, setBusy] = useState(false)
  const refresh = () => api.invoke<GoogleStatus>('google:status').then(setSt)
  useEffect(() => { void refresh() }, [])
  const load = () => act(async () => { setMail(await api.invoke<any[]>('gmail:unread')) })
  return (
    <div className="page grid2">
      <div className="col">
        <Card title="Google account" right={<Tag kind={st?.connected ? 'ok' : 'warn'}>{st?.connected ? `Connected${st.email ? ' · ' + st.email : ''}` : 'Not connected'}</Tag>}>
          <p className="small">JARVIS uses Google’s official OAuth with <b>your own</b> Google Cloud OAuth client (type “Desktop app”). Tokens are stored encrypted by Windows. Managed school accounts may block this; JARVIS never bypasses admin restrictions.</p>
          <Field label="OAuth Client ID" hint="From Google Cloud Console → APIs & Services → Credentials. Enable the Gmail API and Classroom API (and Drive API for PDFs). See docs/SETUP.md."><input value={g.clientId} onChange={(e) => void updateSettings({ google: { clientId: e.target.value } })} placeholder="1234-abc.apps.googleusercontent.com" /></Field>
          <Field label="Client secret (only if your client has one)"><input type="password" value={sec} onChange={(e) => setSec(e.target.value)} placeholder={st?.clientConfigured ? '•••• saved' : 'optional'} onBlur={() => sec && void act(async () => { await api.invoke('google:set-secret', sec); setSec('') }, 'Saved securely')} /></Field>
          <Toggle checked={g.gmailEnabled} onChange={(v) => void updateSettings({ google: { gmailEnabled: v } })} label="Gmail access" hint="Read, draft, label. Sending always asks you first." />
          <Toggle checked={g.classroomEnabled} onChange={(v) => void updateSettings({ google: { classroomEnabled: v } })} label="Google Classroom access (+ Drive read-only for PDFs)" />
          <div className="row">
            <Btn kind="primary" disabled={busy || !g.clientId} onClick={() => { setBusy(true); void act(async () => { await api.invoke('google:connect'); await refresh() }, 'Google connected').finally(() => setBusy(false)) }}>{busy ? 'Waiting for browser sign-in…' : st?.connected ? 'Reconnect / change access' : 'Sign in with Google'}</Btn>
            {st?.connected && <Btn kind="danger" onClick={() => void act(async () => { await api.invoke('google:disconnect'); await refresh(); setMail(null) }, 'Disconnected & token revoked')}>Disconnect</Btn>}
          </div>
        </Card>
        <Card title="Ask JARVIS">
          <div className="chips">
            <button className="chip" onClick={() => void ask('Check my unread emails and summarise the important ones.')}>Summarise unread</button>
            <button className="chip" onClick={() => void ask('Find the latest email from my manager and draft a polite reply. Show me the draft; do not send it.')}>Draft reply to manager</button>
            <button className="chip" onClick={() => void ask('Search my email for anything with a deadline this week and list it.')}>Find deadlines</button>
          </div>
        </Card>
      </div>
      <Card title="Unread inbox" right={<Btn onClick={load} disabled={!st?.connected}>Refresh</Btn>}>
        {!mail ? <Empty>{st?.connected ? 'Press Refresh to load unread mail.' : 'Connect Google to see your mail.'}</Empty> : mail.length === 0 ? <Empty>No unread mail 🎉</Empty> :
          mail.map((m) => <div key={m.id} className="mail"><div className="row between"><b>{m.subject}</b><span className="muted small">{m.date}</span></div><div className="muted small">{m.from}</div><div className="small">{m.snippet}</div>
            <div className="row"><Btn kind="ghost" onClick={() => void ask(`Read email ${m.id} and draft a reply for me to review. Do not send it.`)}>Draft reply</Btn><Btn kind="ghost" onClick={() => void ask(`Summarise email ${m.id}.`)}>Summarise</Btn></div></div>)}
      </Card>
    </div>
  )
}

export function Classroom() {
  const [work, setWork] = useState<any[] | null>(null); const act = useAsyncAction(); const [st, setSt] = useState<GoogleStatus | null>(null)
  useEffect(() => { void api.invoke<GoogleStatus>('google:status').then(setSt) }, [])
  return (
    <div className="page grid2">
      <div className="col">
        <Card title="Google Classroom">
          <p className="small">Uses the official Classroom API through the Google connection in <a onClick={() => go('email')}>Email</a>. If your school’s Workspace blocks third-party API access, JARVIS will report that rather than work around it. JARVIS never submits work: it prepares notes, outlines and quizzes for you to review and hand in yourself.</p>
          <div className="row"><Btn kind="primary" disabled={!st?.connected} onClick={() => void act(async () => setWork(await api.invoke<any[]>('classroom:work')))}>Load my assignments</Btn><Tag kind={st?.connected ? 'ok' : 'warn'}>{st?.connected ? 'Google connected' : 'Connect Google first'}</Tag></div>
        </Card>
        <Card title="Ask JARVIS">
          <div className="chips">
            {['What assignments are due this week?', 'Check what my chemistry teacher posted.', 'Read the newest PDF in my English class and summarise it.', 'Make a study schedule from my assignments and message it to my phone.', 'Generate a 10-question practice quiz for my next test.'].map((p) => <button key={p} className="chip" onClick={() => void ask(p)}>{p}</button>)}
          </div>
        </Card>
      </div>
      <Card title="Assignments (not yet turned in)">
        {!work ? <Empty>Load your assignments to see them here.</Empty> : work.length === 0 ? <Empty>Nothing outstanding.</Empty> :
          work.map((w) => <div key={w.courseId + w.id} className="mail"><div className="row between"><b>{w.title}</b><Tag kind={w.due && new Date(w.due).getTime() < Date.now() + 2 * 86400_000 ? 'warn' : 'mute'}>{w.due ? new Date(w.due).toLocaleDateString() : 'no due date'}</Tag></div><div className="muted small">{w.courseName} · {w.submission}</div><div className="small">{w.description.slice(0, 200)}</div><div className="row"><Btn kind="ghost" onClick={() => void ask(`Help me plan "${w.title}" for ${w.courseName}. Read the full instructions and any attachments, then give me an outline. Do not submit anything.`)}>Plan it</Btn></div></div>)}
      </Card>
    </div>
  )
}

export function Messaging() {
  const [st, setSt] = useState<TelegramStatus | null>(null); const [tok, setTok] = useState(''); const act = useAsyncAction()
  const refresh = () => api.invoke<TelegramStatus>('telegram:status').then(setSt)
  useEffect(() => { void refresh(); const t = setInterval(refresh, 3000); return () => clearInterval(t) }, [])
  return (
    <div className="page grid2">
      <Card title="Telegram" right={<Tag kind={st?.running ? 'ok' : st?.configured ? 'warn' : 'mute'}>{st?.running ? `Bot @${st.botUsername} running` : st?.configured ? 'Configured, not running' : 'Not set up'}</Tag>}>
        <ol className="small steps"><li>In Telegram, message <b>@BotFather</b>, send <code>/newbot</code>, and copy the token.</li><li>Paste it below and press Connect.</li><li>Open your new bot in Telegram and send the pairing command shown here.</li></ol>
        {!st?.configured && <><Field label="Bot token"><input type="password" value={tok} onChange={(e) => setTok(e.target.value)} placeholder="123456789:AA…" /></Field><Btn kind="primary" onClick={() => void act(async () => { setSt(await api.invoke<TelegramStatus>('telegram:connect', tok)); setTok('') }, 'Bot connected')} disabled={!tok}>Connect bot</Btn></>}
        {st?.configured && (
          <>
            {st.pairedChats.length === 0 ? (st.pairingCode ? <div className="pair"><div>Send this to your bot from your phone:</div><code className="big">/pair {st.pairingCode}</code><div className="muted small">Valid 10 minutes, one use. Only the account that sends it is authorised.</div></div> : <Btn onClick={() => void act(async () => setSt(await api.invoke('telegram:new-pairing')))}>New pairing code</Btn>) :
              <>{st.pairedChats.map((c) => <div key={c.id} className="row between"><span>📱 {c.name} <span className="muted small">(id {c.id})</span></span></div>)}
                <div className="row"><Btn onClick={() => void act(() => api.invoke('telegram:send-test'), 'Test message sent')}>Send test message</Btn><Btn onClick={() => void act(async () => setSt(await api.invoke('telegram:new-pairing')))}>Pair another</Btn></div></>}
            {st.lastError && <div className="warn-box">{st.lastError}</div>}
            <Btn kind="danger" onClick={() => void act(async () => setSt(await api.invoke<TelegramStatus>('telegram:disconnect')), 'Phone disconnected')}>Disconnect phone instantly</Btn>
          </>)}
      </Card>
      <Card title="How phone control is kept safe">
        <ul className="small bullets"><li>Only accounts that completed pairing can talk to JARVIS. Everyone else is silently ignored.</li><li>No inbound ports are opened; JARVIS polls Telegram over an outbound HTTPS connection.</li><li>Requests from your phone run <b>unattended</b>: read-only tools and notifications only. Sending email, calls, deleting or clicking are not available remotely.</li><li>Send <code>/stop</code> from your phone to trigger the emergency stop.</li><li>Telegram bot chats are not end-to-end encrypted; don’t send secrets.</li></ul>
        <div className="chips"><button className="chip" onClick={() => void ask('Message my phone: JARVIS test.')}>Ask JARVIS to message me</button><button className="chip" onClick={() => void ask('Remind me via Telegram in 2 minutes to stretch.')}>Remind me in 2 min</button></div>
      </Card>
    </div>
  )
}
void errMsg; void toast

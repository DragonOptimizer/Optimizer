import { useEffect, useState } from 'react'
import type { ToolInfo } from '@shared/types'
import { api } from '../lib/api'
import { useUi, updateSettings } from '../lib/store'
import { ask, useAsyncAction } from '../lib/nav'
import { Card, Btn, Toggle, RiskBadge, Field } from '../components/ui'
import { ActivityFeed } from '../components/Activity'

const QUICK = [
  ['Open Notepad', 'Open Notepad.'], ['What windows are open?', 'List my open windows.'], ['Open Chrome & search', 'Open Chrome, search for the latest AMD GPU drivers, and show me the official download page.'],
  ['Create School Projects folder', 'Create a folder called School Projects on my desktop.'], ['Look at my screen', 'Take a screenshot and tell me what is on my screen.'], ['Find files', 'Search my Documents for files with "report" in the name.']
]

export function Computer() {
  const s = useUi((x) => x.settings.computer), plat = useUi((x) => x.snapshot.platform)
  const [tools, setTools] = useState<ToolInfo[]>([]); const [root, setRoot] = useState('')
  const act = useAsyncAction()
  useEffect(() => { void api.invoke<ToolInfo[]>('tools:list').then(setTools) }, [])
  const ct = tools.filter((t) => ['computer', 'files', 'browser'].includes(t.category))
  return (
    <div className="page grid2">
      <div className="col">
        <Card title="Computer control">
          {plat && plat !== 'win32' && <div className="warn-box">Running on {plat}: Windows desktop automation (windows, typing, clicking, UI Automation) is only available on Windows. File and browser tools still work.</div>}
          <Toggle checked={s.enabled} onChange={(v) => void updateSettings({ computer: { enabled: v } })} label="Allow computer & browser control" hint="Master switch. When off, every computer/browser tool is blocked." />
          <Field label="Approval mode" hint="Balanced: reversible actions run automatically (unless the task read web/email content). Strict: confirm everything except read-only. Sensitive and destructive actions always ask."><select value={s.approvalMode} onChange={(e) => void updateSettings({ computer: { approvalMode: e.target.value } })}><option value="balanced">Balanced</option><option value="strict">Strict</option></select></Field>
          <Field label="Browser"><select value={s.browser} onChange={(e) => void updateSettings({ computer: { browser: e.target.value } })}><option value="chrome">Google Chrome</option><option value="msedge">Microsoft Edge</option></select></Field>
          <Toggle checked={s.persistBrowserProfile} onChange={(v) => void updateSettings({ computer: { persistBrowserProfile: v } })} label="Keep browser logins between sessions" hint="Uses a separate JARVIS browser profile (never your main one). Off = fresh private profile each time. Always sign in yourself; JARVIS never fills passwords." />
          <Toggle checked={s.browserHeadless} onChange={(v) => void updateSettings({ computer: { browserHeadless: v } })} label="Hidden browser (headless)" hint="You won't see pages. Leave off if you want to watch and log in." />
          <Toggle checked={s.allowLocalBrowsing} onChange={(v) => void updateSettings({ computer: { allowLocalBrowsing: v } })} label="Allow local/private network addresses" hint="Off blocks localhost and LAN addresses (SSRF protection)." />
        </Card>
        <Card title="Folders JARVIS may use" right={<Btn kind="ghost" onClick={() => void api.invoke('app:open-data-dir')}>Data folder</Btn>}>
          <p className="muted small">Always allowed: Desktop, Documents, Downloads and “JARVIS Workspace”. Anything else must be added here.</p>
          {s.allowedRoots.map((r) => <div className="row between" key={r}><code>{r}</code><Btn kind="ghost" onClick={() => void updateSettings({ computer: { allowedRoots: s.allowedRoots.filter((x) => x !== r) } })}>Remove</Btn></div>)}
          <div className="row"><input value={root} onChange={(e) => setRoot(e.target.value)} placeholder="C:\Users\you\School" /><Btn onClick={() => act(async () => { if (root.trim()) { await updateSettings({ computer: { allowedRoots: [...s.allowedRoots, root.trim()] } }); setRoot('') } })}>Add folder</Btn></div>
        </Card>
        <Card title="Try it">
          <div className="chips">{QUICK.map(([l, p]) => <button key={l} className="chip" onClick={() => void ask(p)}>{l}</button>)}</div>
        </Card>
      </div>
      <div className="col">
        <Card title="Live computer activity"><ActivityFeed filter={(e) => e.kind === 'tool' || e.kind === 'approval'} limit={30} /></Card>
        <Card title={`Available tools (${ct.length})`}>
          <div className="tool-list">{ct.map((t) => <div key={t.name} className="tool"><div className="row between"><code>{t.name}</code><RiskBadge r={t.risk} /></div><div className="muted small">{t.description}</div></div>)}</div>
        </Card>
      </div>
    </div>
  )
}

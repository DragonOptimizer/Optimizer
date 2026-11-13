import { useEffect, useState } from 'react'
import type { AuditEntry, MemoryItem, RecurrenceSpec, ScheduleChannel, ScheduleRecord, ScheduleRunRecord, TaskRecord } from '@shared/types'
import { api } from '../lib/api'
import { useUi, refreshTasks } from '../lib/store'
import { useAsyncAction } from '../lib/nav'
import { Card, Btn, Field, StatusBadge, Tag, Empty, fmtDateTime, RiskBadge } from '../components/ui'

export function History() {
  const tasks = useUi((s) => s.tasks); const [audit, setAudit] = useState<AuditEntry[]>([]); const [tab, setTab] = useState<'tasks' | 'audit'>('tasks')
  useEffect(() => { void refreshTasks(); void api.invoke<AuditEntry[]>('audit:list').then(setAudit) }, [tab])
  return (
    <div className="page">
      <div className="tabs"><button className={tab === 'tasks' ? 'on' : ''} onClick={() => setTab('tasks')}>Tasks</button><button className={tab === 'audit' ? 'on' : ''} onClick={() => setTab('audit')}>Tool access log</button></div>
      {tab === 'tasks' ? <Card>{tasks.length === 0 ? <Empty>No tasks yet.</Empty> : <table className="tbl"><thead><tr><th>Started</th><th>Task</th><th>Source</th><th>Status</th><th>Tokens</th><th>Result</th></tr></thead><tbody>
        {tasks.map((t: TaskRecord) => <tr key={t.id}><td>{fmtDateTime(t.startedAt)}</td><td>{t.title}</td><td>{t.source}</td><td><StatusBadge s={t.status} /></td><td>{t.tokensIn + t.tokensOut}</td><td className="muted">{t.summary?.slice(0, 120)}</td></tr>)}</tbody></table>}</Card>
        : <Card>{audit.length === 0 ? <Empty>No tool calls recorded.</Empty> : <table className="tbl"><thead><tr><th>Time</th><th>Actor</th><th>Tool</th><th>Risk</th><th>Decision</th><th>What</th></tr></thead><tbody>
          {audit.map((a) => <tr key={a.id}><td>{fmtDateTime(a.ts)}</td><td>{a.actor}</td><td><code>{a.tool}</code></td><td><RiskBadge r={a.risk} /></td><td>{a.decision}</td><td className="muted">{a.summary.slice(0, 100)}</td></tr>)}</tbody></table>}</Card>}
    </div>
  )
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export function Automations() {
  const [list, setList] = useState<ScheduleRecord[]>([]); const [runs, setRuns] = useState<ScheduleRunRecord[]>([]); const act = useAsyncAction()
  const [f, setF] = useState({ title: '', kind: 'reminder' as 'reminder' | 'agent', message: '', when: 'once' as 'once' | 'daily' | 'weekdays' | 'weekly', at: '', time: '16:00', days: [1, 2, 3, 4, 5], channels: ['notification'] as ScheduleChannel[] })
  const refresh = async () => { setList(await api.invoke('schedule:list')); setRuns(await api.invoke('schedule:runs')) }
  useEffect(() => { void refresh(); const t = setInterval(refresh, 5000); return () => clearInterval(t) }, [])
  const toggleCh = (c: ScheduleChannel) => setF((x) => ({ ...x, channels: x.channels.includes(c) ? x.channels.filter((y) => y !== c) : [...x.channels, c] }))
  const create = () => act(async () => {
    const recurrence: RecurrenceSpec = f.when === 'once' ? { type: 'once', at: new Date(f.at).getTime() } : f.when === 'weekly' ? { type: 'weekly', days: f.days, time: f.time } : { type: f.when, time: f.time }
    if (f.when === 'once' && Number.isNaN((recurrence as any).at)) throw new Error('Pick a date and time.')
    if (!f.channels.length) throw new Error('Choose at least one delivery channel.')
    await api.invoke('schedule:create', { title: f.title || f.message.slice(0, 40), kind: f.kind, message: f.message, recurrence, channels: f.channels }); setF({ ...f, message: '', title: '' }); await refresh()
  }, 'Scheduled')
  return (
    <div className="page grid2">
      <div className="col">
        <Card title="New automation">
          <Field label="Title"><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Homework check" /></Field>
          <Field label="Type" hint={f.kind === 'agent' ? 'Runs the text as an unattended assistant task with read-only tools (no sending, clicking or deleting), then delivers the result.' : 'Delivers the text as-is.'}><select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as any })}><option value="reminder">Reminder (deliver this text)</option><option value="agent">Workflow (assistant runs this task)</option></select></Field>
          <Field label={f.kind === 'agent' ? 'Task prompt' : 'Message'}><textarea rows={3} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} placeholder={f.kind === 'agent' ? 'Check my Classroom assignments due in the next 3 days and list them.' : 'Finish chemistry lab report'} /></Field>
          <div className="row"><Field label="When"><select value={f.when} onChange={(e) => setF({ ...f, when: e.target.value as any })}><option value="once">Once</option><option value="daily">Every day</option><option value="weekdays">Weekdays</option><option value="weekly">Weekly</option></select></Field>
            {f.when === 'once' ? <Field label="Date & time"><input type="datetime-local" value={f.at} onChange={(e) => setF({ ...f, at: e.target.value })} /></Field> : <Field label="Time"><input type="time" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} /></Field>}</div>
          {f.when === 'weekly' && <div className="chips">{DAYS.map((d, i) => <button key={d} className={`chip ${f.days.includes(i) ? 'on' : ''}`} onClick={() => setF({ ...f, days: f.days.includes(i) ? f.days.filter((x) => x !== i) : [...f.days, i] })}>{d}</button>)}</div>}
          <div className="chips">{(['notification', 'speech', 'telegram', 'call'] as ScheduleChannel[]).map((c) => <button key={c} className={`chip ${f.channels.includes(c) ? 'on' : ''}`} onClick={() => toggleCh(c)}>{c === 'call' ? '📞 phone call' : c}</button>)}</div>
          <Btn kind="primary" disabled={!f.message.trim()} onClick={() => void create()}>Schedule</Btn>
        </Card>
        <Card title="Recent runs">{runs.length === 0 ? <Empty>Nothing has run yet.</Empty> : runs.slice(0, 15).map((r) => <div key={r.id} className="row between"><span className="small">{fmtDateTime(r.ts)} · {list.find((s) => s.id === r.scheduleId)?.title ?? 'deleted'}</span><span className="small muted">{r.detail.slice(0, 70)}</span><Tag kind={r.status === 'ok' ? 'ok' : r.status === 'missed' ? 'warn' : 'err'}>{r.status}</Tag></div>)}</Card>
      </div>
      <Card title={`Scheduled (${list.length})`}>
        {list.length === 0 ? <Empty>No automations. Create one, or tell JARVIS: “remind me at 7 PM”.</Empty> : list.map((s) => <div key={s.id} className={`mail ${s.enabled ? '' : 'off'}`}><div className="row between"><b>{s.title}</b><Tag kind={s.kind === 'agent' ? 'info' : 'mute'}>{s.kind}</Tag></div><div className="small">{s.message}</div><div className="muted small">Next: {fmtDateTime(s.nextRun)} · {s.channels.join(' + ')} · {s.recurrence.type}{'time' in s.recurrence ? ' ' + s.recurrence.time : ''}</div><div className="muted small">Last: {s.lastStatus ?? 'never'}</div>
          <div className="row"><Btn kind="ghost" onClick={() => void act(async () => { await api.invoke('schedule:toggle', s.id, !s.enabled); await refresh() })}>{s.enabled ? 'Pause' : 'Enable'}</Btn><Btn kind="ghost" onClick={() => void act(async () => { await api.invoke('schedule:delete', s.id); await refresh() })}>Delete</Btn></div></div>)}
      </Card>
    </div>
  )
}

export function Memory() {
  const [items, setItems] = useState<MemoryItem[]>([]); const [text, setText] = useState(''); const [kind, setKind] = useState<MemoryItem['kind']>('preference'); const [edit, setEdit] = useState<{ id: string; v: string } | null>(null); const act = useAsyncAction()
  const refresh = async () => setItems(await api.invoke<MemoryItem[]>('memory:list'))
  useEffect(() => { void refresh() }, [])
  return (
    <div className="page grid2">
      <Card title="Add memory">
        <p className="small muted">Jarvis uses these in every conversation. Passwords, tokens and card numbers are refused.</p>
        <Field label="Kind"><select value={kind} onChange={(e) => setKind(e.target.value as any)}>{['preference', 'fact', 'goal', 'project', 'note'].map((k) => <option key={k}>{k}</option>)}</select></Field>
        <Field label="Memory"><textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="I prefer short explanations." /></Field>
        <Btn kind="primary" disabled={!text.trim()} onClick={() => void act(async () => { await api.invoke('memory:add', text, kind); setText(''); await refresh() }, 'Saved')}>Save</Btn>
      </Card>
      <Card title={`Saved memory (${items.length})`} right={items.length ? <Btn kind="danger" onClick={() => void act(async () => { if (confirm('Delete ALL memories?')) { await api.invoke('memory:clear'); await refresh() } })}>Clear all</Btn> : undefined}>
        {items.length === 0 ? <Empty>Nothing remembered yet. Try: “Jarvis, remember that I prefer short explanations.”</Empty> : items.map((m) => <div key={m.id} className="mail"><div className="row between"><Tag kind="info">{m.kind}</Tag><span className="muted small">{fmtDateTime(m.updatedAt)}</span></div>
          {edit?.id === m.id ? <><textarea rows={2} value={edit.v} onChange={(e) => setEdit({ id: m.id, v: e.target.value })} /><div className="row"><Btn kind="primary" onClick={() => void act(async () => { await api.invoke('memory:update', m.id, edit.v); setEdit(null); await refresh() })}>Save</Btn><Btn kind="ghost" onClick={() => setEdit(null)}>Cancel</Btn></div></> : <><div>{m.content}</div><div className="row"><Btn kind="ghost" onClick={() => setEdit({ id: m.id, v: m.content })}>Edit</Btn><Btn kind="ghost" onClick={() => void act(async () => { await api.invoke('memory:delete', m.id); await refresh() })}>Delete</Btn></div></>}</div>)}
      </Card>
    </div>
  )
}

import { useEffect, useState } from 'react'
import type { CallRecord } from '@shared/types'
import { api } from '../lib/api'
import { useUi, updateSettings } from '../lib/store'
import { useAsyncAction } from '../lib/nav'
import { Card, Btn, Field, Toggle, Tag, Empty, fmtDateTime } from '../components/ui'

export function Phone() {
  const p = useUi((s) => s.settings.phone)
  const [st, setSt] = useState<any>(null); const [hist, setHist] = useState<CallRecord[]>([]); const [sid, setSid] = useState(''); const [tok, setTok] = useState(''); const act = useAsyncAction()
  const refresh = async () => { setSt(await api.invoke('phone:status')); setHist(await api.invoke<CallRecord[]>('phone:history')) }
  useEffect(() => { void refresh() }, [p.maxCallSeconds, p.estCostPerMinuteUsd, p.callsEnabled])
  const set = (patch: object) => void updateSettings({ phone: patch })
  const est = st?.estMaxCostPerCall
  const ready = st?.credentials && /^\+[1-9]\d{7,14}$/.test(p.userNumber) && /^\+[1-9]\d{7,14}$/.test(p.callerNumber)
  return (
    <div className="page grid2">
      <div className="col">
        <Card title="Phone calls (Twilio Programmable Voice)" right={<Tag kind={st?.stopped ? 'err' : st?.configured && p.callsEnabled ? 'ok' : 'mute'}>{st?.stopped ? 'STOPPED' : st?.configured ? (p.callsEnabled ? 'Enabled' : 'Configured · off') : 'Not configured'}</Tag>}>
          <p className="small">JARVIS can place a <b>real, spoken call to your own number</b> (e.g. “call me at 7 PM about my assignment”). It never calls anyone else, never starts calls on its own outside schedules you approved, and cannot call until every step below is complete.</p>
          <div className="warn-box"><b>You pay Twilio, not Anthropic/OpenAI.</b> You need a Twilio account, a Twilio phone number, and (on trial accounts) your own number verified. Charges are per minute and depend on your country. Use “Look up my rate” to fetch the real per-minute price from Twilio.</div>
          <h4>1 · Credentials</h4>
          <div className="row"><input value={sid} onChange={(e) => setSid(e.target.value)} placeholder={st?.credentials ? 'Account SID saved' : 'Account SID (AC…)'} /><input type="password" value={tok} onChange={(e) => setTok(e.target.value)} placeholder={st?.credentials ? 'Auth token saved' : 'Auth token'} />
            <Btn onClick={() => void act(async () => { await api.invoke('phone:set-credentials', sid, tok); setSid(''); setTok(''); await refresh() }, 'Saved securely')} disabled={!sid || !tok}>Save</Btn>{st?.credentials && <Btn kind="ghost" onClick={() => void act(async () => { await api.invoke('phone:clear-credentials'); await refresh() })}>Remove</Btn>}</div>
          <h4>2 · Numbers</h4>
          <Field label="My phone number (international format)"><input value={p.userNumber} onChange={(e) => set({ userNumber: e.target.value.trim() })} placeholder="+15551234567" /></Field>
          <Field label="Twilio caller number (purchased/verified)"><input value={p.callerNumber} onChange={(e) => set({ callerNumber: e.target.value.trim() })} placeholder="+15557654321" /></Field>
          <h4>3 · Limits</h4>
          <div className="row"><Field label="Voice"><input value={p.callVoice} onChange={(e) => set({ callVoice: e.target.value })} placeholder="Polly.Matthew" /></Field><Field label="Max call seconds"><input type="number" value={p.maxCallSeconds} min={10} max={900} onChange={(e) => set({ maxCallSeconds: Number(e.target.value) })} /></Field></div>
          <div className="row"><Field label="Calling window start"><input type="time" value={p.callWindowStart} onChange={(e) => set({ callWindowStart: e.target.value })} /></Field><Field label="end"><input type="time" value={p.callWindowEnd} onChange={(e) => set({ callWindowEnd: e.target.value })} /></Field></div>
          <div className="row"><Field label="Monthly spending limit (USD)"><input type="number" step="0.5" min={0} value={p.monthlySpendLimitUsd} onChange={(e) => set({ monthlySpendLimitUsd: Number(e.target.value) })} /></Field>
            <Field label="Rate per minute (USD)"><input type="number" step="0.001" min={0} value={p.estCostPerMinuteUsd} onChange={(e) => set({ estCostPerMinuteUsd: Number(e.target.value) })} /></Field>
            <Btn onClick={() => void act(async () => { const r = await api.invoke<number>('phone:fetch-rate'); await refresh(); return r }, 'Rate updated from Twilio')} disabled={!st?.credentials || !p.userNumber}>Look up my rate</Btn></div>
          <div className="cost-box">Estimated worst-case cost per call: <b>{est == null ? 'unknown (enter or look up your rate)' : `$${est.toFixed(3)}`}</b> · Spent this month (tracked): <b>${(st?.spentThisMonthUsd ?? 0).toFixed(3)}</b> of ${p.monthlySpendLimitUsd.toFixed(2)} limit. Real prices are set by Twilio and may differ; check your Twilio console.</div>
          <h4>4 · Enable</h4>
          <Toggle checked={p.callsAcknowledgedCosts} onChange={(v) => set({ callsAcknowledgedCosts: v })} label="I understand Twilio will charge my account for calls" />
          <Toggle checked={p.callsEnabled} onChange={(v) => set({ callsEnabled: v })} label="Enable phone calling" hint={!ready ? 'Complete credentials and both numbers first.' : p.callsAcknowledgedCosts ? undefined : 'Acknowledge the charges first.'} />
          <div className="row">
            <Btn kind="primary" disabled={!ready || !p.callsEnabled || !p.callsAcknowledgedCosts || st?.stopped} onClick={() => void act(async () => { const r: any = await api.invoke('phone:test-call'); await refresh(); return r }, 'Test call requested')}>Place test call…</Btn>
            {st?.stopped ? <Btn onClick={() => void act(async () => { await api.invoke('phone:resume'); await refresh() })}>Resume calling</Btn> : <Btn kind="danger" onClick={() => void act(async () => { await api.invoke('phone:stop'); await refresh() })}>EMERGENCY STOP calls</Btn>}
          </div>
        </Card>
      </div>
      <div className="col">
        <Card title="Conversational calls" right={<Tag kind="warn">not available</Tag>}>
          <p className="small">Today calls are <b>one-way spoken messages</b> (reminders). Two-way spoken conversation needs a publicly reachable HTTPS webhook (or a media-stream server) for Twilio to talk to. JARVIS deliberately does not open your PC to the internet, so this is not enabled. See docs/SETUP.md → “Two-way calls” for the exact requirements.</p>
        </Card>
        <Card title="Call history">
          {hist.length === 0 ? <Empty>No calls yet.</Empty> : hist.map((c) => <div key={c.id} className="row between callrow"><div><b>{fmtDateTime(c.ts)}</b><div className="muted small">{c.reason.slice(0, 90)}</div></div><div className="right"><Tag kind={c.status === 'completed' ? 'ok' : c.status === 'blocked' || c.status === 'failed' ? 'err' : 'info'}>{c.status}</Tag><div className="muted small">{c.durationSec ? `${c.durationSec}s · ` : ''}≈${c.estCostUsd.toFixed(3)}</div></div></div>)}
        </Card>
      </div>
    </div>
  )
}

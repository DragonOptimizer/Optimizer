import type { ReactNode } from 'react'
import type { RiskLevel, TaskStatus } from '@shared/types'

export const Card = ({ title, children, right, className = '' }: { title?: ReactNode; children: ReactNode; right?: ReactNode; className?: string }) => (
  <section className={`card ${className}`}>{(title || right) && <header className="card-h"><h3>{title}</h3><div>{right}</div></header>}{children}</section>
)
export const Btn = ({ children, onClick, kind = 'default', disabled, title, type = 'button' }: { children: ReactNode; onClick?: () => void; kind?: 'default' | 'primary' | 'danger' | 'ghost'; disabled?: boolean; title?: string; type?: 'button' | 'submit' }) => (
  <button type={type} className={`btn ${kind}`} onClick={onClick} disabled={disabled} title={title}>{children}</button>
)
export const Field = ({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) => (
  <label className="field"><span className="field-l">{label}</span>{children}{hint && <span className="hint">{hint}</span>}</label>
)
export const Toggle = ({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: ReactNode }) => (
  <label className="toggle"><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /><span className="knob" /><span className="tl">{label}{hint && <small>{hint}</small>}</span></label>
)
const STATUS_CLASS: Record<TaskStatus, string> = { planned: 'b-info', running: 'b-run', completed: 'b-ok', failed: 'b-err', awaiting_approval: 'b-warn', cancelled: 'b-mute', denied: 'b-err' }
export const StatusBadge = ({ s }: { s: TaskStatus }) => <span className={`badge ${STATUS_CLASS[s]}`}>{s.replace('_', ' ')}</span>
export const RiskBadge = ({ r }: { r: RiskLevel }) => <span className={`badge risk-${r}`}>{r}</span>
export const Tag = ({ kind = 'mute', children }: { kind?: 'ok' | 'warn' | 'err' | 'mute' | 'info'; children: ReactNode }) => <span className={`badge b-${kind === 'mute' ? 'mute' : kind === 'ok' ? 'ok' : kind === 'warn' ? 'warn' : kind === 'err' ? 'err' : 'info'}`}>{children}</span>
export const Empty = ({ children }: { children: ReactNode }) => <div className="empty">{children}</div>
export const fmtTime = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
export const fmtDateTime = (t: number | null | undefined) => (t ? new Date(t).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—')

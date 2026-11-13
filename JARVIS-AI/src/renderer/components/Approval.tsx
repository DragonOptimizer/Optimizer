import { useEffect, useState } from 'react'
import { useUi } from '../lib/store'
import { api } from '../lib/api'
import { RiskBadge } from './ui'

/** Modal permission prompt: shows exactly what will happen before anything sensitive is done. */
export function ApprovalDialog() {
  const approvals = useUi((s) => s.approvals)
  const a = approvals[0]
  const [left, setLeft] = useState(0)
  useEffect(() => { if (!a) return; const t = setInterval(() => setLeft(Math.max(0, Math.round((a.expiresAt - Date.now()) / 1000))), 500); setLeft(Math.round((a.expiresAt - Date.now()) / 1000)); return () => clearInterval(t) }, [a?.id]) // eslint-disable-line
  if (!a) return null
  const respond = (d: 'allow' | 'allow_always' | 'deny') => void api.invoke('approval:respond', a.id, d)
  return (
    <div className="modal-back" role="dialog" aria-modal="true" aria-label="Permission request">
      <div className={`modal risk-border-${a.risk}`}>
        <div className="modal-h"><span className="lock">⚠</span><h2>Permission needed</h2><RiskBadge r={a.risk} /></div>
        <p className="muted small">{a.reason}</p>
        <pre className="approval-sum">{a.summary}</pre>
        <details><summary className="muted small">Technical details</summary><pre className="small">{a.tool}\n{JSON.stringify(a.args, null, 2)}</pre></details>
        <div className="modal-f">
          <span className="muted small">Auto-denies in {left}s{approvals.length > 1 ? ` · ${approvals.length - 1} more waiting` : ''}</span>
          <div className="row">
            <button className="btn danger" onClick={() => respond('deny')}>Deny</button>
            {a.allowRemember && <button className="btn" onClick={() => respond('allow_always')}>Always allow this tool</button>}
            <button className="btn primary" autoFocus onClick={() => respond('allow')}>Allow once</button>
          </div>
        </div>
      </div>
    </div>
  )
}

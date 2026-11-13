import { useUi } from '../lib/store'
import { api } from '../lib/api'
import { voice } from '../lib/voice'
import { Orb } from '../components/Orb'
import { NowDoing } from '../components/Activity'
import { ApprovalDialog } from '../components/Approval'

export function Overlay() {
  const orb = useUi((s) => s.orb); const mic = useUi((s) => s.micLive); const approvals = useUi((s) => s.approvals); const last = useUi((s) => [...s.messages].reverse().find((m) => m.role === 'assistant'))
  return (
    <div className="overlay">
      <div className="ov-orb"><Orb state={orb} size={110} compact /></div>
      <div className="ov-body">
        <div className="ov-state">{orb.replace('_', ' ').toUpperCase()}{mic && <span className="dot live" />}</div>
        <NowDoing />
        <div className="ov-last">{last?.content.slice(0, 90)}</div>
        <div className="ov-btns"><button onClick={() => voice.toggle()}>🎙</button><button className="stop" onClick={() => void api.invoke('app:stop-all')}>■</button><button onClick={() => void api.invoke('window:overlay-expand')}>⤢</button><button onClick={() => void api.invoke('overlay:toggle')}>✕</button></div>
      </div>
      {approvals.length > 0 && <div className="ov-appr"><ApprovalDialog /></div>}
    </div>
  )
}

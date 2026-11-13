import { useEffect, useRef } from 'react'
import { useUi } from '../lib/store'
import { StatusBadge, fmtTime, Empty } from './ui'
import type { ActivityEvent } from '@shared/types'

const ICON: Record<ActivityEvent['kind'], string> = { task: '◆', plan: '☰', tool: '⚙', approval: '🔒', info: 'ℹ', error: '✖' }

/** Live feed of real execution events (planned → running → completed / failed / awaiting approval). */
export function ActivityFeed({ limit = 40, filter, compact = false }: { limit?: number; filter?: (e: ActivityEvent) => boolean; compact?: boolean }) {
  const all = useUi((s) => s.activity)
  const items = (filter ? all.filter(filter) : all).slice(-limit)
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [items.length])
  if (!items.length) return <Empty>Nothing yet. Actions will appear here as they actually happen.</Empty>
  return (
    <div className={`feed ${compact ? 'compact' : ''}`}>
      {items.map((e) => (
        <div key={e.id} className={`feed-row st-${e.status}`}>
          <span className="feed-ico">{ICON[e.kind]}</span>
          <div className="feed-body"><div className="feed-msg">{e.message}</div>{e.detail && !compact && <div className="feed-detail">{e.detail}</div>}</div>
          {!compact && <><StatusBadge s={e.status} /><span className="feed-time">{fmtTime(e.ts)}</span></>}
        </div>
      ))}
      <div ref={end} />
    </div>
  )
}

export function NowDoing() {
  const act = useUi((s) => s.activity)
  const orb = useUi((s) => s.orb), detail = useUi((s) => s.orbDetail)
  const last = [...act].reverse().find((e) => e.kind === 'tool' || e.kind === 'approval' || e.kind === 'plan')
  const live = last && (last.status === 'running' || last.status === 'awaiting_approval' || last.status === 'planned') && (orb === 'acting' || orb === 'processing' || orb === 'awaiting_approval')
  return <div className="nowdoing">{live ? last!.message : detail}</div>
}

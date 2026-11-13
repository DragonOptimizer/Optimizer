import { useEffect, useState } from 'react'
import type { DiagnosticCheck } from '@shared/types'
import { api } from '../lib/api'
import { ask, useAsyncAction } from '../lib/nav'
import { Card, Btn, Tag, Empty } from '../components/ui'
import { ActivityFeed } from '../components/Activity'

export function Video() {
  const [files, setFiles] = useState<string[]>([]); const [info, setInfo] = useState<Record<string, any>>({}); const [ff, setFf] = useState<DiagnosticCheck | null>(null); const act = useAsyncAction()
  useEffect(() => { void api.invoke<DiagnosticCheck[]>('diagnostics:run').then((d) => setFf(d.find((x) => x.id === 'ffmpeg') ?? null)) }, [])
  const pick = () => act(async () => { const p = await api.invoke<string[]>('video:pick-files'); setFiles((f) => [...new Set([...f, ...p])]); for (const x of p) api.invoke('video:probe', x).then((i) => setInfo((m) => ({ ...m, [x]: i }))).catch(() => {}) })
  const list = files.map((f) => `"${f}"`).join(', ')
  return (
    <div className="page grid2">
      <div className="col">
        <Card title="Video editing (FFmpeg)" right={<Tag kind={ff?.status === 'ok' ? 'ok' : 'warn'}>{ff?.status === 'ok' ? 'FFmpeg ready' : 'FFmpeg missing'}</Tag>}>
          <p className="muted small">{ff?.detail}</p>
          <p className="small"><b>What this can do:</b> trim, split, join, vertical 9:16 reframing, text overlays, volume, format conversion, subtitles from speech, preview files, and a simple montage (evenly-sized middle segments, no highlight/beat detection). Originals are never modified; outputs go to <code>Documents\JARVIS Workspace\videos</code>.</p>
          <p className="small"><b>What it can’t:</b> cinematic editing, transitions, colour grading or effects. Those need DaVinci Resolve/CapCut-style tools and are not automated here.</p>
          <Btn kind="primary" onClick={() => void pick()}>Add clips…</Btn>
        </Card>
        <Card title="Quick edits">
          <div className="chips">
            {[['30-second vertical montage with subtitles', `Take these clips: ${list}. Create a 30-second vertical montage, then add subtitles, and tell me where the MP4 is.`], ['Make vertical (Shorts/Reels)', `Convert ${list} to a vertical 9:16 video for YouTube Shorts.`], ['Join in order', `Join these clips in this order: ${list}.`], ['Preview', `Make a small preview file of ${list} and tell me where it is.`], ['Tell me when ready', `After rendering is done, message my phone on Telegram.`]].map(([l, p]) => <button key={l} className="chip" disabled={!files.length && l !== 'Tell me when ready'} onClick={() => void ask(p)}>{l}</button>)}
          </div>
        </Card>
      </div>
      <div className="col">
        <Card title={`Clips (${files.length})`}>
          {!files.length ? <Empty>No clips selected.</Empty> : files.map((f) => <div key={f} className="mail"><div className="row between"><code>{f.split(/[\\/]/).pop()}</code><Btn kind="ghost" onClick={() => setFiles(files.filter((x) => x !== f))}>Remove</Btn></div>{info[f] && <div className="muted small">{info[f].width}×{info[f].height} · {info[f].durationSec?.toFixed(1)}s · {info[f].videoCodec} · audio {info[f].hasAudio ? 'yes' : 'no'}</div>}</div>)}
        </Card>
        <Card title="Render activity"><ActivityFeed filter={(e) => !!e.tool?.startsWith('video_')} limit={20} /></Card>
      </div>
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import { useUi, setState } from '../lib/store'
import { api, errMsg } from '../lib/api'
import { voice } from '../lib/voice'
import { Orb, Visualizer } from '../components/Orb'
import { ActivityFeed, NowDoing } from '../components/Activity'
import { Card, Btn } from '../components/ui'
import { toast } from '../lib/store'

const LABEL: Record<string, string> = { idle: 'IDLE', listening: 'LISTENING', processing: 'PROCESSING', speaking: 'SPEAKING', acting: 'PERFORMING ACTION', awaiting_approval: 'AWAITING AUTHORIZATION', error: 'ERROR', offline: 'OFFLINE' }

export function Home() {
  const orb = useUi((s) => s.orb), msgs = useUi((s) => s.messages), busy = useUi((s) => s.busy), voiceCfg = useUi((s) => s.settings.voice)
  const micLive = useUi((s) => s.micLive), note = useUi((s) => s.voiceNote), conv = useUi((s) => s.conversationMode)
  const [text, setText] = useState('')
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [msgs.length])

  const send = async () => {
    const t = text.trim(); if (!t) return
    setText('')
    try { await api.invoke('chat:send', { text: t, source: 'text' }) } catch (e) { toast(errMsg(e), 'error') }
  }
  const mute = () => api.invoke('settings:update', { voice: { muted: !voiceCfg.muted } }).then((s: any) => { setState({ settings: s }); if (s.voice.muted) voice.cancelAll() })

  return (
    <div className="home">
      <div className="stage">
        <Orb state={orb} size={340} />
        <div className={`state-label st-${orb}`}>{LABEL[orb]}</div>
        <NowDoing />
        <Visualizer active={micLive || orb === 'speaking'} />
        <div className="mic-row">
          <Btn kind={orb === 'listening' ? 'primary' : 'default'} onClick={() => voice.toggle()} disabled={!voiceCfg.enabled || voiceCfg.muted}>{orb === 'listening' ? '■ Stop listening' : '🎙 Talk'}</Btn>
          <Btn onClick={mute} kind={voiceCfg.muted ? 'danger' : 'ghost'}>{voiceCfg.muted ? '🔇 Muted' : '🔈 Mute mic'}</Btn>
          <Btn kind={conv ? 'primary' : 'ghost'} onClick={() => { setState({ conversationMode: !conv }); if (!conv) void voice.listenAndSend() }} title="After each reply, keep listening for your follow-up">↻ Conversation</Btn>
          {busy && <Btn kind="danger" onClick={() => void api.invoke('chat:cancel')}>Cancel task</Btn>}
        </div>
        <div className="mic-status">
          <span className={`dot ${micLive ? 'live' : ''}`} /> {micLive ? 'MICROPHONE LIVE' : voiceCfg.muted ? 'Microphone muted' : 'Microphone off'}{note && <> · {note}</>}
          {voiceCfg.wakeWordEnabled && !voiceCfg.muted && <> · Wake word “{voiceCfg.wakePhrase}” armed</>}
          <> · Push-to-talk: {voiceCfg.pushToTalkShortcut}</>
        </div>
      </div>
      <div className="chat-col">
        <Card title="Conversation" className="chat-card">
          <div className="chat">
            {msgs.length === 0 && <div className="empty">Say “Hey Jarvis”, press the shortcut, or type below. Try: “What can you do?”</div>}
            {msgs.map((m) => (
              <div key={m.id} className={`msg ${m.role}`}><div className="bubble">{m.content}</div><div className="meta">{m.role === 'user' ? 'You' : 'JARVIS'}{m.source !== 'text' ? ` · ${m.source}` : ''} · {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div></div>
            ))}
            {busy && <div className="msg assistant"><div className="bubble typing"><i /><i /><i /></div></div>}
            <div ref={end} />
          </div>
          <form className="composer" onSubmit={(e) => { e.preventDefault(); void send() }}>
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask JARVIS anything or give it a task…" autoFocus />
            <Btn type="submit" kind="primary" disabled={!text.trim()}>Send</Btn>
          </form>
        </Card>
        <Card title="What I'm doing" className="feed-card"><ActivityFeed limit={25} compact /></Card>
      </div>
    </div>
  )
}

import { useEffect, useRef } from 'react'
import type { AssistantState } from '@shared/types'
import { voice } from '../lib/voice'

const PALETTE: Record<AssistantState, { c1: string; c2: string; glow: string; speed: number; pulse: number }> = {
  idle: { c1: '#19d3ff', c2: '#0a5cff', glow: '25,211,255', speed: 0.25, pulse: 0.04 },
  listening: { c1: '#7dffee', c2: '#19d3ff', glow: '125,255,238', speed: 0.5, pulse: 0.0 },
  processing: { c1: '#a98bff', c2: '#2f6bff', glow: '140,120,255', speed: 1.6, pulse: 0.06 },
  speaking: { c1: '#6fe3ff', c2: '#3a8dff', glow: '80,190,255', speed: 0.7, pulse: 0.0 },
  acting: { c1: '#ffc857', c2: '#19d3ff', glow: '255,200,87', speed: 1.1, pulse: 0.03 },
  awaiting_approval: { c1: '#ffb020', c2: '#ff7a1a', glow: '255,176,32', speed: 0.3, pulse: 0.12 },
  error: { c1: '#ff5470', c2: '#b0102f', glow: '255,84,112', speed: 0.4, pulse: 0.15 },
  offline: { c1: '#6b7a90', c2: '#2b3646', glow: '107,122,144', speed: 0.1, pulse: 0.02 }
}

interface P { a: number; r: number; s: number; z: number; o: number }

/** Canvas orb. Its motion is driven by the real assistant state and the live mic/output audio levels. */
export function Orb({ state, size = 360, compact = false }: { state: AssistantState; size?: number; compact?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const st = useRef(state); st.current = state
  useEffect(() => {
    const cv = ref.current!; const ctx = cv.getContext('2d')!
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    cv.width = size * dpr; cv.height = size * dpr
    ctx.scale(dpr, dpr)
    const N = compact ? 40 : 110
    const parts: P[] = Array.from({ length: N }, () => ({ a: Math.random() * Math.PI * 2, r: 0.55 + Math.random() * 0.45, s: (Math.random() * 0.5 + 0.2) * (Math.random() < 0.5 ? 1 : -1), z: Math.random(), o: Math.random() }))
    let raf = 0, t = 0, last = performance.now(), lvl = 0, hidden = document.hidden
    const cur = { ...PALETTE[state] }
    const onVis = () => { hidden = document.hidden; if (!hidden) { last = performance.now(); raf = requestAnimationFrame(frame) } }
    document.addEventListener('visibilitychange', onVis)
    const mix = (a: number, b: number, k: number) => a + (b - a) * k

    function frame(now: number) {
      if (hidden) return
      const dt = Math.min(0.05, (now - last) / 1000); last = now; t += dt * cur.speed
      const s = st.current, pal = PALETTE[s]
      cur.speed = mix(cur.speed, pal.speed, 0.06); cur.pulse = mix(cur.pulse, pal.pulse, 0.06)
      const target = s === 'listening' ? voice.level : s === 'speaking' ? voice.outLevel : 0
      lvl = mix(lvl, target, 0.25)
      const cx = size / 2, cy = size / 2, R = size * 0.21
      ctx.clearRect(0, 0, size, size)
      const breath = 1 + Math.sin(now / 700) * cur.pulse + lvl * 0.28
      const rr = R * breath
      ctx.globalCompositeOperation = 'lighter'
      // outer glow
      let g = ctx.createRadialGradient(cx, cy, rr * 0.4, cx, cy, rr * 2.3)
      g.addColorStop(0, `rgba(${pal.glow},${0.30 + lvl * 0.3})`); g.addColorStop(1, `rgba(${pal.glow},0)`)
      ctx.fillStyle = g; ctx.fillRect(0, 0, size, size)
      // core
      g = ctx.createRadialGradient(cx - rr * 0.25, cy - rr * 0.3, rr * 0.05, cx, cy, rr)
      g.addColorStop(0, '#ffffff'); g.addColorStop(0.18, pal.c1); g.addColorStop(0.75, pal.c2); g.addColorStop(1, 'rgba(0,0,0,0.15)')
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2); ctx.fill()
      // orbit rings
      ctx.lineWidth = compact ? 1 : 1.4
      for (let i = 0; i < 4; i++) {
        ctx.save(); ctx.translate(cx, cy); ctx.rotate(t * (0.6 + i * 0.35) * (i % 2 ? -1 : 1) + i)
        ctx.scale(1, 0.32 + i * 0.16)
        ctx.strokeStyle = `rgba(${pal.glow},${0.22 + i * 0.07 + lvl * 0.3})`
        ctx.beginPath(); ctx.arc(0, 0, rr * (1.28 + i * 0.2), 0, Math.PI * 2); ctx.stroke(); ctx.restore()
      }
      // processing / acting arc segments
      if (s === 'processing' || s === 'acting') {
        ctx.strokeStyle = `rgba(${pal.glow},0.9)`; ctx.lineWidth = compact ? 2 : 3
        for (let k = 0; k < 3; k++) { const a0 = t * 3 + k * 2.1; ctx.beginPath(); ctx.arc(cx, cy, rr * 1.12, a0, a0 + 0.9); ctx.stroke() }
      }
      // reactive waveform ring
      if (s === 'listening' || s === 'speaking') {
        const f = voice.freq; ctx.strokeStyle = `rgba(${pal.glow},0.85)`; ctx.lineWidth = 2; ctx.beginPath()
        const seg = 96
        for (let i = 0; i <= seg; i++) {
          const a = (i / seg) * Math.PI * 2; const bin = f.length ? f[Math.floor((i % (seg / 2)) / (seg / 2) * Math.min(48, f.length - 1))] / 255 : 0
          const amp = s === 'listening' ? bin * 0.35 : lvl * 0.25 * (0.6 + 0.4 * Math.sin(a * 6 + now / 120))
          const rad = rr * (1.08 + amp); const x = cx + Math.cos(a) * rad, y = cy + Math.sin(a) * rad
          i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)
        }
        ctx.stroke()
      }
      // particles
      for (const p of parts) {
        p.a += p.s * dt * (0.6 + cur.speed)
        const rad = rr * (1.25 + p.r * 1.0) + Math.sin(now / 900 + p.o * 9) * 4
        const x = cx + Math.cos(p.a) * rad, y = cy + Math.sin(p.a) * rad * (0.55 + p.z * 0.45)
        ctx.fillStyle = `rgba(${pal.glow},${0.25 + p.z * 0.55})`
        ctx.beginPath(); ctx.arc(x, y, (compact ? 0.8 : 1.1) + p.z * 1.4, 0, Math.PI * 2); ctx.fill()
      }
      ctx.globalCompositeOperation = 'source-over'
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => { cancelAnimationFrame(raf); document.removeEventListener('visibilitychange', onVis) }
  }, [size, compact]) // eslint-disable-line react-hooks/exhaustive-deps
  return <canvas ref={ref} className="orb-canvas" style={{ width: size, height: size }} role="img" aria-label={`Assistant state: ${state}`} />
}

export function Visualizer({ active }: { active: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const act = useRef(active); act.current = active
  useEffect(() => {
    const cv = ref.current!; const ctx = cv.getContext('2d')!; const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const w = cv.clientWidth, h = cv.clientHeight; cv.width = w * dpr; cv.height = h * dpr; ctx.scale(dpr, dpr)
    let raf = 0; const bars = 48; const vals = new Float32Array(bars)
    const frame = () => {
      ctx.clearRect(0, 0, w, h)
      const f = voice.freq
      for (let i = 0; i < bars; i++) {
        const target = act.current && f.length ? f[Math.floor((i / bars) * Math.min(64, f.length))] / 255 : 0.02
        vals[i] += (target - vals[i]) * 0.3
        const bh = Math.max(2, vals[i] * h * 0.95), x = (i + 0.5) * (w / bars)
        const g = ctx.createLinearGradient(0, h / 2 - bh / 2, 0, h / 2 + bh / 2); g.addColorStop(0, '#7dffee'); g.addColorStop(1, '#2f6bff')
        ctx.fillStyle = g; ctx.fillRect(x - 2, h / 2 - bh / 2, 4, bh)
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame); return () => cancelAnimationFrame(raf)
  }, [])
  return <canvas ref={ref} className="viz" aria-hidden />
}

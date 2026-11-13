import { spawn } from 'node:child_process'
import { promises as fs, existsSync, mkdirSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { transcribeAudio } from './stt'

export interface ProbeInfo { durationSec: number; width?: number; height?: number; fps?: number; hasAudio: boolean; videoCodec?: string; audioCodec?: string; sizeBytes: number; format?: string }
export interface RunOpts { signal?: AbortSignal; onProgress?: (pct: number) => void; durationSec?: number; cwd?: string }

function run(bin: string, args: string[], o: RunOpts = {}): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { cwd: o.cwd, windowsHide: true })
    let out = '', err = ''
    const onAbort = () => { p.kill('SIGKILL'); reject(new Error('cancelled')) }
    o.signal?.addEventListener('abort', onAbort, { once: true })
    p.stdout.on('data', (d) => {
      out += d
      if (o.onProgress && o.durationSec) { const m = [...String(d).matchAll(/out_time_(?:us|ms)=(\d+)/g)].pop(); if (m) o.onProgress(Math.min(99, Math.round((Number(m[1]) / 1e6 / o.durationSec) * 100))) }
    })
    p.stderr.on('data', (d) => { err += d; if (err.length > 20_000) err = err.slice(-10_000) })
    p.on('error', (e: any) => reject(new Error(e.code === 'ENOENT' ? `${bin} was not found. Install FFmpeg (winget install Gyan.FFmpeg) or set its path in Settings.` : e.message)))
    p.on('close', (code) => { o.signal?.removeEventListener('abort', onAbort); code === 0 ? resolve({ stdout: out, stderr: err }) : reject(new Error(`ffmpeg failed (exit ${code}): ${err.trim().split('\n').slice(-4).join(' | ')}`)) })
  })
}

const q = (s: string) => s.replace(/[^\w.-]+/g, '_').slice(0, 60) || 'video'

export class VideoService {
  constructor(readonly outDir: string, private ffmpegPath = 'ffmpeg', private ffprobePath = 'ffprobe') { mkdirSync(outDir, { recursive: true }) }

  async available(): Promise<{ ok: boolean; version?: string; error?: string }> {
    try { const r = await run(this.ffmpegPath, ['-version']); return { ok: true, version: r.stdout.split('\n')[0] } } catch (e) { return { ok: false, error: (e as Error).message } }
  }
  /** Unique output path in the output folder; source files are never overwritten. */
  outPath(base: string, suffix: string, ext: string): string {
    const stem = q(basename(base, extname(base)))
    let n = 0, p: string
    do { p = join(this.outDir, `${stem}-${suffix}${n ? `-${n}` : ''}.${ext.replace('.', '')}`); n++ } while (existsSync(p))
    return p
  }
  async probe(file: string): Promise<ProbeInfo> {
    const { stdout } = await run(this.ffprobePath, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file])
    const j = JSON.parse(stdout)
    const v = (j.streams ?? []).find((s: any) => s.codec_type === 'video'), a = (j.streams ?? []).find((s: any) => s.codec_type === 'audio')
    const [n, d] = String(v?.avg_frame_rate ?? '0/1').split('/').map(Number)
    return { durationSec: Number(j.format?.duration ?? v?.duration ?? 0), width: v?.width, height: v?.height, fps: d ? Math.round((n / d) * 100) / 100 : undefined, hasAudio: !!a, videoCodec: v?.codec_name, audioCodec: a?.codec_name, sizeBytes: Number(j.format?.size ?? 0), format: j.format?.format_name }
  }
  private ff(args: string[], o: RunOpts) { return run(this.ffmpegPath, ['-hide_banner', '-nostdin', '-n', '-progress', 'pipe:1', '-nostats', ...args], o) }
  private enc = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart']

  async trim(input: string, start: number, end: number, o: RunOpts = {}): Promise<string> {
    if (!(end > start) || start < 0) throw new Error('End time must be greater than start time.')
    const out = this.outPath(input, `trim-${Math.round(start)}-${Math.round(end)}`, 'mp4')
    await this.ff(['-ss', String(start), '-to', String(end), '-i', input, ...this.enc, out], { ...o, durationSec: end - start })
    return out
  }
  async volume(input: string, factor: number, o: RunOpts = {}): Promise<string> {
    if (!(factor >= 0 && factor <= 10)) throw new Error('Volume factor must be between 0 and 10.')
    const info = await this.probe(input); if (!info.hasAudio) throw new Error('This video has no audio track.')
    const out = this.outPath(input, `vol${factor}`, 'mp4')
    await this.ff(['-i', input, '-af', `volume=${factor}`, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', out], { ...o, durationSec: info.durationSec })
    return out
  }
  async convert(input: string, format: 'mp4' | 'webm' | 'mov' | 'gif' | 'mp3' | 'wav', o: RunOpts = {}): Promise<string> {
    const info = await this.probe(input)
    const out = this.outPath(input, 'converted', format)
    const args = format === 'mp4' || format === 'mov' ? this.enc : format === 'webm' ? ['-c:v', 'libvpx-vp9', '-crf', '32', '-b:v', '0', '-c:a', 'libopus'] : format === 'gif' ? ['-vf', 'fps=12,scale=480:-1:flags=lanczos', '-an'] : format === 'mp3' ? ['-vn', '-c:a', 'libmp3lame', '-q:a', '3'] : ['-vn']
    await this.ff(['-i', input, ...args, out], { ...o, durationSec: info.durationSec })
    return out
  }
  async preview(input: string, o: RunOpts = {}): Promise<string> {
    const info = await this.probe(input)
    const out = this.outPath(input, 'preview', 'mp4')
    const portrait = (info.height ?? 0) > (info.width ?? 0)
    await this.ff(['-i', input, '-vf', portrait ? 'scale=-2:640' : 'scale=640:-2', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', out], { ...o, durationSec: info.durationSec })
    return out
  }
  /** Vertical 9:16 for Shorts/Reels. 'blur' keeps the whole frame over a blurred backdrop; 'crop' fills the frame. */
  async vertical(input: string, mode: 'blur' | 'crop' = 'blur', o: RunOpts = {}): Promise<string> {
    const info = await this.probe(input)
    const out = this.outPath(input, 'vertical', 'mp4')
    const vf = mode === 'crop'
      ? '[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1[v]'
      : '[0:v]split[a][b];[a]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=24:2[bg];[b]scale=1080:1920:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1[v]'
    await this.ff(['-i', input, '-filter_complex', vf, '-map', '[v]', ...(info.hasAudio ? ['-map', '0:a'] : []), ...this.enc, out], { ...o, durationSec: info.durationSec })
    return out
  }
  /** Join clips (any resolution/fps; silent clips get silent audio) into one normalised video. Optional per-clip segments. */
  async join(inputs: string[], o: RunOpts & { vertical?: boolean; segments?: { start: number; end: number }[]; name?: string } = {}): Promise<string> {
    if (inputs.length < 1) throw new Error('Need at least one clip.')
    if (inputs.length < 2 && !o.segments) throw new Error('Need at least two clips to join.')
    const infos = await Promise.all(inputs.map((i) => this.probe(i)))
    const seg = infos.map((info, i) => ({ start: o.segments?.[i]?.start ?? 0, end: Math.min(o.segments?.[i]?.end ?? info.durationSec, info.durationSec) }))
    const W = o.vertical ? 1080 : 1920, H = o.vertical ? 1920 : 1080
    const args: string[] = [], parts: string[] = []
    let silentIdx = inputs.length
    infos.forEach((info, i) => {
      args.push('-i', inputs[i])
      const vt = o.segments ? `trim=start=${seg[i].start}:end=${seg[i].end},setpts=PTS-STARTPTS,` : ''
      const at = o.segments ? `atrim=start=${seg[i].start}:end=${seg[i].end},asetpts=PTS-STARTPTS,` : ''
      parts.push(`[${i}:v]${vt}scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p[v${i}]`)
      if (info.hasAudio) parts.push(`[${i}:a]${at}aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[a${i}]`)
    })
    infos.forEach((info, i) => { if (!info.hasAudio) { args.push('-f', 'lavfi', '-t', String(Math.max(0.1, seg[i].end - seg[i].start)), '-i', 'anullsrc=r=44100:cl=stereo'); parts.push(`[${silentIdx}:a]aformat=sample_fmts=fltp:channel_layouts=stereo[a${i}]`); silentIdx++ } })
    const concat = inputs.map((_, i) => `[v${i}][a${i}]`).join('') + `concat=n=${inputs.length}:v=1:a=1[v][a]`
    const out = this.outPath(o.name ?? inputs[0], `${o.segments ? 'montage' : 'joined'}${inputs.length}`, 'mp4')
    await this.ff([...args, '-filter_complex', [...parts, concat].join(';'), '-map', '[v]', '-map', '[a]', ...this.enc, out], { ...o, durationSec: seg.reduce((t, x) => t + (x.end - x.start), 0) })
    return out
  }
  async textOverlay(input: string, text: string, o: RunOpts & { position?: 'top' | 'center' | 'bottom'; fontFile?: string; start?: number; end?: number } = {}): Promise<string> {
    const info = await this.probe(input)
    const font = o.fontFile ?? defaultFont()
    if (!font) throw new Error('No usable font file found for text overlays.')
    const tmp = join(tmpdir(), `jarvis-text-${Date.now()}.txt`); await fs.writeFile(tmp, text, 'utf8')
    const y = o.position === 'top' ? 'h*0.08' : o.position === 'center' ? '(h-text_h)/2' : 'h*0.80-text_h'
    const en = o.start !== undefined && o.end !== undefined ? `:enable='between(t,${o.start},${o.end})'` : ''
    const esc = (p: string) => p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'")
    const out = this.outPath(input, 'text', 'mp4')
    try {
      await this.ff(['-i', input, '-vf', `drawtext=fontfile='${esc(font)}':textfile='${esc(tmp)}':fontsize=h/18:fontcolor=white:borderw=4:bordercolor=black:x=(w-text_w)/2:y=${y}${en}`, ...this.enc, out], { ...o, durationSec: info.durationSec })
    } finally { await fs.rm(tmp, { force: true }) }
    return out
  }
  /** Burn an SRT file into the video. Runs in the SRT's folder to avoid filter-path escaping problems. */
  async burnSubtitles(input: string, srtPath: string, o: RunOpts = {}): Promise<string> {
    const info = await this.probe(input)
    const out = this.outPath(input, 'subtitled', 'mp4')
    const style = `Fontsize=${(info.height ?? 0) > (info.width ?? 0) ? 14 : 22},Outline=2,Shadow=1,MarginV=${(info.height ?? 0) > (info.width ?? 0) ? 120 : 30},Alignment=2`
    await this.ff(['-i', input, '-vf', `subtitles=${basename(srtPath)}:force_style='${style}'`, ...this.enc, out], { ...o, cwd: dirname(srtPath), durationSec: info.durationSec })
    return out
  }
  /** Extract compact mono audio suitable for speech-to-text upload. */
  async extractAudio(input: string, o: RunOpts = {}): Promise<string> {
    const out = join(tmpdir(), `jarvis-audio-${Date.now()}.mp3`)
    await this.ff(['-i', input, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '48k', out], o)
    return out
  }
}

export function defaultFont(): string | undefined {
  const c = [process.env.SystemRoot && join(process.env.SystemRoot, 'Fonts', 'arial.ttf'), process.env.SystemRoot && join(process.env.SystemRoot, 'Fonts', 'segoeui.ttf'),
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf', '/System/Library/Fonts/Helvetica.ttc'].filter(Boolean) as string[]
  return c.find((p) => existsSync(p))
}

/** Transcribe a file (OpenAI-compatible endpoint). Returns text or SRT. */
export async function transcribeFile(opts: { baseUrl: string; apiKey: string; model: string; file: string; format: 'srt' | 'text'; signal?: AbortSignal }): Promise<string> {
  const data = await fs.readFile(opts.file)
  return transcribeAudio({ baseUrl: opts.baseUrl, apiKey: opts.apiKey, model: opts.model, data, filename: basename(opts.file), mime: 'audio/mpeg', format: opts.format === 'srt' ? 'srt' : 'json', signal: opts.signal })
}

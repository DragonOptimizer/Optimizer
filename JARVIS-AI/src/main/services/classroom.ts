import type { GoogleAuth, GoogleEndpoints } from './google'
import { REAL_ENDPOINTS } from './google'
import { extractPdfText } from '../tools/builtin'

export interface Course { id: string; name: string; section?: string; room?: string; link?: string }
export interface Assignment { courseId: string; courseName: string; id: string; title: string; description: string; due: string | null; state: string; submission: string; link?: string; materials: { kind: string; title: string; id?: string; url?: string }[] }

const dueOf = (w: any): string | null => {
  if (!w.dueDate) return null
  const t = w.dueTime ?? {}
  return new Date(Date.UTC(w.dueDate.year, w.dueDate.month - 1, w.dueDate.day, t.hours ?? 23, t.minutes ?? 59)).toISOString()
}
const materialsOf = (list: any[] | undefined) => (list ?? []).map((m) => {
  if (m.driveFile) return { kind: 'drive', title: m.driveFile.driveFile?.title ?? 'file', id: m.driveFile.driveFile?.id, url: m.driveFile.driveFile?.alternateLink }
  if (m.link) return { kind: 'link', title: m.link.title ?? m.link.url, url: m.link.url }
  if (m.youtubeVideo) return { kind: 'youtube', title: m.youtubeVideo.title, url: m.youtubeVideo.alternateLink }
  if (m.form) return { kind: 'form', title: m.form.title, url: m.form.formUrl }
  return { kind: 'other', title: 'attachment' }
})

export class ClassroomApi {
  constructor(private g: GoogleAuth, private ep: GoogleEndpoints = REAL_ENDPOINTS) {}
  private u(p: string) { return `${this.ep.api.classroom}${p}` }
  async courses(): Promise<Course[]> {
    const r = await this.g.request(this.u('/courses?courseStates=ACTIVE&studentId=me&pageSize=50'))
    return (r.courses ?? []).map((c: any) => ({ id: c.id, name: c.name, section: c.section, room: c.room, link: c.alternateLink }))
  }
  async assignments(opts: { courseId?: string; withinDays?: number; includeSubmitted?: boolean } = {}): Promise<Assignment[]> {
    const courses = (await this.courses()).filter((c) => !opts.courseId || c.id === opts.courseId)
    const out: Assignment[] = []
    for (const c of courses) {
      const wr = await this.g.request(this.u(`/courses/${c.id}/courseWork?courseWorkStates=PUBLISHED&orderBy=updateTime desc&pageSize=30`)).catch((e) => { throw new Error(`${c.name}: ${(e as Error).message}`) })
      const subs = await this.g.request(this.u(`/courses/${c.id}/courseWork/-/studentSubmissions?userId=me&pageSize=100`)).catch(() => ({ studentSubmissions: [] }))
      const state = new Map<string, string>((subs.studentSubmissions ?? []).map((s: any) => [s.courseWorkId, s.state]))
      for (const w of wr.courseWork ?? []) {
        const due = dueOf(w), st = state.get(w.id) ?? 'UNKNOWN'
        if (!opts.includeSubmitted && (st === 'TURNED_IN' || st === 'RETURNED')) continue
        if (opts.withinDays !== undefined && due && new Date(due).getTime() > Date.now() + opts.withinDays * 86400_000) continue
        out.push({ courseId: c.id, courseName: c.name, id: w.id, title: w.title, description: (w.description ?? '').slice(0, 3000), due, state: w.workType ?? 'ASSIGNMENT', submission: st, link: w.alternateLink, materials: materialsOf(w.materials) })
      }
    }
    return out.sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999'))
  }
  async announcements(courseId: string, max = 8) {
    const r = await this.g.request(this.u(`/courses/${courseId}/announcements?announcementStates=PUBLISHED&orderBy=updateTime desc&pageSize=${max}`))
    return (r.announcements ?? []).map((a: any) => ({ id: a.id, text: (a.text ?? '').slice(0, 2500), updated: a.updateTime, materials: materialsOf(a.materials), link: a.alternateLink }))
  }
  /** Reads a Drive attachment (PDF or Google Doc) shared in Classroom. Verifies access before claiming success. */
  async readAttachment(fileId: string): Promise<string> {
    const meta = await this.g.request(`${this.ep.api.drive}/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,size&supportsAllDrives=true`)
    if (meta.mimeType === 'application/pdf') {
      const buf: Buffer = await this.g.request(`${this.ep.api.drive}/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`, { raw: true })
      const { text, pages } = await extractPdfText(new Uint8Array(buf))
      return text.trim() ? `PDF "${meta.name}" (${pages} pages):\n${text}` : `PDF "${meta.name}" has ${pages} page(s) but no extractable text (probably scanned images).`
    }
    if (meta.mimeType === 'application/vnd.google-apps.document') {
      const buf: Buffer = await this.g.request(`${this.ep.api.drive}/files/${encodeURIComponent(fileId)}/export?mimeType=text/plain`, { raw: true })
      return `Google Doc "${meta.name}":\n${buf.toString('utf8').slice(0, 60_000)}`
    }
    throw new Error(`"${meta.name}" is a ${meta.mimeType} file; only PDFs and Google Docs can be read.`)
  }
}

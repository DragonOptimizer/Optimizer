import type { GoogleAuth, GoogleEndpoints } from './google'
import { REAL_ENDPOINTS } from './google'
import { htmlToTextLite } from './text'

export interface MailSummary { id: string; threadId: string; from: string; subject: string; date: string; snippet: string; unread: boolean; labels: string[] }
export interface MailFull extends MailSummary { to: string; messageIdHeader: string; body: string; attachments: string[] }

const hdr = (headers: { name: string; value: string }[] | undefined, n: string) => headers?.find((h) => h.name.toLowerCase() === n.toLowerCase())?.value ?? ''
const noCrlf = (s: string) => s.replace(/[\r\n]+/g, ' ').trim()
const dec = (d: string) => Buffer.from(d, 'base64url').toString('utf8')

export function buildRaw(o: { to: string; subject: string; body: string; inReplyTo?: string; references?: string; from?: string }): string {
  if (!/^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(o.to)) throw new Error(`"${o.to}" is not a valid single email address.`)
  const lines = [`To: ${noCrlf(o.to)}`, ...(o.from ? [`From: ${noCrlf(o.from)}`] : []), `Subject: =?UTF-8?B?${Buffer.from(noCrlf(o.subject)).toString('base64')}?=`,
    ...(o.inReplyTo ? [`In-Reply-To: ${noCrlf(o.inReplyTo)}`, `References: ${noCrlf(o.references ?? o.inReplyTo)}`] : []),
    'MIME-Version: 1.0', 'Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: base64', '', Buffer.from(o.body, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n')]
  return Buffer.from(lines.join('\r\n'), 'utf8').toString('base64url')
}
function bodyOf(payload: any): { text: string; atts: string[] } {
  const atts: string[] = []
  let plain = '', html = ''
  const walk = (p: any) => {
    if (!p) return
    if (p.filename) atts.push(p.filename)
    if (p.mimeType === 'text/plain' && p.body?.data) plain += dec(p.body.data)
    else if (p.mimeType === 'text/html' && p.body?.data) html += dec(p.body.data)
    for (const c of p.parts ?? []) walk(c)
  }
  walk(payload)
  return { text: (plain || htmlToTextLite(html)).trim(), atts }
}

export class GmailApi {
  constructor(private g: GoogleAuth, private ep: GoogleEndpoints = REAL_ENDPOINTS) {}
  private u(path: string) { return `${this.ep.api.gmail}/users/me${path}` }
  private sum(m: any): MailSummary {
    const h = m.payload?.headers
    return { id: m.id, threadId: m.threadId, from: hdr(h, 'From'), subject: hdr(h, 'Subject') || '(no subject)', date: hdr(h, 'Date'), snippet: m.snippet ?? '', unread: (m.labelIds ?? []).includes('UNREAD'), labels: m.labelIds ?? [] }
  }
  async search(query: string, max = 10): Promise<MailSummary[]> {
    const list = await this.g.request(this.u(`/messages?q=${encodeURIComponent(query)}&maxResults=${Math.min(max, 25)}`))
    const ids: { id: string }[] = list.messages ?? []
    return Promise.all(ids.map(async ({ id }) => this.sum(await this.g.request(this.u(`/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`)))))
  }
  async read(id: string): Promise<MailFull> {
    const m = await this.g.request(this.u(`/messages/${encodeURIComponent(id)}?format=full`))
    const { text, atts } = bodyOf(m.payload)
    return { ...this.sum(m), to: hdr(m.payload?.headers, 'To'), messageIdHeader: hdr(m.payload?.headers, 'Message-ID') || hdr(m.payload?.headers, 'Message-Id'), body: text.slice(0, 12_000), attachments: atts }
  }
  async createDraft(o: { to: string; subject: string; body: string; replyToMessageId?: string }): Promise<{ draftId: string; threadId?: string }> {
    let inReplyTo: string | undefined, threadId: string | undefined
    if (o.replyToMessageId) { const orig = await this.read(o.replyToMessageId); inReplyTo = orig.messageIdHeader || undefined; threadId = orig.threadId }
    const d = await this.g.request(this.u('/drafts'), { body: { message: { raw: buildRaw({ ...o, inReplyTo }), ...(threadId ? { threadId } : {}) } } })
    return { draftId: d.id, threadId }
  }
  async send(o: { to: string; subject: string; body: string; replyToMessageId?: string }): Promise<{ id: string; threadId: string }> {
    let inReplyTo: string | undefined, threadId: string | undefined
    if (o.replyToMessageId) { const orig = await this.read(o.replyToMessageId); inReplyTo = orig.messageIdHeader || undefined; threadId = orig.threadId }
    return this.g.request(this.u('/messages/send'), { body: { raw: buildRaw({ ...o, inReplyTo }), ...(threadId ? { threadId } : {}) } })
  }
  async labels(): Promise<{ id: string; name: string }[]> { return (await this.g.request(this.u('/labels'))).labels ?? [] }
  async applyLabel(messageId: string, labelName: string, remove = false): Promise<string> {
    let l = (await this.labels()).find((x) => x.name.toLowerCase() === labelName.toLowerCase())
    if (!l) { if (remove) throw new Error(`No label named "${labelName}"`); l = await this.g.request(this.u('/labels'), { body: { name: labelName, labelListVisibility: 'labelShow', messageListVisibility: 'show' } }) }
    await this.g.request(this.u(`/messages/${encodeURIComponent(messageId)}/modify`), { body: remove ? { removeLabelIds: [l!.id] } : { addLabelIds: [l!.id] } })
    return l!.id
  }
}

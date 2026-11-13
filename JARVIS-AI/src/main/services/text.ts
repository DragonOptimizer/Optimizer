export function htmlToTextLite(html: string): string {
  return html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<(br|\/p|\/div|\/li)\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim()
}

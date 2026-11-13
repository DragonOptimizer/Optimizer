// Generates build/icon.png (512) and build/icon.ico (256, PNG-in-ICO) — a glowing cyan orb — with no external deps.
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const out = resolve(dirname(fileURLToPath(import.meta.url)), '../build'); mkdirSync(out, { recursive: true })

function crc32(buf) { let c, crc = ~0; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c } return ~crc >>> 0 }
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]) }
function png(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size); const c = size / 2
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    for (let x = 0; x < size; x++) {
      const dx = (x - c) / c, dy = (y - c) / c, r = Math.hypot(dx, dy)
      let R = 5, G = 11, B = 20, A = 0
      if (r < 0.98) { // rounded dark tile
        const tile = Math.max(Math.abs(dx), Math.abs(dy)); A = 255; R = 6 + 10 * (1 - tile); G = 16 + 18 * (1 - tile); B = 30 + 24 * (1 - tile)
        const glow = Math.exp(-Math.pow(r / 0.62, 2) * 2.2); R += 25 * glow; G += 200 * glow; B += 235 * glow
        const core = Math.exp(-Math.pow(Math.hypot(dx + 0.12, dy + 0.14) / 0.2, 2)); R += 230 * core; G += 230 * core; B += 230 * core
        const ring = Math.exp(-Math.pow((r - 0.74) / 0.025, 2)); R += 20 * ring; G += 190 * ring; B += 255 * ring
      }
      const o = y * (size * 4 + 1) + 1 + x * 4; raw[o] = Math.min(255, R); raw[o + 1] = Math.min(255, G); raw[o + 2] = Math.min(255, B); raw[o + 3] = A
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}
writeFileSync(join(out, 'icon.png'), png(512))
const p256 = png(256); const hdr = Buffer.alloc(22); hdr.writeUInt16LE(1, 2); hdr.writeUInt16LE(1, 4); hdr[6] = 0; hdr[7] = 0; hdr.writeUInt16LE(1, 10); hdr.writeUInt16LE(32, 12); hdr.writeUInt32LE(p256.length, 14); hdr.writeUInt32LE(22, 18)
writeFileSync(join(out, 'icon.ico'), Buffer.concat([hdr, p256]))
console.log('icons written to', out)

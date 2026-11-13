import { promises as fs, realpathSync, existsSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { Tool } from '../core/tools'
import type { SettingsStore } from '../core/settings'
import type { Host } from './host'

/** Confines file tools to approved folders. Symlinks and `..` cannot escape. */
export class FileSandbox {
  constructor(private host: Host, private settings: SettingsStore) {}
  roots(): string[] {
    const u = this.host.userDirs
    return [...new Set([u.desktop, u.documents, u.downloads, u.workspace, ...this.settings.get().computer.allowedRoots].filter(Boolean).map((p) => resolve(p)))]
  }
  /** Expand "Desktop/..", "~/Documents/.." style aliases. */
  expand(p: string): string {
    const u = this.host.userDirs
    const m = /^(?:~[\\/])?(desktop|documents|downloads|workspace)(?:[\\/](.*))?$/i.exec(p.trim())
    if (m) return join((u as any)[m[1].toLowerCase()], m[2] ?? '')
    return p
  }
  private real(p: string): string {
    // Resolve symlinks for the deepest existing ancestor so that not-yet-created paths are checked too.
    let cur = resolve(p); const tail: string[] = []
    while (!existsSync(cur)) { tail.unshift(basename(cur)); const up = dirname(cur); if (up === cur) break; cur = up }
    try { cur = realpathSync(cur) } catch { /* keep */ }
    return join(cur, ...tail)
  }
  check(p: string): string {
    const abs = resolve(this.expand(p))
    if (!isAbsolute(abs)) throw new Error(`Path must be absolute or start with Desktop/Documents/Downloads/Workspace: ${p}`)
    const real = this.real(abs)
    for (const root of this.roots()) {
      const rr = this.real(root)
      const rel = relative(rr, real)
      if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) return real
    }
    throw new Error(`"${p}" is outside the folders Jarvis may access (${this.roots().join(', ')}). Add the folder under Settings → Computer → Allowed folders.`)
  }
}

const str = (description: string, extra: object = {}) => ({ type: 'string' as const, description, ...extra })

export function fileTools(sb: FileSandbox, host: Host): Tool[] {
  return [
    {
      name: 'list_directory', category: 'files', risk: 'safe', description: 'List files and folders in an allowed directory (Desktop, Documents, Downloads, Workspace or user-approved folders).',
      inputSchema: { type: 'object', required: ['path'], properties: { path: str('Directory path, e.g. "Desktop" or "Documents/School"') } },
      summarize: (a) => `Listing folder ${a.path}`,
      async run(a) {
        const dir = sb.check(a.path)
        const ents = await fs.readdir(dir, { withFileTypes: true })
        const lines = await Promise.all(ents.slice(0, 300).map(async (e) => {
          let size = ''
          if (e.isFile()) { try { size = ` (${(await fs.stat(join(dir, e.name))).size} bytes)` } catch { /* ignore */ } }
          return `${e.isDirectory() ? '[dir] ' : '[file]'} ${e.name}${size}`
        }))
        return { content: `${dir}\n${lines.join('\n') || '(empty)'}${ents.length > 300 ? `\n…and ${ents.length - 300} more` : ''}` }
      }
    },
    {
      name: 'read_text_file', category: 'files', risk: 'safe', untrusted: true, description: 'Read a text file (max ~100 KB) from an allowed folder. Contents are untrusted data.',
      inputSchema: { type: 'object', required: ['path'], properties: { path: str('File path') } },
      summarize: (a) => `Reading file ${a.path}`,
      async run(a) {
        const p = sb.check(a.path)
        const st = await fs.stat(p)
        if (!st.isFile()) throw new Error('Not a file')
        const buf = await fs.readFile(p)
        if (buf.subarray(0, 4096).includes(0)) throw new Error('This looks like a binary file; use pdf_read for PDFs.')
        return { content: buf.subarray(0, 100_000).toString('utf8') + (buf.length > 100_000 ? '\n[...truncated]' : '') }
      }
    },
    {
      name: 'search_files', category: 'files', risk: 'safe', timeoutMs: 30_000, description: 'Search for files by name (substring, case-insensitive) beneath an allowed folder.',
      inputSchema: { type: 'object', required: ['query'], properties: { query: str('Part of the file name'), root: str('Folder to search; default Documents'), maxResults: { type: 'integer', minimum: 1, maximum: 100 } } },
      summarize: (a) => `Searching for files matching "${a.query}"`,
      async run(a, ctx) {
        const root = sb.check(a.root ?? 'Documents'); const q = String(a.query).toLowerCase(); const max = a.maxResults ?? 25
        const found: string[] = []
        const walk = async (d: string, depth: number) => {
          if (found.length >= max || depth > 6 || ctx.signal.aborted) return
          let ents; try { ents = await fs.readdir(d, { withFileTypes: true }) } catch { return }
          for (const e of ents) {
            if (e.name.startsWith('.') || e.name === 'node_modules') continue
            const full = join(d, e.name)
            if (e.name.toLowerCase().includes(q)) found.push(full)
            if (found.length >= max) return
            if (e.isDirectory() && !e.isSymbolicLink()) await walk(full, depth + 1)
          }
        }
        await walk(root, 0)
        return { content: found.length ? found.join('\n') : `No files matching "${a.query}" under ${root}` }
      }
    },
    {
      name: 'create_folder', category: 'files', risk: 'moderate', unattendedOk: false, description: 'Create a folder (and parents) inside an allowed location.',
      inputSchema: { type: 'object', required: ['path'], properties: { path: str('Folder path, e.g. "Desktop/School Projects"') } },
      summarize: (a) => `Creating folder ${a.path}`,
      async run(a) {
        const p = sb.check(a.path)
        await fs.mkdir(p, { recursive: true })
        const st = await fs.stat(p)
        if (!st.isDirectory()) throw new Error('Folder was not created')
        return { content: `Verified: folder exists at ${p}` }
      }
    },
    {
      name: 'write_text_file', category: 'files', risk: (a: any) => (a?.overwrite ? 'sensitive' : 'moderate'), description: 'Create a text file. Set overwrite=true only to replace an existing file (requires approval).',
      inputSchema: { type: 'object', required: ['path', 'content'], properties: { path: str('File path'), content: str('Text content', { maxLength: 200_000 }), overwrite: { type: 'boolean' } } },
      summarize: (a) => `${a.overwrite ? 'Overwriting' : 'Creating'} file ${a.path}`,
      async run(a) {
        const p = sb.check(a.path)
        await fs.mkdir(dirname(p), { recursive: true })
        await fs.writeFile(p, a.content, { encoding: 'utf8', flag: a.overwrite ? 'w' : 'wx' }).catch((e) => { if (e.code === 'EEXIST') throw new Error('File already exists; pass overwrite=true to replace it.'); throw e })
        const back = await fs.readFile(p, 'utf8')
        if (back !== a.content) throw new Error('Verification failed: file content differs from what was written')
        return { content: `Verified: wrote ${back.length} characters to ${p}` }
      }
    },
    {
      name: 'move_path', category: 'files', risk: 'moderate', description: 'Move or rename a file/folder between allowed locations. Never overwrites an existing target.',
      inputSchema: { type: 'object', required: ['from', 'to'], properties: { from: str('Source path'), to: str('Destination path (full new path, or an existing folder to move into)') } },
      summarize: (a) => `Moving ${a.from} → ${a.to}`,
      async run(a) {
        const src = sb.check(a.from); let dst = sb.check(a.to)
        if (!existsSync(src)) throw new Error(`Source does not exist: ${src}`)
        if (existsSync(dst) && (await fs.stat(dst)).isDirectory()) dst = join(dst, basename(src))
        if (existsSync(dst)) throw new Error(`Destination already exists: ${dst}`)
        await fs.mkdir(dirname(dst), { recursive: true })
        await fs.rename(src, dst).catch(async (e) => { if (e.code === 'EXDEV') { await fs.cp(src, dst, { recursive: true }); await fs.rm(src, { recursive: true }) } else throw e })
        if (!existsSync(dst) || existsSync(src)) throw new Error('Verification failed after move')
        return { content: `Verified: moved to ${dst}` }
      }
    },
    {
      name: 'copy_path', category: 'files', risk: 'moderate', description: 'Copy a file/folder between allowed locations. Never overwrites.',
      inputSchema: { type: 'object', required: ['from', 'to'], properties: { from: str('Source'), to: str('Destination') } },
      summarize: (a) => `Copying ${a.from} → ${a.to}`,
      async run(a) {
        const src = sb.check(a.from); let dst = sb.check(a.to)
        if (existsSync(dst) && (await fs.stat(dst)).isDirectory()) dst = join(dst, basename(src))
        if (existsSync(dst)) throw new Error(`Destination already exists: ${dst}`)
        await fs.cp(src, dst, { recursive: true, errorOnExist: true })
        return { content: `Verified: copied to ${dst}` }
      }
    },
    {
      name: 'delete_path', category: 'files', risk: 'dangerous', description: 'Move a file or folder to the Recycle Bin / Trash (recoverable). Always requires approval.',
      inputSchema: { type: 'object', required: ['path'], properties: { path: str('Path to delete') } },
      summarize: (a) => `Moving to Recycle Bin: ${a.path}`,
      async run(a) {
        const p = sb.check(a.path)
        if (sb.roots().some((r) => resolve(r) === p)) throw new Error('Refusing to delete a root folder.')
        await host.trashItem(p)
        if (existsSync(p)) throw new Error('Verification failed: item still exists')
        return { content: `Verified: ${p} moved to the Recycle Bin.` }
      }
    },
    {
      name: 'open_path', category: 'files', risk: 'moderate', description: 'Open a file or folder with its default Windows app. Executable/script files are refused.',
      inputSchema: { type: 'object', required: ['path'], properties: { path: str('File or folder') } },
      summarize: (a) => `Opening ${a.path}`,
      async run(a) {
        const p = sb.check(a.path)
        if (/\.(exe|bat|cmd|com|msi|ps1|vbs|vbe|js|jse|wsf|scr|lnk|reg|hta|jar|dll)$/i.test(p)) throw new Error('Opening executable or script files is not allowed through this tool.')
        const err = await host.openPath(p)
        if (err) throw new Error(err)
        return { content: `Opened ${p}` }
      }
    }
  ]
}
void sep

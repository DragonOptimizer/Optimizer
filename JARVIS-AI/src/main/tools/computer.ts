import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { join, basename, extname } from 'node:path'
import type { Tool } from '../core/tools'
import type { Host } from './host'

// ───────────────────────── PowerShell runner (fixed scripts only; user data is passed via env vars, never spliced into code)
export interface PsRunner { run(script: string, env: Record<string, string>, signal: AbortSignal, timeoutMs?: number): Promise<string> }

export class WindowsPowerShell implements PsRunner {
  run(script: string, env: Record<string, string>, signal: AbortSignal, timeoutMs = 20_000): Promise<string> {
    const encoded = Buffer.from(script, 'utf16le').toString('base64')
    return new Promise((resolve, reject) => {
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
        { env: { ...process.env, ...env }, windowsHide: true, timeout: timeoutMs, signal, maxBuffer: 4_000_000 },
        (err, stdout, stderr) => err ? reject(new Error((stderr || err.message).toString().trim().slice(0, 500))) : resolve(stdout.toString().trim()))
    })
  }
}

const USER32 = `
Add-Type @"
using System; using System.Runtime.InteropServices;
public class JW {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, int d, UIntPtr e);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr e);
}
"@
`
export const PS = {
  listWindows: `Get-Process | Where-Object { $_.MainWindowTitle -ne '' } | Select-Object Id,ProcessName,MainWindowTitle | ConvertTo-Json -Compress`,
  focus: `${USER32}\n$p = Get-Process -Id ([int]$env:JARVIS_PID) -ErrorAction Stop\nif ($p.MainWindowHandle -eq 0) { throw 'Process has no window' }\n[JW]::ShowWindowAsync($p.MainWindowHandle, 9) | Out-Null\n[JW]::SetForegroundWindow($p.MainWindowHandle) | Out-Null\nWrite-Output ('focused ' + $p.MainWindowTitle)`,
  close: `$p = Get-Process -Id ([int]$env:JARVIS_PID) -ErrorAction Stop\n$null = $p.CloseMainWindow()\nStart-Sleep -Milliseconds 2500\n$p.Refresh()\nif ($p.HasExited) { Write-Output 'closed' } else { Write-Output 'still-running (it may be asking to save changes)' }`,
  type: `Add-Type -AssemblyName System.Windows.Forms\n[System.Windows.Forms.SendKeys]::SendWait($env:JARVIS_KEYS)\nWrite-Output 'sent'`,
  scroll: `${USER32}\n[JW]::mouse_event(0x0800, 0, 0, [int]$env:JARVIS_DELTA, [UIntPtr]::Zero)\nWrite-Output 'scrolled'`,
  click: `${USER32}\n$x=[int]$env:JARVIS_X; $y=[int]$env:JARVIS_Y\n[JW]::SetCursorPos($x,$y) | Out-Null\n$n = if ($env:JARVIS_DOUBLE -eq '1') { 2 } else { 1 }\n$down = if ($env:JARVIS_BUTTON -eq 'right') { 0x08 } else { 0x02 }\n$up = if ($env:JARVIS_BUTTON -eq 'right') { 0x10 } else { 0x04 }\nfor ($i=0; $i -lt $n; $i++) { [JW]::mouse_event($down,0,0,0,[UIntPtr]::Zero); [JW]::mouse_event($up,0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 60 }\nWrite-Output 'clicked'`,
  mediaKey: `${USER32}\n$vk=[byte][int]$env:JARVIS_VK\n[JW]::keybd_event($vk,0,0,[UIntPtr]::Zero); [JW]::keybd_event($vk,0,2,[UIntPtr]::Zero)\nWrite-Output 'sent'`,
  theme: `$v = if ($env:JARVIS_THEME -eq 'dark') { 0 } else { 1 }\n$k='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize'\nSet-ItemProperty -Path $k -Name AppsUseLightTheme -Value $v\nSet-ItemProperty -Path $k -Name SystemUsesLightTheme -Value $v\nWrite-Output ((Get-ItemProperty $k).AppsUseLightTheme)`,
  uiClick: `${USER32}\nAdd-Type -AssemblyName UIAutomationClient, UIAutomationTypes\n$win=[System.Windows.Automation.AutomationElement]::FromHandle([JW]::GetForegroundWindow())\n$all=$win.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)\n$needle=$env:JARVIS_NAME.ToLower(); $hit=$null\nforeach($e in $all){ $n=$e.Current.Name; if($n -and $n.ToLower() -eq $needle){$hit=$e;break} }\nif(-not $hit){ foreach($e in $all){ $n=$e.Current.Name; if($n -and $n.ToLower().Contains($needle)){$hit=$e;break} } }\nif(-not $hit){ throw ('No element named ' + $env:JARVIS_NAME + ' in the foreground window') }\n$pat=$null\nif($hit.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$pat)){ $pat.Invoke(); Write-Output ('invoked ' + $hit.Current.Name) }\nelseif($hit.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern,[ref]$pat)){ $pat.Select(); Write-Output ('selected ' + $hit.Current.Name) }\nelseif($hit.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern,[ref]$pat)){ $pat.Toggle(); Write-Output ('toggled ' + $hit.Current.Name) }\nelse { $hit.SetFocus(); Write-Output ('focused (not invokable) ' + $hit.Current.Name) }`,
  readScreen: `${USER32}\nAdd-Type -AssemblyName UIAutomationClient, UIAutomationTypes\n$win=[System.Windows.Automation.AutomationElement]::FromHandle([JW]::GetForegroundWindow())\nWrite-Output ('WINDOW: ' + $win.Current.Name)\n$all=$win.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)\n$i=0\nforeach($e in $all){ if($i -ge 400){break}; $n=$e.Current.Name; $t=$e.Current.ControlType.ProgrammaticName -replace 'ControlType\\.',''\n if($n -and $n.Trim().Length -gt 0){ Write-Output ($t + ': ' + $n.Substring(0,[Math]::Min(200,$n.Length))); $i++ } }`
}

// ───────────────────────── Pure helpers (unit-tested)
const SENDKEYS_SPECIAL = /[+^%~(){}[\]]/g
/** Escape text for SendKeys so characters are typed literally. */
export function escapeSendKeys(text: string): string {
  return text.replace(/\r\n|\r|\n/g, '\u0000ENTER\u0000').replace(/\t/g, '\u0000TAB\u0000')
    .replace(SENDKEYS_SPECIAL, (c) => `{${c}}`).replace(/\u0000(ENTER|TAB)\u0000/g, '{$1}')
}
const NAMED: Record<string, string> = {
  enter: '{ENTER}', return: '{ENTER}', tab: '{TAB}', esc: '{ESC}', escape: '{ESC}', space: ' ', backspace: '{BACKSPACE}', delete: '{DELETE}', del: '{DELETE}',
  up: '{UP}', down: '{DOWN}', left: '{LEFT}', right: '{RIGHT}', home: '{HOME}', end: '{END}', pageup: '{PGUP}', pagedown: '{PGDN}', pgup: '{PGUP}', pgdn: '{PGDN}', insert: '{INSERT}'
}
/** Convert "ctrl+shift+t" to a SendKeys string. Throws for unsupported keys (e.g. the Windows key). */
export function comboToSendKeys(combo: string): string {
  const parts = combo.toLowerCase().split('+').map((s) => s.trim()).filter(Boolean)
  if (!parts.length) throw new Error('Empty key combination')
  let mods = ''; const key = parts[parts.length - 1]
  for (const m of parts.slice(0, -1)) {
    if (m === 'ctrl' || m === 'control') mods += '^'
    else if (m === 'shift') mods += '+'
    else if (m === 'alt') mods += '%'
    else throw new Error(`Unsupported modifier "${m}" (the Windows key cannot be sent this way)`)
  }
  let k: string
  if (NAMED[key]) k = NAMED[key]
  else if (/^f([1-9]|1[0-6])$/.test(key)) k = `{${key.toUpperCase()}}`
  else if (key.length === 1) k = key.replace(SENDKEYS_SPECIAL, (c) => `{${c}}`)
  else throw new Error(`Unsupported key "${key}"`)
  return mods ? `${mods}(${k})` : k
}

export interface AppEntry { name: string; path: string }
export function resolveApp(index: AppEntry[], query: string): { match?: AppEntry; candidates: AppEntry[] } {
  const q = query.trim().toLowerCase()
  const exact = index.filter((a) => a.name.toLowerCase() === q)
  if (exact.length) return { match: exact[0], candidates: exact }
  const starts = index.filter((a) => a.name.toLowerCase().startsWith(q))
  if (starts.length === 1) return { match: starts[0], candidates: starts }
  const incl = index.filter((a) => a.name.toLowerCase().includes(q))
  if (incl.length === 1) return { match: incl[0], candidates: incl }
  const pool = starts.length ? starts : incl
  // prefer shortest name among candidates when unambiguous prefix family (e.g. "Google Chrome" vs "Google Chrome Canary")
  if (pool.length > 1) { const s = [...pool].sort((a, b) => a.name.length - b.name.length); if (pool.every((x) => x === s[0] || x.name.toLowerCase().startsWith(s[0].name.toLowerCase()))) return { match: s[0], candidates: pool } }
  return { candidates: pool }
}

const SYS = (f: string) => join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', f)
export const SYSTEM_ALIASES: Record<string, () => string> = {
  notepad: () => SYS('notepad.exe'), calculator: () => SYS('calc.exe'), calc: () => SYS('calc.exe'), paint: () => SYS('mspaint.exe'),
  'file explorer': () => join(process.env.SystemRoot ?? 'C:\\Windows', 'explorer.exe'), explorer: () => join(process.env.SystemRoot ?? 'C:\\Windows', 'explorer.exe'),
  'task manager': () => SYS('Taskmgr.exe'), 'snipping tool': () => SYS('SnippingTool.exe')
}

export async function scanStartMenu(): Promise<AppEntry[]> {
  const roots = [join(process.env.ProgramData ?? 'C:\\ProgramData', 'Microsoft\\Windows\\Start Menu\\Programs'), join(process.env.APPDATA ?? '', 'Microsoft\\Windows\\Start Menu\\Programs')]
  const out: AppEntry[] = []
  const walk = async (d: string, depth: number) => {
    let ents; try { ents = await fs.readdir(d, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      const p = join(d, e.name)
      if (e.isDirectory() && depth < 3) await walk(p, depth + 1)
      else if (e.isFile() && extname(e.name).toLowerCase() === '.lnk' && !/uninstall|readme|help/i.test(e.name)) out.push({ name: basename(e.name, '.lnk'), path: p })
    }
  }
  for (const r of roots) await walk(r, 0)
  return out
}

export interface ComputerDeps { host: Host; ps?: PsRunner; scanApps?: () => Promise<AppEntry[]>; wait?: (ms: number) => Promise<void> }

export function computerTools(deps: ComputerDeps): Tool[] {
  const { host } = deps
  const ps: PsRunner = deps.ps ?? new WindowsPowerShell()
  const wait = deps.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  let appCache: { at: number; apps: AppEntry[] } | null = null
  const apps = async () => {
    if (appCache && Date.now() - appCache.at < 300_000) return appCache.apps
    const a = await (deps.scanApps ?? scanStartMenu)(); appCache = { at: Date.now(), apps: a }; return a
  }
  const requireWindows = () => { if (host.platform !== 'win32') throw new Error(`This action uses Windows automation and is not supported on ${host.platform}.`) }
  const windows = async (signal: AbortSignal) => {
    const raw = await ps.run(PS.listWindows, {}, signal)
    if (!raw) return [] as { Id: number; ProcessName: string; MainWindowTitle: string }[]
    const j = JSON.parse(raw); return Array.isArray(j) ? j : [j]
  }
  const pid = { type: 'integer' as const, minimum: 1, description: 'Process ID from list_windows' }

  return [
    {
      name: 'list_applications', category: 'computer', risk: 'safe', description: 'Search installed applications (Start Menu) by name.',
      inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Optional name filter' } } },
      summarize: (a) => `Searching installed apps${a.query ? ` for "${a.query}"` : ''}`,
      async run(a) {
        const all = await apps(); const q = (a.query ?? '').toLowerCase()
        const f = all.filter((x) => x.name.toLowerCase().includes(q)).slice(0, 40)
        return { content: f.length ? f.map((x) => x.name).join('\n') : `No installed app matching "${a.query}" found in the Start Menu index (${all.length} apps indexed).` }
      }
    },
    {
      name: 'open_application', category: 'computer', risk: 'moderate', unattendedOk: false,
      description: 'Open an installed application by name (e.g. "Google Chrome", "Notepad"). Only apps found in the Start Menu or a short list of Windows built-ins can be launched.',
      inputSchema: { type: 'object', required: ['name'], properties: { name: { type: 'string', maxLength: 100 } } },
      summarize: (a) => `Opening ${a.name}…`,
      async run(a, ctx) {
        const q = String(a.name).trim().toLowerCase()
        let path: string | undefined, label = a.name
        const alias = SYSTEM_ALIASES[q]
        if (alias && host.platform === 'win32') { path = alias(); label = q }
        else {
          const { match, candidates } = resolveApp(await apps(), q)
          if (!match) throw new Error(candidates.length ? `Ambiguous app name. Candidates: ${candidates.slice(0, 8).map((c) => c.name).join(', ')}` : `No installed application matching "${a.name}" was found.`)
          path = match.path; label = match.name
        }
        const before = host.platform === 'win32' ? await windows(ctx.signal).catch(() => []) : []
        const err = await host.openPath(path)
        if (err) throw new Error(`Windows could not launch ${label}: ${err}`)
        if (host.platform !== 'win32') return { content: `Launch requested for ${label}.` }
        for (let i = 0; i < 12; i++) {
          await wait(500)
          const now = await windows(ctx.signal).catch(() => [])
          const fresh = now.filter((w) => !before.some((b) => b.Id === w.Id))
          const named = now.find((w) => w.ProcessName.toLowerCase().includes(q.split(' ').pop()!) || w.MainWindowTitle.toLowerCase().includes(q))
          if (fresh.length || named) { const w = fresh[0] ?? named!; return { content: `Verified: ${label} is open (window "${w.MainWindowTitle}", pid ${w.Id}).` } }
        }
        return { content: `Launched ${label}, but no new window was detected within 6 seconds (it may still be starting, or may already have been running).` }
      }
    },
    {
      name: 'list_windows', category: 'computer', risk: 'safe', description: 'List open application windows (title, process, pid).', inputSchema: { type: 'object', properties: {} },
      summarize: () => 'Listing open windows',
      async run(_a, ctx) {
        requireWindows()
        const w = await windows(ctx.signal)
        return { content: w.length ? w.map((x) => `pid ${x.Id} · ${x.ProcessName} · "${x.MainWindowTitle}"`).join('\n') : 'No visible windows.' }
      }
    },
    {
      name: 'focus_window', category: 'computer', risk: 'moderate', description: 'Bring a window to the foreground by pid.', inputSchema: { type: 'object', required: ['pid'], properties: { pid } },
      summarize: (a) => `Switching to window (pid ${a.pid})`,
      async run(a, ctx) { requireWindows(); return { content: await ps.run(PS.focus, { JARVIS_PID: String(a.pid) }, ctx.signal) } }
    },
    {
      name: 'close_application', category: 'computer', risk: 'sensitive', description: 'Politely close an application window by pid (like clicking X). It may prompt to save; it never force-kills.',
      inputSchema: { type: 'object', required: ['pid'], properties: { pid } },
      summarize: (a) => `Closing application (pid ${a.pid})`,
      async run(a, ctx) { requireWindows(); return { content: await ps.run(PS.close, { JARVIS_PID: String(a.pid) }, ctx.signal, 15_000) } }
    },
    {
      name: 'type_text', category: 'computer', risk: 'moderate', description: 'Type text into the currently focused window.',
      inputSchema: { type: 'object', required: ['text'], properties: { text: { type: 'string', maxLength: 2000 } } },
      summarize: (a) => `Typing ${String(a.text).length} characters`,
      async run(a, ctx) { requireWindows(); await ps.run(PS.type, { JARVIS_KEYS: escapeSendKeys(a.text) }, ctx.signal, 60_000); return { content: 'Typed the text into the focused window (cannot verify what the target app did with it; use read_screen_text to check).' } }
    },
    {
      name: 'press_keys', category: 'computer', risk: 'moderate', description: 'Press a keyboard shortcut in the focused window, e.g. "ctrl+t", "alt+left", "enter", "f5". The Windows key is unsupported.',
      inputSchema: { type: 'object', required: ['keys'], properties: { keys: { type: 'string', maxLength: 40 } } },
      summarize: (a) => `Pressing ${a.keys}`,
      async run(a, ctx) { requireWindows(); await ps.run(PS.type, { JARVIS_KEYS: comboToSendKeys(a.keys) }, ctx.signal); return { content: `Pressed ${a.keys}.` } }
    },
    {
      name: 'scroll', category: 'computer', risk: 'moderate', description: 'Scroll the window under the mouse pointer.',
      inputSchema: { type: 'object', required: ['direction'], properties: { direction: { type: 'string', enum: ['up', 'down'] }, amount: { type: 'integer', minimum: 1, maximum: 20 } } },
      summarize: (a) => `Scrolling ${a.direction}`,
      async run(a, ctx) { requireWindows(); await ps.run(PS.scroll, { JARVIS_DELTA: String((a.direction === 'up' ? 120 : -120) * (a.amount ?? 3)) }, ctx.signal); return { content: `Scrolled ${a.direction}.` } }
    },
    {
      name: 'click_ui_element', category: 'computer', risk: 'moderate',
      description: 'Click/activate a control in the foreground window by its accessible name using Windows UI Automation (preferred over coordinates).',
      inputSchema: { type: 'object', required: ['name'], properties: { name: { type: 'string', maxLength: 200 } } },
      summarize: (a) => `Clicking "${a.name}"`,
      async run(a, ctx) { requireWindows(); return { content: await ps.run(PS.uiClick, { JARVIS_NAME: a.name }, ctx.signal, 30_000) } }
    },
    {
      name: 'click_at', category: 'computer', risk: 'moderate', description: 'Click at screen coordinates. Use only when click_ui_element cannot find the control (e.g. after a screenshot).',
      inputSchema: { type: 'object', required: ['x', 'y'], properties: { x: { type: 'integer', minimum: 0, maximum: 20000 }, y: { type: 'integer', minimum: 0, maximum: 20000 }, button: { type: 'string', enum: ['left', 'right'] }, double: { type: 'boolean' } } },
      summarize: (a) => `Clicking at (${a.x}, ${a.y})`,
      async run(a, ctx) { requireWindows(); await ps.run(PS.click, { JARVIS_X: String(a.x), JARVIS_Y: String(a.y), JARVIS_BUTTON: a.button ?? 'left', JARVIS_DOUBLE: a.double ? '1' : '0' }, ctx.signal); return { content: `Clicked at (${a.x}, ${a.y}).` } }
    },
    {
      name: 'read_screen_text', category: 'computer', risk: 'moderate', untrusted: true, taintExempt: true,
      description: 'Read the visible text/controls of the foreground window via UI Automation. Content is untrusted data.',
      inputSchema: { type: 'object', properties: {} }, summarize: () => 'Reading the foreground window',
      async run(_a, ctx) { requireWindows(); return { content: await ps.run(PS.readScreen, {}, ctx.signal, 40_000) || '(no readable text found)' } }
    },
    {
      name: 'take_screenshot', category: 'computer', risk: 'sensitive', untrusted: true,
      description: 'Capture the primary screen and look at it (requires approval every time). Use when UI Automation cannot read what you need.',
      inputSchema: { type: 'object', properties: {} }, summarize: () => 'Taking a screenshot of your screen',
      async run() {
        const img = await host.captureScreen()
        const dir = join(host.userDirs.workspace, 'screenshots'); await fs.mkdir(dir, { recursive: true })
        const file = join(dir, `screen-${Date.now()}.png`); await fs.writeFile(file, Buffer.from(img.data, 'base64'))
        return { content: `Screenshot captured and saved to ${file}. The image is attached.`, images: [img] }
      }
    },
    {
      name: 'media_control', category: 'computer', risk: 'moderate', description: 'Press a media key: volume_up, volume_down, mute, play_pause, next, previous.',
      inputSchema: { type: 'object', required: ['action'], properties: { action: { type: 'string', enum: ['volume_up', 'volume_down', 'mute', 'play_pause', 'next', 'previous'] }, times: { type: 'integer', minimum: 1, maximum: 20 } } },
      summarize: (a) => `Media: ${a.action}`,
      async run(a, ctx) {
        requireWindows()
        const vk = { volume_up: 0xaf, volume_down: 0xae, mute: 0xad, play_pause: 0xb3, next: 0xb0, previous: 0xb1 }[a.action as 'mute']
        for (let i = 0; i < (a.times ?? 1); i++) await ps.run(PS.mediaKey, { JARVIS_VK: String(vk) }, ctx.signal)
        return { content: `Sent ${a.action} ×${a.times ?? 1}.` }
      }
    },
    {
      name: 'set_windows_theme', category: 'computer', risk: 'moderate', description: 'Switch Windows between light and dark app/system theme (reversible).',
      inputSchema: { type: 'object', required: ['theme'], properties: { theme: { type: 'string', enum: ['light', 'dark'] } } },
      summarize: (a) => `Setting Windows theme to ${a.theme}`,
      async run(a, ctx) { requireWindows(); const v = await ps.run(PS.theme, { JARVIS_THEME: a.theme }, ctx.signal); return { content: `Theme registry value is now ${v} (${a.theme}).` } }
    }
  ]
}

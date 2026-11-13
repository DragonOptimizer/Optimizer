// `npm run doctor` — inspects THIS machine (Windows-first) and reports what JARVIS needs. Read-only; installs nothing.
import { execFileSync } from 'node:child_process'
import { arch, cpus, freemem, platform, release, totalmem } from 'node:os'
import { statfsSync } from 'node:fs'

const win = platform() === 'win32'
const sh = (cmd, args = [], t = 8000) => { try { return execFileSync(cmd, args, { encoding: 'utf8', timeout: t, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch { return null } }
const ps = (script) => sh('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], 15000)
const rows = []
const add = (name, status, detail) => rows.push({ name, status, detail })
const ver = (cmd, args = ['--version']) => (sh(cmd, args) ?? '').split('\n')[0] || null

add('OS', win ? 'ok' : 'warn', win ? (ps('(Get-CimInstance Win32_OperatingSystem).Caption + " build " + (Get-CimInstance Win32_OperatingSystem).BuildNumber') ?? release()) : `${platform()} ${release()} (JARVIS computer-control targets Windows 10/11)`)
add('CPU', 'ok', `${cpus()[0]?.model.trim()} × ${cpus().length} threads · ${arch()}`)
add('RAM', totalmem() >= 7.5 * 2 ** 30 ? 'ok' : 'warn', `${(totalmem() / 2 ** 30).toFixed(1)} GB total, ${(freemem() / 2 ** 30).toFixed(1)} GB free`)
add('GPU', 'ok', (win ? ps('(Get-CimInstance Win32_VideoController | ForEach-Object { $_.Name }) -join "; "') : sh('sh', ['-c', 'lspci 2>/dev/null | grep -i -E "vga|3d" | head -2'])) || 'not detected')
try { const s = statfsSync(win ? 'C:\\' : '/'); const free = (s.bavail * s.bsize) / 2 ** 30; add('Disk free', free > 5 ? 'ok' : 'warn', `${free.toFixed(1)} GB (installer + node_modules need ~2 GB)`) } catch { add('Disk free', 'warn', 'unknown') }
const node = process.versions.node; add('Node.js', Number(node.split('.')[0]) >= 22 ? 'ok' : 'fail', `v${node} (need >= 22)`)
add('npm', ver('npm') ? 'ok' : 'fail', ver('npm') ?? 'not found')
add('Git', ver('git') ? 'ok' : 'warn', ver('git') ?? 'not found (only needed to clone/update)')
add('Python', ver(win ? 'python' : 'python3') ? 'ok' : 'unknown', (ver(win ? 'python' : 'python3') ?? 'not found') + ' (not required)')
const ff = sh('ffmpeg', ['-version']); add('FFmpeg', ff ? 'ok' : 'warn', ff ? ff.split('\n')[0] : 'not found: install with `winget install Gyan.FFmpeg` (needed for video editing)')
add('ffprobe', sh('ffprobe', ['-version']) ? 'ok' : 'warn', sh('ffprobe', ['-version'])?.split('\n')[0] ?? 'not found (ships with FFmpeg)')
add('Package managers', 'ok', ['winget', 'choco', 'scoop', 'brew', 'apt'].filter((p) => sh(win ? 'where' : 'which', [p])).join(', ') || 'none found')
const browsers = win ? ps('$p=@("$env:ProgramFiles\\Google\\Chrome\\Application\\chrome.exe","${env:ProgramFiles(x86)}\\Google\\Chrome\\Application\\chrome.exe","$env:LOCALAPPDATA\\Google\\Chrome\\Application\\chrome.exe","${env:ProgramFiles(x86)}\\Microsoft\\Edge\\Application\\msedge.exe","$env:ProgramFiles\\Microsoft\\Edge\\Application\\msedge.exe"); ($p | Where-Object { Test-Path $_ }) -join "; "') : ['google-chrome', 'chromium', 'microsoft-edge'].map((b) => sh('which', [b])).filter(Boolean).join('; ')
add('Chrome / Edge', browsers ? 'ok' : 'warn', browsers || 'not found (needed for browser automation)')
const audio = win ? ps('(Get-CimInstance Win32_SoundDevice | ForEach-Object { $_.Name }) -join "; "') : sh('sh', ['-c', 'arecord -l 2>/dev/null | grep card | head -3'])
add('Audio devices', audio ? 'ok' : 'warn', audio || 'none detected (microphone/speakers required for voice)')
add('Windows speech recognizer', win ? (ps('Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Recognition.SpeechRecognitionEngine).RecognizerInfo.Culture.Name') ? 'ok' : 'warn') : 'unknown', win ? (ps('Add-Type -AssemblyName System.Speech; "installed: " + (New-Object System.Speech.Recognition.SpeechRecognitionEngine).RecognizerInfo.Culture.Name') ?? 'not available: offline wake word will not work (push-to-talk still does)') : 'Windows only (offline wake word)')
add('Ollama (optional local AI)', sh('ollama', ['--version']) ? 'ok' : 'unknown', sh('ollama', ['--version']) ?? 'not installed (optional)')
const icon = { ok: '✔', warn: '▲', fail: '✖', unknown: '·' }
for (const r of rows) console.log(`${icon[r.status]} ${r.name.padEnd(28)} ${r.detail}`)
console.log(rows.some((r) => r.status === 'fail') ? '\nFix the ✖ items before continuing.' : '\nReady. Next: npm install && npm run build && npm start (or npm run dist for the installer).')

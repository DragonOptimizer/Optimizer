# JARVIS-AI

A personal AI assistant for Windows: talk to it, let it operate your PC (with permission), read your mail and school work, message and call your phone, edit video, remember your preferences and run scheduled tasks.

Electron + React + TypeScript + Vite · SQLite (built-in `node:sqlite`) · Playwright · FFmpeg · Windows DPAPI for secrets.

> **Honest status:** see [docs/STATUS.md](docs/STATUS.md) for exactly what is implemented, tested, and what still needs your setup or has limitations.

## Install (Windows 10/11): easiest path
Download **JARVIS-AI-Setup.exe** from the repository's **Releases** page, verify the SHA-256 shown there, run it (SmartScreen: *More info → Run anyway*, the installer is unsigned). A first-run wizard then sets up your AI key, microphone and voice. Step-by-step: [docs/INSTALL_AND_FIRST_COMMAND.md](docs/INSTALL_AND_FIRST_COMMAND.md). Two-way phone calls plan: [docs/PHASE2-TWO-WAY-CALLS.md](docs/PHASE2-TWO-WAY-CALLS.md).

## Build from source (Windows 10/11)

```powershell
git clone <this repo> ; cd Optimizer\JARVIS-AI
npm run doctor        # inspects your PC (Node, FFmpeg, browser, audio, GPU, RAM, disk…)
npm install
npm run build
npm start             # launch the built app
# or build the installer:
npm run dist          # -> release\JARVIS-Setup-0.1.0.exe (creates a desktop shortcut)
```

Requirements: Node.js ≥ 22, Chrome or Edge (browser automation), FFmpeg for video (`winget install Gyan.FFmpeg`).
A CI workflow (`.github/workflows/jarvis-ci.yml`) builds the installer on a Windows runner and publishes it as an artifact.

Then open **Settings → AI provider**, choose a provider, paste an API key and press **Test connection**. See [docs/SETUP.md](docs/SETUP.md).

## Architecture

| Layer | Where | Notes |
|---|---|---|
| Desktop frontend | `src/renderer` | React UI, canvas orb, live activity feed, approval dialog, 14 pages, floating overlay |
| Secure bridge | `src/preload`, `src/shared/ipc.ts` | context isolation, sandbox, allow-listed channels only, no Node in renderer |
| AI reasoning | `src/main/ai` | Anthropic / OpenAI / Gemini / Ollama adapters, tool-calling agent loop, retries, token budgets, loop guard |
| Tools & permissions | `src/main/core/tools.ts`, `permissions.ts` | JSON-schema validated tools, risk levels, approvals, taint tracking, audit log, timeouts, cancellation |
| Computer control | `src/main/tools/computer.ts`, `files.ts` | fixed PowerShell scripts (no model-supplied code), UI Automation, SendKeys, sandboxed file ops |
| Browser automation | `src/main/tools/browser.ts` | Playwright on your Chrome/Edge, URL policy, element refs, no password filling |
| Voice | `src/renderer/lib/voice.ts`, `src/main/services/stt.ts`, `wakeword.ts` | mic + VAD + barge-in, Whisper-compatible STT, Windows/OpenAI TTS, offline Windows wake word |
| Integrations | `src/main/services/{google,gmail,classroom,telegram,phone}.ts` | OAuth PKCE, Gmail, Classroom, Telegram bot (paired), Twilio calls |
| Memory / scheduler / video | `core/memory.ts`, `services/scheduler.ts`, `services/video.ts` | SQLite persistence, restart-safe scheduler, FFmpeg pipeline |
| Diagnostics | `bootstrap.ts`, `core/logger.ts` | structured redacted logs, health checks, measured latencies |

## Security model (short)

* The model never gets a shell. Tools are a fixed catalogue; user/model text is passed to Windows scripts through environment variables, never spliced into code.
* Every call is policy-checked: **safe** (auto) · **moderate** (auto in Balanced mode, unless the task has read untrusted content) · **sensitive** (always asks: sending, calls, screenshots, closing apps) · **dangerous** (always asks, never “always allow”: delete → Recycle Bin).
* Web pages, emails, PDFs and file contents are wrapped as untrusted data; once read, further actions need approval (prompt-injection defence). Unattended runs (scheduler, phone) only see low-risk tools.
* Secrets are stored only encrypted (DPAPI via Electron `safeStorage`); if unavailable JARVIS refuses to store them.
* Emergency STOP: button, tray, `Ctrl+Alt+Shift+X`, or `/stop` from your paired phone.

## Tests

```bash
npm run typecheck
npm test            # 72 unit/integration tests (real files, real FFmpeg, real Chromium, fixture HTTP servers)
npm run build && xvfb-run -a node scripts/e2e-launch.mjs    # 39 real-Electron UI checks (on Windows: node scripts/e2e-launch.mjs)
```

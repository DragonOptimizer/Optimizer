# JARVIS-AI: honest status report

Environment note: this session ran in a **Linux cloud container**, not on your Windows PC. Everything below was verified there (real Electron under a virtual display, real FFmpeg, real Chromium, fixture HTTP servers standing in for cloud APIs). Anything that needs Windows, your accounts, your hardware or paid credentials is marked accordingly. **I could not inspect your PC**: run `npm run doctor` on it.

## IMPLEMENTED AND TESTED (in this session, Linux)
* 72 unit/integration tests pass; TypeScript strict typecheck clean (node + web).
* Real Electron app launches, renders orb/UI, all 14 pages render without errors; 39/39 end-to-end UI checks pass (`scripts/e2e-launch.mjs`): chat → AI → tool → verified result, live activity feed, approval dialog (deny blocks, allow runs), emergency stop, overlay window, restart persistence (settings, memory, conversations), scheduled reminder firing, microphone indicator and **voice capture → VAD → speech-to-text → chat using a synthetic WAV through Chromium's fake mic** (proves the pipeline; not real speech or a real mic).
* Renderer security: no Node access, allow-listed IPC only (verified in the e2e run).
* AI adapters for Anthropic, OpenAI, Gemini, Ollama: request/response mapping, tool calling, retry/backoff, cancellation, error messages (verified against local fixture servers that mimic each API's documented shapes, **not against the real services**).
* Agent loop: planning, tool execution, failure reporting, max-step and repeated-call guards, token limits, cancellation, crash recovery of interrupted tasks.
* Permissions: risk levels, approvals, unattended restrictions, taint tracking (prompt-injection defence), audit log, emergency stop.
* Files (sandbox incl. symlink/`..` escapes, create/move/search/verify), memory (persist, refuses secrets), scheduler (persist, dedupe, restart, missed-run handling), Telegram service (pairing, unauthorised senders ignored, long polling) and Twilio gating/TwiML/limits against fixture servers, Google OAuth PKCE + refresh + revoked sessions, Gmail/Classroom request handling, FFmpeg video pipeline (probe, trim, split, join mixed clips, vertical, text, volume, convert, preview, montage, subtitles via STT fixture) and Playwright browser automation on a local page (open/read/click/fill/submit/screenshot/URL policy).

## IMPLEMENTED BUT REQUIRES CONFIGURATION (NOT TESTED against real services; REQUIRES USER SETUP)
* Real AI calls (needs your API key / Ollama), real speech recognition (Whisper key), OpenAI TTS.
* Gmail & Classroom against real Google (your OAuth client; school admin may block).
* Telegram against the real Bot API (your bot token).
* Twilio calls against the real service (credentials, numbers, **cost**). No real call was placed.
* Video subtitles against real Whisper.
* Windows PDF attachments from Classroom: implemented; actual access depends on your school's permissions.

## IMPLEMENTED BUT NOT TESTED ON WINDOWS (command construction unit-tested only)
* PowerShell/UIA tools: open app via Start Menu index, list/focus/close windows, type/keys/scroll/click, read screen text, media keys, theme.
* Offline wake word (Windows speech recognizer), global shortcut, tray, startup-with-Windows, DPAPI storage, Recycle Bin deletion, Windows TTS voices, Windows installer, desktop shortcut.
* The GitHub Actions workflow (`.github/workflows/jarvis-ci.yml`) runs typecheck, tests, e2e and builds the NSIS installer on `windows-latest`. At the time of writing its run had not completed in this session, so **Windows test results and installer are unconfirmed**. Check the Actions tab.

## PARTIALLY IMPLEMENTED
* Wake word: Windows-only, single phrase, accuracy unmeasured; push-to-talk is the dependable path.
* Voice latency: not benchmarked (the diagnostics page measures STT/TTS/task times on your PC as you use it). Replies appear when complete (no token streaming yet).
* Instagram: generic browser workflow only (open/read/draft); no platform-specific automation.
* Video: basic FFmpeg edits only. Montage = evenly-sized middle segments; no highlight/beat detection.
* Phone calls: one-way spoken reminders only.
* Installer: `win-unpacked` build succeeded here; NSIS packaging needs Windows/Wine, so it is delegated to CI/your PC (`npm run dist`).

## NOT IMPLEMENTED
* Two-way conversational phone calls (needs a public HTTPS/WebSocket endpoint; see SETUP.md).
* DaVinci Resolve / CapCut automation; user-defined workflow macro editor; code signing; auto-update; local/offline speech-to-text; screen-vision beyond sending screenshots to a vision-capable model.

## KNOWN LIMITATIONS
* Not every Windows app exposes UI Automation; unsupported actions return errors rather than pretending.
* Model quality decides how well multi-step tasks go; Ollama models without tool-calling will not work.
* `node:sqlite` is marked experimental in Node (stable enough in Electron 45; prints a warning in tests).
* Remote (Telegram) requests are read-only by design.
* Telegram bot chats are not end-to-end encrypted.

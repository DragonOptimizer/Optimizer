# JARVIS-AI: status (verified results)

Everything marked **VERIFIED ON WINDOWS** was observed in real GitHub Actions logs on a `windows-latest` runner (Windows build 10.0.26100, x64) by the CI workflow `.github/workflows/jarvis-ci.yml`. Anything needing your hardware, accounts or money is marked **NEEDS YOUR PC / ACCOUNT**.

## Installer
* `JARVIS-AI-Setup.exe` (NSIS, x64, ~125 MB, unsigned) is built by CI and published as a GitHub **pre-release** (`jarvis-build-N`) with `SHA256SUMS.txt`, plus a downloadable Actions artifact. Use the highest build number.
* VERIFIED ON WINDOWS (build 8, run 43483395039): silent install to a folder, `JARVIS.exe` present, **desktop and Start menu shortcuts created**, the **installed** app launched and passed the full end-to-end suite (49/49), silent uninstall exit code 0 and removed the app.
* NOT code-signed: Windows SmartScreen will warn; use *More info → Run anyway* after checking the SHA-256.

## VERIFIED ON WINDOWS (CI logs)
* TypeScript typecheck, 74 unit/integration tests (incl. real FFmpeg video pipeline and real Chrome/Edge browser automation against a local page).
* Electron end-to-end against the built app and against the installed app: first-run wizard (AI key + connection test, microphone test, speech key, Windows toggles, persisted), integrations OFF by default, main UI and all 14 pages, chat → AI → tool → verified result, approval dialog (deny blocks, allow runs), emergency STOP blocks tools until resumed, system tray created (menu has EMERGENCY STOP/Resume/Quit), start-with-Windows login item registers and can be turned off, floating overlay, settings/memory/conversation persistence across restart, scheduled reminder fires, secrets encrypted with real Windows DPAPI, renderer sandbox (no Node access, blocked IPC channels), voice capture → VAD → speech-to-text → chat using a synthetic WAV through Chromium's fake microphone.
* Windows computer-control tool tour with the installed app: `open_application` launches Notepad and verifies a real window, `list_windows`, `type_text`, `read_screen_text` (UI Automation read the typed text back), `close_application` asks for approval and reports reality honestly (Notepad with unsaved text shows "Save changes?", and JARVIS says `still-running`; it never force-kills).

## NEEDS YOUR PC / ACCOUNT (not testable in CI)
* Your real microphone and speakers, Windows microphone privacy permission, your voices' quality, real latency.
* The offline "Hey Jarvis" wake word (needs an installed Windows speech recognizer and your mic; accuracy unmeasured).
* Global push-to-talk shortcut (`Ctrl+Alt+J`) and emergency shortcut (`Ctrl+Alt+Shift+X`) on your keyboard layout; starting after a real Windows sign-in; your actual tray area.
* Real AI calls (your Anthropic/OpenAI/Gemini key or Ollama), real Whisper transcription (OpenAI/Groq key).
* Gmail, Google Classroom (your Google OAuth client; school admin may block), Telegram (your bot), Twilio calls (account, numbers, cost). **All off by default.** No real call has ever been placed.
* Controlling apps other than Notepad (depends on the app exposing UI Automation).

## Known limitations
* Replies appear when complete (no token streaming). Wake word is Windows-only and a single phrase. Video is basic FFmpeg editing (no cinematic/beat-sync/highlight detection, no DaVinci/CapCut automation). Instagram is the generic browser workflow only.
* Phone calls are one-way spoken messages. Two-way calls are planned in [PHASE2-TWO-WAY-CALLS.md](PHASE2-TWO-WAY-CALLS.md) and need a public relay you host; nothing paid will be started without your approval.
* Installer is unsigned; no auto-update. `node:sqlite` is flagged experimental by Node (works in Electron 45).
* Telegram bot chats are not end-to-end encrypted; remote (phone) requests are read-only by design.

## Not implemented
Two-way phone calls; local/offline speech-to-text; code signing; auto-update; macro/workflow editor UI.

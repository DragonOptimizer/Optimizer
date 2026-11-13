# Setup guide

## 0. Install
`npm run doctor`, `npm install`, `npm run build`, `npm start` (or install `JARVIS-Setup-*.exe`).

## 1. AI provider (required)
Settings → **AI provider & model**. Pick Anthropic, OpenAI, Gemini or Ollama.

* **API usage is billed per token by the provider. A Claude.ai or ChatGPT subscription does not include API credits.** JARVIS does not hard-code prices; enter your provider's rates in Settings to see an estimate. A daily and per-task token limit (defaults 500k / 100k) and a step limit prevent runaway spending.
* **Ollama** runs locally (no per-token cost). Install from ollama.com, `ollama pull llama3.1` (needs a tool-calling model). No key needed.
* Press **Load list** to fetch real model names, then **Test connection**.

## 2. Voice
* **Speech recognition**: OpenAI Whisper or Groq Whisper (needs that provider's API key; audio of your commands is uploaded and billed per audio minute). Without a key you can still type.
* **Talk**: the Talk button, or the global push-to-talk shortcut (default `Ctrl+Alt+J`: press once to start, it stops when you finish speaking, or press again).
* **Wake word “Hey Jarvis”** (Settings → Voice): uses the Windows built-in speech recognizer for one phrase, locally; needs an installed Windows speech language (`npm run doctor` checks). If it misfires or does not start, use push-to-talk.
* **Speech output**: Windows voices (free) or OpenAI TTS (billed). Interrupt JARVIS by speaking over it.
* Mic permission: Windows Settings → Privacy → Microphone → allow desktop apps.

## 3. Telegram (phone)
1. In Telegram message **@BotFather** → `/newbot` → copy the token.
2. Messaging page → paste token → **Connect bot** → send `/pair CODE` to your bot from your phone.
3. Only that account is authorised. **Disconnect** forgets the token and all paired accounts.

## 4. Gmail & Google Classroom
Uses *your own* Google Cloud OAuth client (JARVIS ships no shared credentials):
1. console.cloud.google.com → new project → **APIs & Services → Library**: enable *Gmail API*, *Google Classroom API*, *Google Drive API*.
2. **OAuth consent screen**: External, add yourself as a test user.
3. **Credentials → Create → OAuth client ID → Desktop app**. Copy the Client ID (and secret, if shown).
4. Email page → paste Client ID (and secret) → **Sign in with Google**.

School-managed accounts: the Workspace admin may block third-party apps or the Classroom/Drive APIs. JARVIS will report that error; it does not bypass it. If API access is blocked, ask JARVIS to use the browser tools (`Open Google Classroom`) with your own login, but note that PDF access is *not* assumed and is only claimed once actually read.

## 5. Phone calls (Twilio)
1. Create a Twilio account, buy/verify a number (trial accounts can only call numbers you verify).
2. Phone calls page: save Account SID + Auth Token, enter your number and the Twilio number (international format).
3. Press **Look up my rate** (real per-minute price from Twilio) and set a monthly limit and calling hours.
4. Tick the cost acknowledgement, enable calling, then **Place test call**.

Calls are one-way spoken messages (time-limited). **Two-way spoken calls** need Twilio to reach a web endpoint of yours: either a publicly reachable HTTPS webhook (TwiML `<Gather input="speech">`) or a Media Streams WebSocket server plus streaming STT/TTS. That means hosting a public service or a tunnel (cloudflared/ngrok), which exposes part of your PC and has extra costs. It is intentionally **not** enabled. Estimated work: a small cloud function/server relaying to the AI provider.

## 6. Video
Install FFmpeg (`winget install Gyan.FFmpeg`); outputs go to `Documents\JARVIS Workspace\videos`. Subtitles use the speech-recognition provider above.

## 7. Updating / data
Data lives in `%APPDATA%\JARVIS` (SQLite db, logs). Export or delete from **Privacy & security**.

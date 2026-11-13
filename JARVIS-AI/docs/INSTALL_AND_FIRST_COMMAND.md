# Install JARVIS and run your first spoken command

## 1. Download and verify
1. Open the **Releases** page of the repository and download **`JARVIS-AI-Setup.exe`** (and `SHA256SUMS.txt`) from the newest "JARVIS-AI Windows installer" release.
2. Optional check: open PowerShell in the download folder and run
   `Get-FileHash .\JARVIS-AI-Setup.exe -Algorithm SHA256`
   The value must equal the one on the release page.

## 2. Install
1. Double-click `JARVIS-AI-Setup.exe`.
2. The installer is **not code-signed** (I have no certificate), so Windows may show **"Windows protected your PC"**. Click **More info → Run anyway**. Only do this if the SHA-256 matched.
3. Pick the install folder (default is fine) → Install → Finish. A **JARVIS** shortcut appears on your desktop and in the Start menu.

## 3. First-run wizard (appears automatically)
1. **Welcome**: enter what you'd like to be called.
2. **AI provider**: choose Anthropic Claude (or OpenAI / Gemini / Ollama), paste your **API key**, press **Save & test connection**. You should see "Connected: …". (A Claude.ai subscription is not an API key: create one at console.anthropic.com and add billing credit.)
3. **Microphone**: press **Test microphone** and speak. If Windows blocks it, press **Open Windows microphone settings** and turn on *Let desktop apps access your microphone*.
4. **Speech**: choose **OpenAI Whisper** (needs an OpenAI key) or **Groq Whisper** (Groq key) for voice recognition, paste the key, **Save**. Pick a voice and press **Hear a sample**.
5. **Windows**: choose tray, start-with-Windows, the floating assistant, optional wake word.
6. **Finish**. Gmail, Classroom, Telegram and phone calls stay OFF.

## 4. Your first spoken command
1. On the main screen click **Talk** (or press `Ctrl+Alt+J`).
2. When the orb turns cyan and the **MIC LIVE** badge appears, say: **"What time is it?"**
3. Stop speaking. You'll see "Transcribing…", then your words appear in the chat, then the answer, spoken aloud.
4. Next try: **"Open Notepad."** JARVIS opens it and tells you whether a window really appeared. Say **"Close it"** and approve the permission prompt.

## If something doesn't work
* *No sound / not heard*: Settings → Voice: choose your microphone, check it isn't muted in Windows.
* *"No API key"*: Settings → AI provider → save the key → **Test connection**.
* *Voice error 401*: the speech-recognition key is wrong or has no billing.
* Diagnostics page shows each subsystem's real status and the logs. Emergency stop: **STOP** button, tray menu, or `Ctrl+Alt+Shift+X`.

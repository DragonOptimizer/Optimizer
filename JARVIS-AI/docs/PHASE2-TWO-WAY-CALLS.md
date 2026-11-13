# Phase 2 plan: real two-way conversational phone calls

**Status: planned only. Nothing in this plan is built, and no paid call is ever placed without your explicit approval.** Today JARVIS places one-way spoken reminder calls (Twilio `<Say>`, hard time limit, spending cap).

## Why it needs more than the desktop app
A live conversation means Twilio must stream the caller's audio (or transcribed text) to something that can answer in real time. Twilio can only reach a **publicly reachable HTTPS/WSS endpoint**. Your PC is not one, and JARVIS deliberately never opens inbound ports. So Phase 2 needs a small, separate **call relay service** that you host.

## Recommended architecture
```
Twilio (PSTN) --WSS--> Call Relay (small cloud service you own)
                         |  text turns (authenticated, outbound from your PC)
JARVIS desktop <---------+  PC connects OUT to the relay over WSS; no inbound ports
```
* **Option A (preferred, least code): Twilio ConversationRelay.** Twilio performs speech-to-text and text-to-speech and sends the relay plain-text turns over a WebSocket; the relay returns text. Verify current availability, supported voices/languages and per-minute pricing in Twilio's docs before building.
* **Option B: Media Streams.** Raw audio over WebSocket; we add streaming STT and TTS ourselves (more latency work, more providers, more cost).
* **Option C: `<Gather input="speech">` webhooks.** Simplest, turn-based, higher latency; good as a first spike.

The relay holds the Twilio auth, validates every request (`X-Twilio-Signature`), answers only calls JARVIS created, and forwards each caller utterance to the JARVIS desktop agent (or to the AI provider directly with a restricted prompt). Hosting candidates: Cloudflare Workers/Durable Objects, Fly.io, Google Cloud Run, or a tiny VPS. You own the account and the bill.

## Safety rules (non-negotiable)
1. Outbound calls only to **your own verified number**. No contacts, no automated outreach, no inbound-call answering in v1.
2. Each call needs a one-time approval in the app showing the number, purpose, max duration and worst-case cost; scheduled calls are approved when the schedule is created.
3. Hard limits enforced in two places (desktop and relay): max seconds per call, calls per day, monthly spend cap, calling hours.
4. The AI on a call has **read-only tools** and cannot send email, delete, click, or spend. Sensitive requests are deferred ("I'll put that in the app for your approval").
5. Emergency stop hangs up active calls via the Twilio API and blocks new ones. `/stop` from paired Telegram also does this.
6. The agent identifies itself as an AI at the start of every call; transcripts are stored locally only if you enable it.
7. Relay secrets are random per install; the PC-to-relay link uses a rotating token; relay logs contain no audio.

## Milestones
1. **Spike (no cost beyond a few cents):** `<Gather>` echo bot on a free-tier relay, one test call you approve manually. Measure round-trip latency.
2. **Relay MVP:** signature validation, per-call token, WSS link to the desktop app, text turns to the AI with the restricted tool set.
3. **ConversationRelay (or Media Streams) integration:** barge-in, streaming replies, silence/hangup handling, max-duration enforcement.
4. **Desktop UI:** "Two-way calls" panel: relay URL, status, cost estimate, call transcripts (optional), kill switch.
5. **Hardening and tests:** fixture-based relay tests in CI, signature-forgery tests, limit tests, a documented manual test checklist with real calls (**each paid test call needs your OK**).

## What I need from you before starting
* Approval to proceed and a choice of relay host (or a Cloud account you want it on).
* Twilio plan details (trial or paid; trial calls play a notice and only reach verified numbers).
* Your latency/cost preference (Option A is usually best).

## Estimated risks / open questions
Per-minute cost is higher than one-way calls (telephony + STT/TTS + AI tokens); call latency depends on the AI provider; Twilio trial restrictions; regional regulations for automated calls (you call only yourself, which keeps this simple).

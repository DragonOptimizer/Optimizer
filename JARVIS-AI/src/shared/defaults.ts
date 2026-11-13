import type { Settings } from './types'

export const DEFAULT_SETTINGS: Settings = {
  profile: { preferredName: 'sir', personality: 'classic', customPersonality: '', responseLength: 'short' },
  ai: {
    provider: 'anthropic',
    models: { anthropic: 'claude-sonnet-5-5', openai: 'gpt-4.1', gemini: 'gemini-2.5-flash', ollama: 'llama3.1' },
    ollamaUrl: 'http://127.0.0.1:11434',
    maxSteps: 12,
    dailyTokenLimit: 500_000,
    taskTokenLimit: 100_000,
    costPerMTokIn: 0,
    costPerMTokOut: 0,
    paidServicesAcknowledged: false
  },
  voice: {
    enabled: true, wakeWordEnabled: false, wakePhrase: 'hey jarvis', pushToTalkShortcut: 'Control+Alt+J', muted: false,
    sttProvider: 'openai', sttModel: 'whisper-1', ttsProvider: 'system', ttsVoice: '', ttsModel: 'tts-1',
    speechRate: 1, listenTimeoutSec: 12, inputDeviceId: '', outputDeviceId: '', speakResponses: true
  },
  computer: { enabled: true, allowedRoots: [], approvalMode: 'balanced', browser: 'chrome', browserHeadless: false, allowLocalBrowsing: false, persistBrowserProfile: false },
  ui: { alwaysOnTop: false, overlayEnabled: false, startWithWindows: false, minimizeToTray: true, onboardingDone: false },
  phone: {
    telegramEnabled: false, callsEnabled: false, callsAcknowledgedCosts: false, userNumber: '', callerNumber: '', callVoice: 'Polly.Matthew',
    callWindowStart: '08:00', callWindowEnd: '21:00', maxCallSeconds: 120, monthlySpendLimitUsd: 5, estCostPerMinuteUsd: 0
  },
  google: { clientId: '', gmailEnabled: false, classroomEnabled: false, notifyImportantMail: false },
  security: { pinEnabled: false, approvalTimeoutSec: 120 }
}

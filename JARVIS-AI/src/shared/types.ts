// Types shared between main, preload and renderer. No runtime dependencies.

export type AssistantState =
  | 'idle' | 'listening' | 'processing' | 'speaking' | 'acting' | 'awaiting_approval' | 'error' | 'offline'

export type RiskLevel = 'safe' | 'moderate' | 'sensitive' | 'dangerous'
export type TaskStatus = 'planned' | 'running' | 'completed' | 'failed' | 'awaiting_approval' | 'cancelled' | 'denied'
export type MessageSource = 'text' | 'voice' | 'telegram' | 'scheduler'

export interface ChatMessage {
  id: string
  conversationId: string
  role: 'user' | 'assistant' | 'system'
  content: string
  source: MessageSource
  createdAt: number
}

/** A real execution event emitted by the agent / tool runner. The UI renders these verbatim. */
export interface ActivityEvent {
  id: string
  ts: number
  taskId: string
  kind: 'task' | 'plan' | 'tool' | 'approval' | 'info' | 'error'
  status: TaskStatus
  tool?: string
  risk?: RiskLevel
  message: string
  detail?: string
}

export interface ApprovalRequest {
  id: string
  taskId: string
  tool: string
  risk: RiskLevel
  summary: string
  args: unknown
  reason: string
  createdAt: number
  expiresAt: number
  allowRemember: boolean
}
export type ApprovalDecision = 'allow' | 'allow_always' | 'deny'

export interface TaskRecord {
  id: string
  title: string
  source: MessageSource
  status: TaskStatus
  startedAt: number
  finishedAt?: number
  summary?: string
  tokensIn: number
  tokensOut: number
}

export interface MemoryItem {
  id: string
  kind: 'preference' | 'fact' | 'goal' | 'project' | 'note'
  content: string
  createdAt: number
  updatedAt: number
}

export type RecurrenceSpec =
  | { type: 'once'; at: number }
  | { type: 'daily'; time: string }
  | { type: 'weekdays'; time: string }
  | { type: 'weekly'; days: number[]; time: string } // 0=Sunday

export type ScheduleChannel = 'notification' | 'speech' | 'telegram' | 'call'
export interface ScheduleRecord {
  id: string
  title: string
  kind: 'reminder' | 'agent'
  message: string // reminder text or agent prompt
  recurrence: RecurrenceSpec
  channels: ScheduleChannel[]
  enabled: boolean
  nextRun: number | null
  lastRun: number | null
  lastStatus: string | null
  createdAt: number
}
export interface ScheduleRunRecord { id: string; scheduleId: string; ts: number; status: 'ok' | 'error' | 'missed'; detail: string }

export type ProviderId = 'anthropic' | 'openai' | 'gemini' | 'ollama'

export interface Settings {
  profile: { preferredName: string; personality: 'professional' | 'friendly' | 'humorous' | 'classic' | 'custom'; customPersonality: string; responseLength: 'short' | 'medium' | 'long' }
  ai: {
    provider: ProviderId
    models: Record<ProviderId, string>
    ollamaUrl: string
    maxSteps: number
    dailyTokenLimit: number // 0 = unlimited
    taskTokenLimit: number
    costPerMTokIn: number // user supplied, USD, 0 = unknown
    costPerMTokOut: number
    paidServicesAcknowledged: boolean
  }
  voice: {
    enabled: boolean
    wakeWordEnabled: boolean
    wakePhrase: string
    pushToTalkShortcut: string
    muted: boolean
    sttProvider: 'openai' | 'groq' | 'none'
    sttModel: string
    ttsProvider: 'system' | 'openai'
    ttsVoice: string
    ttsModel: string
    speechRate: number
    listenTimeoutSec: number
    inputDeviceId: string
    outputDeviceId: string
    speakResponses: boolean
  }
  computer: { enabled: boolean; allowedRoots: string[]; approvalMode: 'strict' | 'balanced'; browser: 'chrome' | 'msedge' | 'chromium'; browserHeadless: boolean; allowLocalBrowsing: boolean; persistBrowserProfile: boolean }
  ui: { alwaysOnTop: boolean; overlayEnabled: boolean; startWithWindows: boolean; minimizeToTray: boolean; onboardingDone: boolean }
  phone: {
    telegramEnabled: boolean
    callsEnabled: boolean
    callsAcknowledgedCosts: boolean
    userNumber: string
    callerNumber: string
    callVoice: string
    callWindowStart: string
    callWindowEnd: string
    maxCallSeconds: number
    monthlySpendLimitUsd: number
    estCostPerMinuteUsd: number
  }
  google: { clientId: string; gmailEnabled: boolean; classroomEnabled: boolean; notifyImportantMail: boolean }
  security: { pinEnabled: boolean; approvalTimeoutSec: number }
}

export interface ProviderStatus { id: ProviderId; configured: boolean; model: string }

export interface DiagnosticCheck { id: string; label: string; status: 'ok' | 'warn' | 'fail' | 'unknown'; detail: string }
export interface LogEntry { ts: number; level: 'debug' | 'info' | 'warn' | 'error'; scope: string; msg: string; data?: unknown }

export interface ToolInfo { name: string; description: string; risk: RiskLevel; category: string; unattendedOk: boolean }

export interface CallRecord { id: string; ts: number; to: string; status: string; sid?: string; durationSec?: number; estCostUsd: number; reason: string }
export interface AuditEntry { id: string; ts: number; actor: string; tool: string; risk: RiskLevel; decision: string; summary: string }

export interface TelegramStatus { configured: boolean; running: boolean; botUsername?: string; pairedChats: { id: number; name: string }[]; pairingCode?: string; lastError?: string }
export interface GoogleStatus { connected: boolean; email?: string; scopes: string[]; clientConfigured: boolean }
export interface PhoneStatus { configured: boolean; enabled: boolean; spentThisMonthUsd: number; stopped: boolean }

export interface AppSnapshot {
  state: AssistantState
  stateDetail: string
  online: boolean
  version: string
  platform: string
  locked: boolean
  pinRequired: boolean
}

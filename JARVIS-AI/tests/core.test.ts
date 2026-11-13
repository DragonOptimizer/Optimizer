import { describe, it, expect, afterEach } from 'vitest'
import { join } from 'node:path'
import { makeCore, tmpDir } from './helpers'
import { MemoryStore } from '../src/main/core/memory'
import { validate } from '../src/main/core/schema'
import { redact } from '../src/main/core/logger'

describe('settings persistence', () => {
  const t = tmpDir()
  afterEach(() => t.cleanup())
  it('persists across restarts and ignores unknown/mistyped keys', () => {
    const db = join(t.dir, 'j.db')
    const a = makeCore({}, db)
    a.settings.update({ profile: { preferredName: 'Tony', responseLength: 'long' }, ai: { provider: 'openai', maxSteps: 99 }, bogus: 1, voice: { speechRate: 'fast' } })
    a.db.close()
    const b = makeCore({}, db)
    const s = b.settings.get()
    expect(s.profile.preferredName).toBe('Tony')
    expect(s.profile.responseLength).toBe('long')
    expect(s.ai.provider).toBe('openai')
    expect(s.ai.maxSteps).toBe(25) // clamped
    expect(s.voice.speechRate).toBe(1) // wrong type ignored
    expect((s as any).bogus).toBeUndefined()
  })
})

describe('secrets', () => {
  it('stores only encrypted blobs and refuses plaintext fallback', () => {
    const c = makeCore()
    c.secrets.set('ai.openai.key', 'sk-test-1234567890abcdef')
    const raw = c.db.get<{ blob: Uint8Array }>('SELECT blob FROM secrets WHERE name=?', 'ai.openai.key')!
    expect(Buffer.from(raw.blob).toString()).not.toContain('sk-test')
    expect(c.secrets.get('ai.openai.key')).toBe('sk-test-1234567890abcdef')
    const noEnc = makeCore({ encryptor: { available: () => false, encrypt: () => { throw new Error('x') }, decrypt: () => '' } })
    expect(() => noEnc.secrets.set('a', 'b')).toThrow(/plaintext/)
  })
  it('redacts secrets in logs', () => {
    expect(redact('key sk-abcdefghijklmnop and Bearer abc.def')).not.toMatch(/sk-abc|abc\.def/)
  })
})

describe('memory', () => {
  it('persists, searches, refuses secrets, dedupes', () => {
    const t = tmpDir(); const db = join(t.dir, 'm.db')
    const a = makeCore({}, db)
    a.memory.add('User prefers short explanations', 'preference')
    a.memory.add('Working on a chemistry lab report', 'project')
    expect(() => a.memory.add('my password is hunter2')).toThrow(/secret/i)
    expect(() => a.memory.add('use key sk-abcdefghijklmnopqrstuv')).toThrow()
    expect(a.memory.add('user prefers short explanations').kind).toBe('preference') // dedupe
    a.db.close()
    const b = makeCore({}, db)
    expect(b.memory.list()).toHaveLength(2)
    expect(b.memory.search('chemistry report')[0].content).toMatch(/chemistry/)
    expect(b.memory.forPrompt('unrelated').some((m) => m.kind === 'preference')).toBe(true)
    t.cleanup()
  })
})

describe('conversation store', () => {
  it('saves and reloads history in order', () => {
    const c = makeCore()
    const id = c.conversations.create()
    c.conversations.add(id, 'user', 'hello')
    c.conversations.add(id, 'assistant', 'hi')
    expect(c.conversations.history(id).map((m) => m.content)).toEqual(['hello', 'hi'])
    expect(c.conversations.list()[0].title).toBe('hello')
  })
})

describe('schema validation', () => {
  const s = { type: 'object', required: ['a'], properties: { a: { type: 'string', maxLength: 3 }, n: { type: 'integer', minimum: 1 }, e: { type: 'string', enum: ['x', 'y'] } }, additionalProperties: false } as const
  it('accepts valid and rejects invalid', () => {
    expect(validate(s as any, { a: 'ab', n: 2, e: 'x' })).toBeNull()
    expect(validate(s as any, {})).toMatch(/required/)
    expect(validate(s as any, { a: 'abcd' })).toMatch(/too long/)
    expect(validate(s as any, { a: 'a', n: 0 })).toMatch(/>=/)
    expect(validate(s as any, { a: 'a', e: 'z' })).toMatch(/one of/)
    expect(validate(s as any, { a: 'a', zzz: 1 })).toMatch(/not a recognised/)
  })
})
void MemoryStore

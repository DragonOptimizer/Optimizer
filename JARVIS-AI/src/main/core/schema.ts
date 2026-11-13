/** Minimal JSON-Schema subset validator for tool arguments (type, enum, required, properties, items, min/max, pattern). */
export type JsonSchema = {
  type?: 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array'
  description?: string
  enum?: readonly (string | number)[]
  properties?: Record<string, JsonSchema>
  required?: readonly string[]
  items?: JsonSchema
  minimum?: number
  maximum?: number
  maxLength?: number
  pattern?: string
  additionalProperties?: boolean
}

export function validate(schema: JsonSchema, value: unknown, path = 'args'): string | null {
  const t = schema.type
  if (t === 'string') {
    if (typeof value !== 'string') return `${path} must be a string`
    if (schema.maxLength && value.length > schema.maxLength) return `${path} is too long (max ${schema.maxLength})`
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) return `${path} has an invalid format`
  } else if (t === 'number' || t === 'integer') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return `${path} must be a number`
    if (t === 'integer' && !Number.isInteger(value)) return `${path} must be an integer`
    if (schema.minimum !== undefined && value < schema.minimum) return `${path} must be >= ${schema.minimum}`
    if (schema.maximum !== undefined && value > schema.maximum) return `${path} must be <= ${schema.maximum}`
  } else if (t === 'boolean') {
    if (typeof value !== 'boolean') return `${path} must be a boolean`
  } else if (t === 'array') {
    if (!Array.isArray(value)) return `${path} must be an array`
    if (schema.items) for (let i = 0; i < value.length; i++) { const e = validate(schema.items, value[i], `${path}[${i}]`); if (e) return e }
  } else if (t === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return `${path} must be an object`
    const obj = value as Record<string, unknown>
    for (const r of schema.required ?? []) if (obj[r] === undefined || obj[r] === null) return `${path}.${r} is required`
    for (const [k, s] of Object.entries(schema.properties ?? {})) {
      if (obj[k] !== undefined && obj[k] !== null) { const e = validate(s, obj[k], `${path}.${k}`); if (e) return e }
    }
    if (schema.additionalProperties === false) {
      for (const k of Object.keys(obj)) if (!schema.properties || !(k in schema.properties)) return `${path}.${k} is not a recognised argument`
    }
  }
  if (schema.enum && !schema.enum.includes(value as any)) return `${path} must be one of: ${schema.enum.join(', ')}`
  return null
}

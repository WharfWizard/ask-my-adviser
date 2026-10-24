// Membership check for Ask My Adviser.
//
// Configure ONE of these in Vercel → Project → Settings → Environment Variables:
//   MEMBERSHIP_VERIFY_URL  — a My Life Record endpoint. Receives POST {"code": "...", "app": "ask-my-adviser"}
//                            (with "Authorization: Bearer <MEMBERSHIP_VERIFY_SECRET>" if that is set)
//                            and must reply with JSON {"valid": true} for a current member.
//   MEMBER_ACCESS_CODES    — a comma-separated list of member access codes (works today, no other system needed).
// Set MEMBERSHIP_REQUIRED=false only for local testing; the app is then open to anyone.
import { timingSafeEqual, createHash } from 'node:crypto'

const cache = new Map() // code hash -> expiry time (per running instance only)
const CACHE_MS = 10 * 60 * 1000

const hash = (s) => createHash('sha256').update(s).digest()

function codeInList(code, list) {
  const h = hash(code)
  let ok = false
  for (const item of list) {
    if (timingSafeEqual(h, hash(item))) ok = true
  }
  return ok
}

export function membershipConfigured() {
  return process.env.MEMBERSHIP_REQUIRED === 'false' || Boolean(process.env.MEMBERSHIP_VERIFY_URL) || Boolean(process.env.MEMBER_ACCESS_CODES)
}

export async function isMember(rawCode) {
  if (process.env.MEMBERSHIP_REQUIRED === 'false') return true
  const code = typeof rawCode === 'string' ? rawCode.trim() : ''
  if (!code || code.length > 200) return false

  const key = hash(code).toString('hex')
  const until = cache.get(key)
  if (until && until > Date.now()) return true

  let valid = false
  if (process.env.MEMBERSHIP_VERIFY_URL) {
    try {
      const headers = { 'Content-Type': 'application/json' }
      if (process.env.MEMBERSHIP_VERIFY_SECRET) headers.Authorization = `Bearer ${process.env.MEMBERSHIP_VERIFY_SECRET}`
      const r = await fetch(process.env.MEMBERSHIP_VERIFY_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({ code, app: 'ask-my-adviser' }),
        signal: AbortSignal.timeout(8000),
      })
      if (r.ok) valid = (await r.json())?.valid === true
    } catch {
      valid = false
    }
  } else if (process.env.MEMBER_ACCESS_CODES) {
    const list = process.env.MEMBER_ACCESS_CODES.split(',').map((s) => s.trim()).filter(Boolean)
    valid = codeInList(code, list)
  }

  if (valid) cache.set(key, Date.now() + CACHE_MS)
  return valid
}

// A soft daily limit per member code, held in memory. It resets whenever Vercel
// starts a fresh instance, so it slows down misuse rather than guaranteeing a cap.
const usage = new Map()
export function withinDailyLimit(rawCode) {
  const limit = Number(process.env.DAILY_ANALYSIS_LIMIT || 30)
  const day = new Date().toISOString().slice(0, 10)
  const key = `${day}:${hash(String(rawCode || 'open')).toString('hex')}`
  const n = (usage.get(key) || 0) + 1
  usage.set(key, n)
  if (usage.size > 5000) usage.clear()
  return n <= limit
}

// Membership for Ask My Adviser — the My Life Record pass handshake.
//
// 1. The app sends the person to https://myliferecord.app/api/unlock?app=ask-my-adviser&return=<this site>/unlock&state=<random>
// 2. My Life Record checks their Google sign-in and membership (subscription or redeemed planner code).
// 3. It redirects back to /unlock?state=<same>#mlr_pass=<signed pass>.
// 4. Every API call carries the pass. This file checks its EdDSA signature against
//    My Life Record's published key, its issuer, its audience (this app), expiry and the mbr flag.
//
// Environment variables (all optional):
//   MLR_JWKS_URL        — defaults to https://myliferecord.app/.well-known/jwks.json
//   MLR_JWKS            — the key set as inline JSON instead of fetching it (offline testing, or pinning)
//   MEMBERSHIP_REQUIRED — set to "false" ONLY for local testing; the app is then open to anyone.
import { jwtVerify, createRemoteJWKSet, createLocalJWKSet } from 'jose'

export const MLR_ISSUER = 'https://myliferecord.app'
export const APP_ID = 'ask-my-adviser'

let keySet = null
function getKeySet() {
  if (keySet) return keySet
  if (process.env.MLR_JWKS) {
    keySet = createLocalJWKSet(JSON.parse(process.env.MLR_JWKS))
  } else {
    keySet = createRemoteJWKSet(new URL(process.env.MLR_JWKS_URL || `${MLR_ISSUER}/.well-known/jwks.json`), {
      cooldownDuration: 60_000,
      cacheMaxAge: 6 * 60 * 60 * 1000,
    })
  }
  return keySet
}

export function membershipOpen() {
  return process.env.MEMBERSHIP_REQUIRED === 'false'
}

export function readPass(req) {
  const h = req.headers?.authorization || req.headers?.Authorization || ''
  const m = /^Bearer\s+([A-Za-z0-9._-]+)$/.exec(h)
  return m ? m[1] : null
}

// Returns { ok: true, member, expiresAt } or { ok: false, reason }
export async function checkPass(pass) {
  if (membershipOpen()) return { ok: true, member: 'open', expiresAt: null }
  if (!pass || pass.length > 4096) return { ok: false, reason: 'missing' }
  try {
    const { payload } = await jwtVerify(pass, getKeySet(), {
      issuer: MLR_ISSUER,
      audience: APP_ID,
      algorithms: ['EdDSA'],
      requiredClaims: ['exp', 'sub'],
      clockTolerance: 60,
    })
    if (payload.mbr !== true) return { ok: false, reason: 'not_member' }
    return { ok: true, member: String(payload.sub), expiresAt: payload.exp * 1000 }
  } catch (err) {
    const reason = err?.code === 'ERR_JWT_EXPIRED' ? 'expired' : 'invalid'
    if (reason === 'invalid') console.error('Pass rejected:', err?.code || err?.name)
    return { ok: false, reason }
  }
}

// A soft daily limit per member, held in memory. It resets whenever Vercel
// starts a fresh instance, so it slows misuse rather than guaranteeing a cap.
const usage = new Map()
export function withinDailyLimit(member) {
  const limit = Number(process.env.DAILY_ANALYSIS_LIMIT || 30)
  const key = `${new Date().toISOString().slice(0, 10)}:${member}`
  const n = (usage.get(key) || 0) + 1
  usage.set(key, n)
  if (usage.size > 5000) usage.clear()
  return n <= limit
}

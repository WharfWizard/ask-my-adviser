// Browser side of the My Life Record pass handshake.
const MLR_URL = import.meta.env.VITE_MLR_URL || 'https://myliferecord.app'
const APP_ID = 'ask-my-adviser'
const STATE_KEY = 'ama-unlock-state'
const PASS_KEY = 'ama-pass'

const ss = {
  get(k) { try { return sessionStorage.getItem(k) } catch { return null } },
  set(k, v) { try { sessionStorage.setItem(k, v) } catch { /* private mode */ } },
  del(k) { try { sessionStorage.removeItem(k) } catch { /* ignore */ } },
}

export const myLifeUrl = MLR_URL

// Send the person to My Life Record to collect a membership pass.
export function startUnlock() {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  const state = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  ss.set(STATE_KEY, state)
  const url = new URL('/api/unlock', MLR_URL)
  url.searchParams.set('app', APP_ID)
  url.searchParams.set('return', `${window.location.origin}/unlock`)
  url.searchParams.set('state', state)
  window.location.assign(url.toString())
}

// On return from My Life Record: take the pass from the URL fragment, check the
// state matches the one we sent, and clear both from the address bar.
// Returns { pass } | { error } | null (nothing to receive).
export function receivePass() {
  const hash = window.location.hash
  const match = /(?:^#|&)mlr_pass=([^&]+)/.exec(hash)
  if (!match && window.location.pathname !== '/unlock') return null

  const returnedState = new URLSearchParams(window.location.search).get('state') || ''
  const expected = ss.get(STATE_KEY)
  ss.del(STATE_KEY)
  window.history.replaceState({}, '', '/')

  if (!match) return { error: 'No membership pass came back from My Life Record. Please try again.' }
  if (!expected || returnedState !== expected) {
    return { error: 'That sign-in link has expired or was started in another tab. Please try again.' }
  }
  return { pass: decodeURIComponent(match[1]) }
}

export const storedPass = {
  get: () => ss.get(PASS_KEY),
  set: (p) => ss.set(PASS_KEY, p),
  clear: () => ss.del(PASS_KEY),
}

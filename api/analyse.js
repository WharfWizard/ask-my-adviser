import { buildRequest, extractResult, InputError } from '../lib/server/prompts.js'
import { checkPass, readPass, withinDailyLimit, membershipOpen, visitorKey } from '../lib/server/membership.js'

const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5-5'
const MAX_TOKENS = { inventory: 3000, topic: 8000, agenda: 4000, followup: 5000 }

export const config = { maxDuration: 300 }

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'The analysis service has not been set up yet.' })

  const pass = await checkPass(readPass(req))
  if (!pass.ok) {
    return res.status(401).json({ error: 'Please sign in again through My Life Record.', code: pass.reason })
  }
  if (!withinDailyLimit(membershipOpen() ? visitorKey(req) : pass.member)) {
    return res.status(429).json({ error: "You've reached today's limit for analyses. Please come back tomorrow." })
  }

  let body = req.body
  if (typeof body === 'string') {
    try { body = JSON.parse(body) } catch { return res.status(400).json({ error: 'Invalid request.' }) }
  }

  let request
  try {
    request = buildRequest(body, { model: MODEL, maxTokens: MAX_TOKENS[body?.action] || 4000 })
  } catch (err) {
    if (err instanceof InputError) return res.status(400).json({ error: err.message })
    throw err
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY.trim(),
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(280000),
    })
    const raw = await response.text()
    let data = {}
    try { data = JSON.parse(raw) } catch { data = { error: { type: 'non_json_response', message: raw.slice(0, 200) } } }
    if (!response.ok) {
      const type = data?.error?.type || 'unknown'
      const message = String(data?.error?.message || '').slice(0, 300)
      console.error('Claude API error', response.status, type, message)
      // The API's own explanation never contains the key or the documents, so it is safe to show.
      const detail = `Claude API ${response.status} ${type}${message ? `: ${message}` : ''}`
      let error = 'The analysis could not be completed. Please try again.'
      if (response.status === 429 || response.status === 529) error = 'The analysis service is busy. Please wait a minute and try again.'
      else if (response.status === 401 || response.status === 403) error = 'The analysis service is not set up correctly (the Claude API key was refused).'
      else if (/credit balance/i.test(message)) error = 'The analysis service is temporarily unavailable (the Claude account needs topping up).'
      else if (response.status === 404 || /model/i.test(message)) error = 'The analysis service is not set up correctly (the Claude model was not found).'
      return res.status(response.status === 429 || response.status === 529 ? 503 : 502).json({ error, detail })
    }
    let extracted
    try { extracted = extractResult(data) } catch (e) {
      console.error('Unexpected reply', data?.stop_reason)
      return res.status(502).json({ error: e.message, detail: `stop_reason ${data?.stop_reason || 'none'}` })
    }
    const { result, truncated } = extracted
    // Nothing from the documents or the result is logged or stored.
    return res.status(200).json({ result, truncated })
  } catch (err) {
    console.error('Analyse failed', err?.name, err?.message)
    const timeout = err?.name === 'TimeoutError'
    return res.status(504).json({
      error: timeout ? 'The analysis took too long. Try fewer or shorter documents.' : 'The analysis could not be completed. Please try again.',
      detail: `${err?.name || 'Error'}: ${String(err?.message || '').slice(0, 200)}`,
    })
  }
}

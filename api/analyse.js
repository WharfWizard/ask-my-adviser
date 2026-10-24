import { buildRequest, extractToolResult, InputError } from '../lib/server/prompts.js'
import { isMember, membershipConfigured, withinDailyLimit } from '../lib/server/membership.js'

const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5-5'
const MAX_TOKENS = { inventory: 3000, topic: 8000, agenda: 4000, followup: 5000 }

export const config = { maxDuration: 300 }

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'The analysis service has not been set up yet.' })
  if (!membershipConfigured()) return res.status(503).json({ error: 'Membership checking has not been set up yet.' })

  const code = req.headers['x-member-code']
  if (!(await isMember(code))) {
    return res.status(401).json({ error: 'Please sign in with your member access code.', code: 'not_member' })
  }
  if (!withinDailyLimit(code)) {
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
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(280000),
    })
    const data = await response.json()
    if (!response.ok) {
      console.error('Claude API error', response.status, data?.error?.type, data?.error?.message)
      const busy = response.status === 429 || response.status === 529
      return res.status(busy ? 503 : 502).json({
        error: busy ? 'The analysis service is busy. Please wait a minute and try again.' : 'The analysis could not be completed. Please try again.',
      })
    }
    const { result, truncated } = extractToolResult(data)
    // Nothing from the documents or the result is logged or stored.
    return res.status(200).json({ result, truncated })
  } catch (err) {
    console.error('Analyse failed', err?.name, err?.message)
    const timeout = err?.name === 'TimeoutError'
    return res.status(504).json({
      error: timeout ? 'The analysis took too long. Try fewer or shorter documents.' : 'The analysis could not be completed. Please try again.',
    })
  }
}

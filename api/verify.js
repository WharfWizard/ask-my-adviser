import { isMember, membershipConfigured } from '../lib/server/membership.js'

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!membershipConfigured()) {
    return res.status(503).json({ error: 'Membership checking has not been set up yet. Please try again later.' })
  }
  let body = req.body
  if (typeof body === 'string') {
    try { body = JSON.parse(body) } catch { body = {} }
  }
  const ok = await isMember(body?.code)
  if (!ok) return res.status(401).json({ error: "That code wasn't recognised. Please check it and try again." })
  return res.status(200).json({ valid: true, open: process.env.MEMBERSHIP_REQUIRED === 'false' })
}

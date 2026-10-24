import { checkPass, readPass, membershipOpen } from '../lib/server/membership.js'

// Confirms a My Life Record pass so the browser knows whether to show the app
// or send the person to My Life Record. Every analysis call checks the pass again.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const result = await checkPass(readPass(req))
  if (!result.ok) return res.status(401).json({ valid: false, reason: result.reason })
  return res.status(200).json({ valid: true, open: membershipOpen(), expiresAt: result.expiresAt })
}

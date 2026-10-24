import test from 'node:test'
import assert from 'node:assert/strict'

// Launch mode: no membership required, limited per visitor instead.
process.env.ANTHROPIC_API_KEY = 'test-key'
process.env.DAILY_ANALYSIS_LIMIT = '3'
delete process.env.REQUIRE_MEMBERSHIP

const { default: analyse } = await import('../api/analyse.js')

let calls = 0
globalThis.fetch = async (url, init) => {
  calls++
  const tool = JSON.parse(init.body).tool_choice.name
  return { ok: true, status: 200, json: async () => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', name: tool, input: { ok: true } }] }) }
}
function mockRes() {
  const res = { statusCode: 200, headers: {}, body: null }
  res.setHeader = (k, v) => { res.headers[k] = v }
  res.status = (c) => { res.statusCode = c; return res }
  res.json = (b) => { res.body = b; return res }
  return res
}
const docs = [{ name: 'a.pdf', text: 'Ongoing advice fee 0.75% a year.' }]
const from = (ip) => ({ 'x-forwarded-for': `${ip}, 10.0.0.1` })

test('works without signing in', async () => {
  const res = mockRes()
  await analyse({ method: 'POST', headers: from('203.0.113.5'), body: { action: 'inventory', documents: docs } }, res)
  assert.equal(res.statusCode, 200)
})

test('limits each visitor per day, separately', async () => {
  const codes = []
  for (let i = 0; i < 3; i++) {
    const res = mockRes()
    await analyse({ method: 'POST', headers: from('198.51.100.7'), body: { action: 'inventory', documents: docs } }, res)
    codes.push(res.statusCode)
  }
  assert.deepEqual(codes, [200, 200, 200])
  const before = calls
  const res = mockRes()
  await analyse({ method: 'POST', headers: from('198.51.100.7'), body: { action: 'inventory', documents: docs } }, res)
  assert.equal(res.statusCode, 429)
  assert.equal(calls, before, 'a limited visitor never reaches Claude')
  const other = mockRes()
  await analyse({ method: 'POST', headers: from('192.0.2.44'), body: { action: 'inventory', documents: docs } }, other)
  assert.equal(other.statusCode, 200)
})

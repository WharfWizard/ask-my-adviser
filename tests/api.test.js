import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPair, exportJWK, SignJWT } from 'jose'

// A stand-in for My Life Record's signing key, published the same way as its jwks.json
const { publicKey, privateKey } = await generateKeyPair('EdDSA', { crv: 'Ed25519' })
const jwk = { ...(await exportJWK(publicKey)), kid: 'mlr-pass-v1', use: 'sig', alg: 'EdDSA' }
process.env.MLR_JWKS = JSON.stringify({ keys: [jwk] })
process.env.ANTHROPIC_API_KEY = 'test-key'
delete process.env.MEMBERSHIP_REQUIRED

const other = await generateKeyPair('EdDSA', { crv: 'Ed25519' })

async function makePass({ aud = 'ask-my-adviser', iss = 'https://myliferecord.app', mbr = true, exp = '7d', key = privateKey } = {}) {
  const now = Math.floor(Date.now() / 1000)
  const jwt = new SignJWT({ mbr, sub: 'pairwise-member-1' })
    .setProtectedHeader({ alg: 'EdDSA', kid: 'mlr-pass-v1' })
    .setIssuer(iss).setAudience(aud).setIssuedAt(now - 10).setJti('test')
  jwt.setExpirationTime(exp === 'past' ? now - 3600 : exp)
  return jwt.sign(key)
}

const { default: analyse } = await import('../api/analyse.js')
const { default: verify } = await import('../api/verify.js')

function mockRes() {
  const res = { statusCode: 200, headers: {}, body: null }
  res.setHeader = (k, v) => { res.headers[k] = v }
  res.status = (c) => { res.statusCode = c; return res }
  res.json = (b) => { res.body = b; return res }
  return res
}
const auth = (p) => ({ authorization: `Bearer ${p}` })

const docs = [{ name: '2025-03-14_review.pdf', label: 'Ongoing review report', date: '2025-03-14', text: '[Page 1]\nOngoing advice fee 0.75% a year.' }]
let lastRequest = null
globalThis.fetch = async (url, init) => {
  lastRequest = { url, body: JSON.parse(init.body), headers: init.headers }
  const tool = lastRequest.body.tool_choice.name
  return { ok: true, status: 200, json: async () => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', name: tool, input: { ok: true } }] }) }
}

test('verify accepts a genuine member pass', async () => {
  const res = mockRes()
  await verify({ method: 'POST', headers: auth(await makePass()) }, res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.valid, true)
  assert.ok(res.body.expiresAt > Date.now())
})

test('verify rejects every kind of bad pass', async () => {
  const cases = {
    missing: null,
    'wrong app': await makePass({ aud: 'navigator' }),
    'wrong issuer': await makePass({ iss: 'https://evil.example' }),
    'not a member': await makePass({ mbr: false }),
    expired: await makePass({ exp: 'past' }),
    'forged signature': await makePass({ key: other.privateKey }),
    garbage: 'not.a.pass',
  }
  for (const [name, p] of Object.entries(cases)) {
    const res = mockRes()
    await verify({ method: 'POST', headers: p ? auth(p) : {} }, res)
    assert.equal(res.statusCode, 401, name)
  }
  const res = mockRes()
  await verify({ method: 'POST', headers: auth(await makePass({ exp: 'past' })) }, res)
  assert.equal(res.body.reason, 'expired')
})

test('analyse refuses without a valid pass and never calls Claude', async () => {
  lastRequest = null
  const res = mockRes()
  await analyse({ method: 'POST', headers: auth(await makePass({ aud: 'tfo' })), body: { action: 'inventory', documents: docs } }, res)
  assert.equal(res.statusCode, 401)
  assert.equal(lastRequest, null)
})

test('analyse builds a fixed, structured request for a member', async () => {
  const res = mockRes()
  await analyse({ method: 'POST', headers: auth(await makePass()), body: { action: 'topic', topicId: 1, documents: docs, context: { goals: 'Retire at 62' }, model: 'something-else', max_tokens: 99999 } }, res)
  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body.result, { ok: true })
  const b = lastRequest.body
  assert.equal(b.model, 'claude-sonnet-5-5')
  assert.equal(b.max_tokens, 8000)
  assert.equal(b.tool_choice.name, 'record_topic_review')
  assert.equal(b.messages[0].content[0].cache_control.type, 'ephemeral')
  assert.match(b.messages[0].content[0].text, /Ongoing advice fee 0.75%/)
  assert.match(b.messages[0].content[0].text, /Retire at 62/)
  assert.match(b.messages[0].content[1].text, /Build a complete schedule of my costs/)
  assert.match(b.system[0].text, /untrusted data/)
  assert.equal(lastRequest.headers['x-api-key'], 'test-key')
})

test('analyse rejects bad input', async () => {
  const p = await makePass()
  for (const body of [
    { action: 'topic', topicId: 99, documents: docs },
    { action: 'inventory', documents: [] },
    { action: 'inventory', documents: [{ name: 'big', text: 'x'.repeat(300000) }] },
  ]) {
    const res = mockRes()
    await analyse({ method: 'POST', headers: auth(p), body }, res)
    assert.equal(res.statusCode, 400)
  }
})

test('every action builds', async () => {
  const p = await makePass()
  for (const [action, extra] of [['inventory', {}], ['agenda', { findings: [] }], ['followup', { adviserResponse: 'Thanks for your questions.', agenda: {} }]]) {
    const res = mockRes()
    await analyse({ method: 'POST', headers: auth(p), body: { action, documents: docs, ...extra } }, res)
    assert.equal(res.statusCode, 200, action)
  }
})

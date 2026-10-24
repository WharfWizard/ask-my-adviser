import React, { useEffect, useMemo, useRef, useState } from 'react'
import { TOPICS, MAX_TOPICS, MAX_TOTAL_CHARS, MAX_DOCS, OPENING_LINE, GUIDE_TITLE, GUIDE_DATE } from '../lib/guide.js'
import { extractFile, guessDate } from './extract.js'
import { redact, REDACTION_LABELS } from './redact.js'
import { startUnlock, receivePass, storedPass, myLifeUrl } from './mlr.js'

const STEPS = ['Begin', 'Documents', 'About you', 'Check', 'Review', 'Agenda', 'Follow-up']
const KIND_LABEL = {
  documented_fact: 'Documented fact',
  firm_claim: "Firm's claim",
  calculation: 'Calculation',
  inference: 'Inference',
  unknown: 'Unknown',
}
const STATUS_LABEL = {
  answered_with_evidence: ['Answered with evidence', 'ok'],
  partly_answered: ['Partly answered', 'warn'],
  unresolved: ['Unresolved', 'bad'],
}
const DOC_TYPES = [
  'Suitability report', 'Fact-find and objectives', 'Ongoing review report', 'Client agreement / service schedule',
  'Fee disclosure', 'Annual costs and charges statement', 'Product terms / KID / factsheet', 'Investment statement / transactions',
  'Performance report', 'Risk assessment', 'Email, letter or meeting note', 'Other',
]

let uid = 0
const newId = () => `d${Date.now().toString(36)}${(uid++).toString(36)}`

// Membership is off for launch (Ask My Adviser is open as a prospecting tool).
// Set VITE_REQUIRE_MEMBERSHIP=true (and REQUIRE_MEMBERSHIP=true) to turn on the My Life Record pass.
const GATED = import.meta.env.VITE_REQUIRE_MEMBERSHIP === 'true'

export default function App() {
  const [pass, setPass] = useState(null)
  const [signedIn, setSignedIn] = useState(!GATED)
  const [checking, setChecking] = useState(GATED)
  const [signInMessage, setSignInMessage] = useState('')

  const [step, setStep] = useState(0)
  const [reached, setReached] = useState(0)
  const [docs, setDocs] = useState([])
  const [extraTerms, setExtraTerms] = useState('')
  const [context, setContext] = useState({ goals: '', values: '', concerns: '' })
  const [inventory, setInventory] = useState({ status: 'idle' })
  const [selected, setSelected] = useState([])
  const [reviews, setReviews] = useState({})
  const [agenda, setAgenda] = useState({ status: 'idle' })
  const [followup, setFollowup] = useState({ status: 'idle', response: '' })

  const topRef = useRef(null)

  // On load: receive a pass returning from My Life Record, or re-check the one we hold
  useEffect(() => {
    if (!GATED) return
    const received = receivePass()
    if (received?.error) {
      setSignInMessage(received.error)
      setChecking(false)
      return
    }
    const candidate = received?.pass || storedPass.get()
    if (!candidate) {
      setChecking(false)
      return
    }
    verify(candidate).then((r) => {
      if (r.ok) {
        storedPass.set(candidate); setPass(candidate); setSignedIn(true)
      } else {
        storedPass.clear()
        setSignInMessage(r.reason === 'expired'
          ? 'Your membership pass has expired. Please continue through My Life Record to renew it.'
          : r.reason === 'network' ? 'We could not check your membership just now. Please try again.'
          : 'Your membership could not be confirmed. Please continue through My Life Record.')
      }
    }).finally(() => setChecking(false))
  }, [])

  // Warn before losing work
  useEffect(() => {
    const has = docs.length > 0
    const handler = (e) => { if (has) { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [docs.length])

  const terms = useMemo(() => extraTerms.split(/[,\n]/).map((t) => t.trim()).filter(Boolean), [extraTerms])
  const prepared = useMemo(() => docs.map((d) => {
    const r = d.edited != null ? { text: d.edited, counts: d.counts || {} } : redact(d.raw, terms)
    return { ...d, masked: r.text, counts: r.counts }
  }), [docs, terms])
  const totalChars = prepared.reduce((n, d) => n + d.masked.length, 0)
  const payloadDocs = prepared.filter((d) => d.masked.trim()).map((d) => ({ name: d.name, label: d.label, date: d.date, text: d.masked }))

  function go(n) {
    setStep(n)
    setReached((r) => Math.max(r, n))
    requestAnimationFrame(() => topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  async function verify(p) {
    try {
      const headers = { 'Content-Type': 'application/json' }
      if (p) headers.Authorization = `Bearer ${p}`
      const r = await fetch('/api/verify', { method: 'POST', headers })
      const data = await r.json().catch(() => ({}))
      return { ok: r.ok, reason: data.reason }
    } catch { return { ok: false, reason: 'network' } }
  }

  async function call(action, extra = {}) {
    const r = await fetch('/api/analyse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(pass ? { Authorization: `Bearer ${pass}` } : {}) },
      body: JSON.stringify({ action, documents: payloadDocs, context, ...extra }),
    })
    let data = {}
    try { data = await r.json() } catch { /* non-JSON error page */ }
    if (r.status === 401 && GATED) {
      storedPass.clear(); setPass(null); setSignedIn(false)
      setSignInMessage('Your membership pass needs renewing. Print or save anything you need first — continuing to My Life Record will clear this page.')
    }
    if (r.status === 413) throw new Error('The documents are too large to send together. Please remove some and work in smaller batches.')
    if (!r.ok) throw new Error((data.error || 'Something went wrong. Please try again.') + (data.detail ? `\n\nTechnical detail: ${data.detail}` : ''))
    return data
  }

  async function runInventory() {
    setInventory({ status: 'loading' })
    try {
      const data = await call('inventory')
      setInventory({ status: 'done', result: data.result })
      const suggested = (data.result.suggestedTopics || []).map((s) => s.topicId).filter((id) => TOPICS.some((t) => t.id === id))
      setSelected((cur) => (cur.length ? cur : suggested.slice(0, MAX_TOPICS)))
    } catch (e) {
      setInventory({ status: 'error', error: e.message })
    }
  }

  async function runTopic(id) {
    setReviews((r) => ({ ...r, [id]: { status: 'loading' } }))
    try {
      const data = await call('topic', { topicId: id })
      setReviews((r) => ({ ...r, [id]: { status: 'done', result: data.result, truncated: data.truncated } }))
    } catch (e) {
      setReviews((r) => ({ ...r, [id]: { status: 'error', error: e.message } }))
    }
  }

  async function runReviews() {
    go(4)
    for (const id of selected) {
      if (reviews[id]?.status === 'done') continue
      // one at a time keeps costs down: later calls reuse the cached documents
      // eslint-disable-next-line no-await-in-loop
      await runTopic(id)
    }
  }

  function findingsForAgenda() {
    return selected.filter((id) => reviews[id]?.status === 'done').map((id) => {
      const t = TOPICS.find((x) => x.id === id)
      const r = reviews[id].result
      return {
        topic: `${t.id}. ${t.title}`,
        explanation: r.explanation,
        keyFindings: (r.findings || []).slice(0, 12).map((f) => ({ finding: f.finding, kind: f.kind, source: [f.filename, f.documentDate, f.location].filter((x) => x && x !== 'none' && x !== 'not stated').join(', ') })),
        strongestCaseForService: r.strongestCaseForService,
        gaps: r.gaps,
        questions: r.questions,
        informationToRequest: r.informationToRequest,
      }
    })
  }

  async function runAgenda() {
    go(5)
    setAgenda({ status: 'loading' })
    try {
      const data = await call('agenda', { findings: findingsForAgenda() })
      setAgenda({ status: 'done', result: data.result })
    } catch (e) {
      setAgenda({ status: 'error', error: e.message })
    }
  }

  async function runFollowup(maskedResponse) {
    setFollowup((f) => ({ ...f, response: maskedResponse, status: 'loading', error: null }))
    try {
      const data = await call('followup', { findings: findingsForAgenda(), agenda: agenda.result, adviserResponse: maskedResponse })
      setFollowup((f) => ({ ...f, status: 'done', result: data.result }))
    } catch (e) {
      setFollowup((f) => ({ ...f, status: 'error', error: e.message }))
    }
  }

  function printSection(which) {
    document.body.dataset.print = which
    const done = () => { delete document.body.dataset.print; window.removeEventListener('afterprint', done) }
    window.addEventListener('afterprint', done)
    // open any collapsed sections so they print
    document.querySelectorAll('details.section').forEach((d) => { d.dataset.wasOpen = d.open; d.open = true })
    setTimeout(() => {
      window.print()
      document.querySelectorAll('details.section').forEach((d) => { d.open = d.dataset.wasOpen === 'true' })
    }, 50)
  }

  function signOut() {
    storedPass.clear()
    setPass(null)
    setSignedIn(false)
    setSignInMessage('')
  }

  function startAgain() {
    if (!window.confirm('Clear all documents and results and start again? Make sure you have printed or saved anything you need.')) return
    setDocs([]); setExtraTerms(''); setContext({ goals: '', values: '', concerns: '' })
    setInventory({ status: 'idle' }); setSelected([]); setReviews({}); setAgenda({ status: 'idle' })
    setFollowup({ status: 'idle', response: '' }); setReached(0); go(0)
  }

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <a className="brand" href="/">
            <img className="brand-mark" src="/favicon.svg" alt="" />
            <span>
              <span className="brand-name">Ask My Adviser</span><br />
              <span className="brand-sub">Academy of Life Planning</span>
            </span>
          </a>
          {signedIn && (docs.length > 0 || GATED) && (
            <span className="no-print top-links">
              {docs.length > 0 && <button className="link-btn" onClick={startAgain}>Start again</button>}
              {docs.length > 0 && GATED && <>&nbsp;&nbsp;·&nbsp;&nbsp;</>}
              {GATED && <button className="link-btn" onClick={signOut}>Sign out</button>}
            </span>
          )}
        </div>
      </header>

      <main ref={topRef}>
        {checking ? (
          <div className="status"><span className="spinner" /> Checking your membership…</div>
        ) : !signedIn ? (
          <SignIn message={signInMessage} hasWork={docs.length > 0} />
        ) : (
          <>
            <Stepper step={step} reached={reached} onGo={go} />

            {step === 0 && <Begin onNext={() => go(1)} />}

            {step === 1 && (
              <Documents
                docs={prepared}
                setDocs={setDocs}
                extraTerms={extraTerms}
                setExtraTerms={setExtraTerms}
                totalChars={totalChars}
                onBack={() => go(0)}
                onNext={() => go(2)}
              />
            )}

            {step === 2 && (
              <AboutYou context={context} setContext={setContext} onBack={() => go(1)} onNext={() => { go(3); if (inventory.status !== 'done') runInventory() }} />
            )}

            {step === 3 && (
              <Check
                inventory={inventory}
                retry={runInventory}
                selected={selected}
                setSelected={setSelected}
                onBack={() => go(2)}
                onNext={runReviews}
              />
            )}

            {step === 4 && (
              <div className="print-review">
                <Reviews
                  selected={selected}
                  reviews={reviews}
                  retry={runTopic}
                  onBack={() => go(3)}
                  onPrint={() => printSection('review')}
                  onNext={() => (agenda.status === 'done' ? go(5) : runAgenda())}
                />
              </div>
            )}

            {step === 5 && (
              <div className="print-agenda">
                <AgendaView
                  agenda={agenda}
                  setAgenda={setAgenda}
                  retry={runAgenda}
                  onBack={() => go(4)}
                  onPrint={() => printSection('agenda')}
                  onNext={() => go(6)}
                />
              </div>
            )}

            {step === 6 && (
              <FollowUp followup={followup} setFollowup={setFollowup} run={runFollowup} terms={terms} onBack={() => go(5)} />
            )}
          </>
        )}
      </main>

      <footer className="site-footer">
        <p>
          Based on <em>{GUIDE_TITLE}</em> by Steve Conley, Academy of Life Planning ({GUIDE_DATE}).
          This tool supports education and scrutiny. It does not give financial advice, determine suitability, legal liability or entitlement to redress.
          AI can make mistakes — check anything important before acting. <a href="/privacy">Privacy</a>
        </p>
      </footer>
    </>
  )
}

/* ---------------------------------------------------------------- */

function Stepper({ step, reached, onGo }) {
  return (
    <ol className="stepper no-print" aria-label="Progress">
      {STEPS.map((s, i) => (
        <li key={s} className={i === step ? 'current' : i < step || i <= reached ? 'done' : ''}>
          <button disabled={i > reached} onClick={() => onGo(i)} aria-current={i === step ? 'step' : undefined}>
            <span className="num">{i + 1}</span>{s}
          </button>
        </li>
      ))}
    </ol>
  )
}

function SignIn({ message, hasWork }) {
  const [going, setGoing] = useState(false)
  function go() {
    if (hasWork && !window.confirm('Continuing to My Life Record will clear your documents and results from this page. Continue?')) return
    setGoing(true)
    startUnlock()
  }
  return (
    <div className="narrow">
      <p className="eyebrow">Academy OS members' tool</p>
      <h1>Ask My Adviser</h1>
      <p className="lead">Understand what you pay. Test what you receive. Decide what you need.</p>
      <p>Your adviser may provide valuable expertise, reassurance and practical support. You are entitled to understand the price, the alternatives, the incentives and the limits of the protection you receive. This tool helps you read your own documents and prepare a fair, informed conversation.</p>
      <div className="card">
        <h3>Sign in with your My Life Record membership</h3>
        <p className="small muted">You'll go to My Life Record to confirm your membership, then come straight back. If you're already signed in there, it takes a moment. Ask My Adviser never sees your Google account or your My Life Record.</p>
        {message && <div className="note warn" role="alert"><p>{message}</p></div>}
        <button className="btn" onClick={go} disabled={going}>{going ? 'Opening My Life Record…' : 'Continue with My Life Record'}</button>
        <p className="small muted" style={{ marginTop: 14 }}>Not a member yet? Academy OS membership is available through <a href={myLifeUrl} target="_blank" rel="noreferrer">My Life Record</a>, or with a code from your planner.</p>
      </div>
      <p className="pullquote">Expertise should stand up to questions. A good relationship makes room for them.</p>
    </div>
  )
}

function Begin({ onNext }) {
  const [ok, setOk] = useState({ a: false, b: false, c: false })
  const all = ok.a && ok.b && ok.c
  return (
    <div className="narrow">
      <p className="eyebrow">Before you begin</p>
      <h1>A fairer conversation with your adviser</h1>
      <p className="lead">You do not need to become a financial expert to ask better questions of one.</p>
      <p>You will add your adviser's documents, tell us a little about what matters to you, choose up to three areas to look at, and finish with a one-page meeting agenda in your own words.</p>

      <div className="card">
        <h3>Useful documents to gather</h3>
        <ul className="clean small">
          <li>Suitability reports, fact-find and objectives</li>
          <li>Ongoing review reports</li>
          <li>Client agreement and service schedule</li>
          <li>Initial and ongoing fee disclosures, and annual costs-and-charges statements</li>
          <li>Product terms, key information documents and factsheets</li>
          <li>Investment statements, transaction history and performance reports</li>
          <li>Risk assessments, and relevant emails, letters and meeting notes</li>
        </ul>
        <p className="small muted">PDF, Word (.docx) and text files work. Scanned images cannot be read — you can type key details instead.</p>
      </div>

      <div className="card">
        <h3>How your documents are handled</h3>
        <ul className="clean small">
          <li>Your files are read <strong>in your own browser</strong>. National Insurance numbers, account and policy numbers, sort codes, card numbers, dates of birth, emails, phone numbers and postcodes are masked automatically, and you can add names to hide.</li>
          <li>You can check the masked text before anything is sent. Only that text is sent for analysis by Claude, an AI model from Anthropic.</li>
          <li>Nothing is stored by this app. Your work disappears when you close the tab, so print or save the results as a PDF.</li>
          <li>Upload only what is necessary. Never include passwords or access codes.</li>
        </ul>
      </div>

      <div className="card">
        <h3>Please confirm</h3>
        <label className="check"><input type="checkbox" checked={ok.a} onChange={(e) => setOk({ ...ok, a: e.target.checked })} /><span>I understand this is education to help me ask questions. It is not financial advice and does not decide what I should do.</span></label>
        <label className="check"><input type="checkbox" checked={ok.b} onChange={(e) => setOk({ ...ok, b: e.target.checked })} /><span>I understand AI can make mistakes. I will check important figures and claims, and will not cancel, transfer or surrender anything based only on these results.</span></label>
        <label className="check"><input type="checkbox" checked={ok.c} onChange={(e) => setOk({ ...ok, c: e.target.checked })} /><span>I will check the masked text and remove anything about other people that is not needed.</span></label>
      </div>

      <div className="actions">
        <button className="btn" disabled={!all} onClick={onNext}>Add my documents</button>
      </div>
    </div>
  )
}

function highlight(text) {
  const parts = text.split(/(\[REDACTED-[A-Z-]+\])/g)
  return parts.map((p, i) => (p.startsWith('[REDACTED-') ? <mark key={i}>{p}</mark> : p))
}

function Documents({ docs, setDocs, extraTerms, setExtraTerms, totalChars, onBack, onNext }) {
  const [over, setOver] = useState(false)
  const [busy, setBusy] = useState(0)
  const [open, setOpen] = useState(null)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [paste, setPaste] = useState({ name: '', text: '' })
  const inputRef = useRef(null)

  async function addFiles(fileList) {
    const files = Array.from(fileList || [])
    const room = MAX_DOCS - docs.length
    if (files.length > room) window.alert(`You can add up to ${MAX_DOCS} documents at a time. Only the first ${room} will be added.`)
    for (const file of files.slice(0, Math.max(room, 0))) {
      setBusy((b) => b + 1)
      try {
        const { text, pages, issues } = await extractFile(file)
        setDocs((d) => [...d, { id: newId(), name: file.name, label: '', date: guessDate(file.name), raw: text, pages, issues, edited: null }])
      } finally {
        setBusy((b) => b - 1)
      }
    }
  }

  function update(id, patch) { setDocs((d) => d.map((x) => (x.id === id ? { ...x, ...patch } : x))) }
  function remove(id) { setDocs((d) => d.filter((x) => x.id !== id)) }

  function addPaste() {
    if (!paste.text.trim()) return
    const name = paste.name.trim() || `Pasted text ${docs.length + 1}`
    setDocs((d) => [...d, { id: newId(), name, label: '', date: '', raw: paste.text.trim(), pages: 0, issues: [], edited: null }])
    setPaste({ name: '', text: '' }); setPasteOpen(false)
  }

  const pct = Math.min(100, Math.round((totalChars / MAX_TOTAL_CHARS) * 100))
  const tooBig = totalChars > MAX_TOTAL_CHARS
  const readable = docs.filter((d) => d.masked.trim()).length

  return (
    <div>
      <p className="eyebrow">Step 2</p>
      <h1>Add your documents</h1>
      <p className="lead">Use clearly dated filenames if you can, and keep your originals.</p>

      <div
        className={`drop ${over ? 'over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); addFiles(e.dataTransfer.files) }}
      >
        <p style={{ marginBottom: 12 }}><strong>Drag files here</strong> or</p>
        <div className="actions" style={{ justifyContent: 'center', marginTop: 0 }}>
          <button className="btn" onClick={() => inputRef.current?.click()}>Choose files</button>
          <button className="btn secondary" onClick={() => setPasteOpen((v) => !v)}>Paste text</button>
        </div>
        <input ref={inputRef} type="file" multiple accept=".pdf,.docx,.txt,.md,.csv,.eml,.html,.htm,application/pdf" onChange={(e) => { addFiles(e.target.files); e.target.value = '' }} />
        <p className="small muted" style={{ marginTop: 12, marginBottom: 0 }}>PDF, Word (.docx) or text. Files are read on this device.</p>
      </div>

      {pasteOpen && (
        <div className="card" style={{ marginTop: 16 }}>
          <label className="field"><span>Name for this text</span><input type="text" value={paste.name} placeholder="e.g. 2025-03 review email" onChange={(e) => setPaste({ ...paste, name: e.target.value })} /></label>
          <label className="field"><span>Text</span><textarea value={paste.text} onChange={(e) => setPaste({ ...paste, text: e.target.value })} style={{ minHeight: 160 }} /></label>
          <button className="btn" onClick={addPaste} disabled={!paste.text.trim()}>Add text</button>
        </div>
      )}

      {busy > 0 && <div className="status" style={{ margin: '16px 0' }}><span className="spinner" /> Reading {busy} file{busy > 1 ? 's' : ''}…</div>}

      {docs.length > 0 && (
        <div style={{ marginTop: 22 }}>
          <h2>Your documents ({docs.length})</h2>
          {docs.map((d) => {
            const maskedTotal = Object.values(d.counts).reduce((a, b) => a + b, 0)
            return (
              <div className="doc" key={d.id}>
                <div className="doc-head">
                  <div>
                    <div className="doc-name">{d.name}</div>
                    <div className="chips">
                      {d.pages > 0 && <span className="chip">{d.pages} page{d.pages > 1 ? 's' : ''}</span>}
                      {d.masked.trim() ? <span className="chip ok">{d.masked.length.toLocaleString()} characters</span> : <span className="chip bad">No readable text</span>}
                      {maskedTotal > 0 && <span className="chip warn">{maskedTotal} detail{maskedTotal > 1 ? 's' : ''} masked</span>}
                      {d.edited != null && <span className="chip">Edited by you</span>}
                    </div>
                  </div>
                  <div className="actions" style={{ marginTop: 0 }}>
                    {d.masked.trim() && <button className="btn small secondary" onClick={() => setOpen(open === d.id ? null : d.id)}>{open === d.id ? 'Hide text' : 'Check text'}</button>}
                    <button className="btn small secondary" onClick={() => remove(d.id)} aria-label={`Remove ${d.name}`}>Remove</button>
                  </div>
                </div>
                {d.issues?.map((iss) => <div className="note warn small" key={iss}><p>{iss}</p></div>)}
                <div className="doc-fields">
                  <label className="field" style={{ marginBottom: 0 }}>
                    <span className="sr-only">Document type</span>
                    <select value={d.label} onChange={(e) => update(d.id, { label: e.target.value })}>
                      <option value="">What is this document? (optional)</option>
                      {DOC_TYPES.map((t) => <option key={t}>{t}</option>)}
                    </select>
                  </label>
                  <label className="field" style={{ marginBottom: 0 }}>
                    <span className="sr-only">Document date</span>
                    <input type="date" value={d.date} onChange={(e) => update(d.id, { date: e.target.value })} title="Date of the document" />
                  </label>
                </div>
                {open === d.id && (
                  <div>
                    {maskedTotal > 0 && (
                      <p className="small muted" style={{ marginTop: 10, marginBottom: 0 }}>
                        Masked: {Object.entries(d.counts).map(([k, n]) => `${n} × ${k === 'CUSTOM' ? 'names you listed' : (REDACTION_LABELS[k] || k).toLowerCase()}`).join(', ')}.
                      </p>
                    )}
                    {d.edited == null ? (
                      <>
                        <div className="preview">{highlight(d.masked)}</div>
                        <button className="link-btn small" style={{ marginTop: 8 }} onClick={() => update(d.id, { edited: d.masked, counts: d.counts })}>Edit this text by hand</button>
                      </>
                    ) : (
                      <>
                        <textarea className="preview" style={{ width: '100%', minHeight: 300 }} value={d.edited} onChange={(e) => update(d.id, { edited: e.target.value })} />
                        <button className="link-btn small" onClick={() => update(d.id, { edited: null })}>Undo my edits</button>
                      </>
                    )}
                  </div>
                )}
              </div>
            )
          })}

          <div className="card tight">
            <label className="field" style={{ marginBottom: 6 }}>
              <span>Names and other words to hide</span>
              <small>Your name, your partner's or family members' names, your street or anything else personal. Separate with commas.</small>
              <input type="text" value={extraTerms} onChange={(e) => setExtraTerms(e.target.value)} placeholder="e.g. Jane Smith, Mill Lane" />
            </label>
            <p className="small muted" style={{ margin: 0 }}>Automatic masking is a safety net, not a guarantee. Please check each document's text.</p>
          </div>

          <div>
            <div className={`meter ${tooBig ? 'full' : ''}`}><div style={{ width: `${pct}%` }} /></div>
            <p className="small muted">{tooBig ? 'Too much text to review together. Remove some documents and work in batches.' : `${pct < 1 ? 'Less than 1%' : `${pct}%`} of the text that can be reviewed at once.`}</p>
          </div>
        </div>
      )}

      <div className="actions spread">
        <button className="btn secondary" onClick={onBack}>Back</button>
        <button className="btn" disabled={!readable || tooBig || busy > 0} onClick={onNext}>Next: about you</button>
      </div>
    </div>
  )
}

function AboutYou({ context, setContext, onBack, onNext }) {
  const set = (k) => (e) => setContext({ ...context, [k]: e.target.value })
  return (
    <div className="narrow">
      <p className="eyebrow">Step 3 · Plan life before money</p>
      <h1>What matters to you?</h1>
      <p className="lead">Good advice starts with your life, not your assets. A few sentences here help the review — and your agenda — begin in the right place.</p>
      <div className="card">
        <label className="field">
          <span>Your goals and what matters most</span>
          <small>For example: retire at 62, help the children with a deposit, what “enough” means to you.</small>
          <textarea value={context.goals} onChange={set('goals')} />
        </label>
        <label className="field">
          <span>What you value in the relationship with your adviser</span>
          <small>For example: reassurance during market falls, someone to handle the paperwork, a second opinion.</small>
          <textarea value={context.values} onChange={set('values')} />
        </label>
        <label className="field" style={{ marginBottom: 0 }}>
          <span>What prompted this review?</span>
          <small>For example: the fee rose after an inheritance, no review for two years, or simply wanting to understand.</small>
          <textarea value={context.concerns} onChange={set('concerns')} />
        </label>
      </div>
      <p className="small muted">All optional. Avoid health or other sensitive details unless they matter to your plan.</p>
      <div className="actions spread">
        <button className="btn secondary" onClick={onBack}>Back</button>
        <button className="btn" onClick={onNext}>Next: check my documents</button>
      </div>
    </div>
  )
}

function Loading({ children }) {
  return <div className="card"><div className="status" role="status"><span className="spinner" /> {children}</div></div>
}

function ErrorBox({ error, retry }) {
  return (
    <div className="note bad" role="alert">
      <p style={{ whiteSpace: 'pre-wrap' }}>{error}</p>
      {retry && <button className="btn small" onClick={retry}>Try again</button>}
    </div>
  )
}

function Check({ inventory, retry, selected, setSelected, onBack, onNext }) {
  const reasons = Object.fromEntries((inventory.result?.suggestedTopics || []).map((s) => [s.topicId, s.reason]))
  function toggle(id) {
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length < MAX_TOPICS ? [...cur, id] : cur))
  }
  return (
    <div>
      <p className="eyebrow">Step 4</p>
      <h1>What can be read — and what to look at</h1>

      {inventory.status === 'loading' && <Loading>Listing what can be read in your documents. This usually takes under a minute…</Loading>}
      {inventory.status === 'error' && <ErrorBox error={inventory.error} retry={retry} />}

      {inventory.status === 'done' && (
        <>
          <div className="card">
            <h2>Documents read</h2>
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>File</th><th>Type</th><th>Date</th><th>Readable</th><th>Issues</th></tr></thead>
                <tbody>
                  {inventory.result.documents.map((d, i) => (
                    <tr key={i}>
                      <td>{d.filename}</td><td>{d.documentType}</td><td>{d.date}</td>
                      <td><span className={`chip ${d.readable === 'fully' ? 'ok' : d.readable === 'partly' ? 'warn' : 'bad'}`}>{d.readable}</span></td>
                      <td className="small">{d.issues}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {inventory.result.missingInformation?.length > 0 && (
              <div className="note warn">
                <p><strong>Possibly missing</strong> — worth finding or requesting. An omission from your uploads does not prove something never happened.</p>
                <ul className="clean small">{inventory.result.missingInformation.map((m, i) => <li key={i}>{m}</li>)}</ul>
              </div>
            )}
          </div>

          <h2>Choose up to {MAX_TOPICS} areas</h2>
          <p className="muted">The guide suggests focusing on the three issues most relevant to you. Suggestions based on your documents are highlighted.</p>
          <div className="topics">
            {TOPICS.map((t) => {
              const on = selected.includes(t.id)
              return (
                <button key={t.id} className={`topic ${on ? 'selected' : ''}`} onClick={() => toggle(t.id)} disabled={!on && selected.length >= MAX_TOPICS} aria-pressed={on}>
                  <span className="t-num">{t.id <= 10 ? `QUESTION ${t.id}` : `FURTHER QUESTION ${t.id}`}{on ? ' · SELECTED' : ''}</span>
                  <span className="t-title">{t.title}</span>
                  <span className="t-sum">{t.summary}</span>
                  {reasons[t.id] && <span className="t-why">Suggested: {reasons[t.id]}</span>}
                </button>
              )
            })}
          </div>
        </>
      )}

      <div className="actions spread">
        <button className="btn secondary" onClick={onBack}>Back</button>
        <button className="btn" disabled={inventory.status !== 'done' || selected.length === 0} onClick={onNext}>
          Review {selected.length || ''} area{selected.length === 1 ? '' : 's'}
        </button>
      </div>
    </div>
  )
}

function Paragraphs({ text }) {
  return (text || '').split(/\n{2,}/).map((p, i) => <p key={i}>{p}</p>)
}

function Reviews({ selected, reviews, retry, onBack, onPrint, onNext }) {
  const anyDone = selected.some((id) => reviews[id]?.status === 'done')
  const busy = selected.some((id) => reviews[id]?.status === 'loading' || !reviews[id])
  return (
    <div>
      <p className="eyebrow">Step 5</p>
      <h1>Your review</h1>
      <p className="lead no-print">Each area is reviewed in turn — allow a minute or two for each. Findings are labelled so you can tell documented facts from claims, calculations and inferences.</p>

      {selected.map((id) => {
        const t = TOPICS.find((x) => x.id === id)
        const r = reviews[id]
        return (
          <section className="card" key={id}>
            <div className="review-head">
              <div>
                <p className="eyebrow">{t.id <= 10 ? `Question ${t.id}` : `Further question ${t.id}`}</p>
                <h2>{t.title}</h2>
              </div>
            </div>
            {(!r || r.status === 'loading') && <div className="status"><span className="spinner" /> {r ? 'Reviewing your documents…' : 'Waiting…'}</div>}
            {r?.status === 'error' && <ErrorBox error={r.error} retry={() => retry(id)} />}
            {r?.status === 'done' && <TopicResult result={r.result} truncated={r.truncated} />}
          </section>
        )
      })}

      <div className="actions spread">
        <button className="btn secondary" onClick={onBack}>Back</button>
        <span style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <button className="btn secondary" disabled={!anyDone} onClick={onPrint}>Print or save review</button>
          <button className="btn accent" disabled={!anyDone || busy} onClick={onNext}>Build my meeting agenda</button>
        </span>
      </div>
    </div>
  )
}

function TopicResult({ result, truncated }) {
  const r = result
  return (
    <div>
      {truncated && <div className="note warn small"><p>This review was cut short because it ran long. Try again with fewer documents for a complete answer.</p></div>}
      <Paragraphs text={r.explanation} />

      <h3>Questions you could send your adviser</h3>
      <ol className="questions">{(r.questions || []).map((q, i) => <li key={i}>{q}</li>)}</ol>

      <details className="section" open>
        <summary>Evidence ({(r.findings || []).length})</summary>
        <div>
          {(r.findings || []).map((f, i) => (
            <div className={`finding ${f.kind}`} key={i}>
              <span className={`kind ${f.kind}`}>{KIND_LABEL[f.kind] || f.kind}</span>{f.finding}
              {f.filename && f.filename !== 'none' && (
                <div className="src">{[f.filename, f.documentDate, f.location].filter((x) => x && x !== 'not stated').join(' · ')}</div>
              )}
              {f.extract && <blockquote>“{f.extract}”</blockquote>}
            </div>
          ))}
        </div>
      </details>

      {(r.calculations || []).length > 0 && (
        <details className="section">
          <summary>Calculations ({r.calculations.length})</summary>
          <div>
            {r.calculations.map((c, i) => (
              <div className="calc" key={i}>
                <strong>{c.description}</strong>
                <pre>{c.working}</pre>
                <div className="small"><strong>Result:</strong> {c.result}</div>
                <div className="small muted"><strong>Assumptions:</strong> {c.assumptions}</div>
              </div>
            ))}
            <p className="small muted">Illustrations, not predictions. Please check material figures yourself before relying on them.</p>
          </div>
        </details>
      )}

      <details className="section">
        <summary>The strongest case for the service — and its limits</summary>
        <div className="grid-2">
          <div><h3>Strongest fair case</h3><Paragraphs text={r.strongestCaseForService} /></div>
          <div><h3>Limitations</h3><Paragraphs text={r.limitations} /></div>
        </div>
      </details>

      <details className="section">
        <summary>Gaps and information to request</summary>
        <div className="grid-2">
          <div><h3>Gaps and uncertainties</h3><ul className="clean">{(r.gaps || []).map((g, i) => <li key={i}>{g}</li>)}</ul></div>
          <div><h3>Ask for before deciding</h3><ul className="clean">{(r.informationToRequest || []).map((g, i) => <li key={i}>{g}</li>)}</ul></div>
        </div>
      </details>
    </div>
  )
}

function EditableList({ items, onChange, placeholder }) {
  return (
    <div className="editable-list">
      {items.map((it, i) => (
        <div className="row" key={i}>
          <textarea value={it} onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))} />
          <button className="btn small secondary" onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label="Remove">✕</button>
        </div>
      ))}
      <button className="link-btn small" onClick={() => onChange([...items, ''])}>+ Add {placeholder}</button>
    </div>
  )
}

function AgendaView({ agenda, setAgenda, retry, onBack, onPrint, onNext }) {
  const [editing, setEditing] = useState(false)
  const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  if (agenda.status === 'loading') return <><p className="eyebrow">Step 6</p><h1>Your meeting agenda</h1><Loading>Turning your findings into a one-page agenda…</Loading></>
  if (agenda.status === 'error') return <><p className="eyebrow">Step 6</p><h1>Your meeting agenda</h1><ErrorBox error={agenda.error} retry={retry} /><div className="actions"><button className="btn secondary" onClick={onBack}>Back</button></div></>
  if (agenda.status !== 'done') return null

  const a = agenda.result
  const set = (patch) => setAgenda({ ...agenda, result: { ...a, ...patch } })

  return (
    <div>
      <div className="no-print">
        <p className="eyebrow">Step 6</p>
        <h1>Your meeting agenda</h1>
        <p className="lead">In your own voice, using neutral language. Edit anything that doesn't sound like you, then print or save it as a PDF to send ahead of your meeting.</p>
        <div className="actions" style={{ marginBottom: 18 }}>
          <button className="btn secondary" onClick={() => setEditing((v) => !v)}>{editing ? 'Done editing' : 'Edit agenda'}</button>
          <button className="btn" onClick={onPrint}>Print or save as PDF</button>
        </div>
      </div>

      <article className="agenda">
        <h2>Agenda for my review meeting</h2>
        <p className="muted small">Prepared {today}</p>
        <p className="opening">“{OPENING_LINE}”</p>

        <h3>My goals and what I value</h3>
        {editing ? <EditableList items={a.goalsAndValues} onChange={(v) => set({ goalsAndValues: v })} placeholder="goal" />
          : <ul className="clean">{a.goalsAndValues.map((g, i) => <li key={i}>{g}</li>)}</ul>}

        <h3>My three main questions</h3>
        {a.questions.map((q, i) => (
          <div className="agenda-q" key={i}>
            {editing ? (
              <>
                <label className="field"><span>Question {i + 1}</span><textarea value={q.question} onChange={(e) => set({ questions: a.questions.map((x, j) => (j === i ? { ...x, question: e.target.value } : x)) })} /></label>
                <label className="field"><span>Evidence or explanation I am requesting</span><textarea value={q.evidenceRequested} onChange={(e) => set({ questions: a.questions.map((x, j) => (j === i ? { ...x, evidenceRequested: e.target.value } : x)) })} /></label>
              </>
            ) : (
              <>
                <div className="q">{i + 1}. {q.question}</div>
                <div><strong>I am asking for:</strong> {q.evidenceRequested}</div>
                {q.documentReferences?.length > 0 && <div className="meta">Documents: {q.documentReferences.join('; ')}</div>}
              </>
            )}
          </div>
        ))}

        <h3>Decisions to consider</h3>
        {editing ? <EditableList items={a.decisionsToConsider} onChange={(v) => set({ decisionsToConsider: v })} placeholder="decision" />
          : <ul className="clean">{a.decisionsToConsider.map((g, i) => <li key={i}>{g}</li>)}</ul>}

        <h3>Information still needed</h3>
        {editing ? <EditableList items={a.informationStillNeeded} onChange={(v) => set({ informationStillNeeded: v })} placeholder="item" />
          : <ul className="clean">{a.informationStillNeeded.map((g, i) => <li key={i}>{g}</li>)}</ul>}

        <h3>Actions</h3>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Action</th><th>Who</th><th>By</th></tr></thead>
            <tbody>
              {a.actions.map((x, i) => (
                <tr key={i}>
                  {editing ? (
                    <>
                      <td><input type="text" value={x.action} onChange={(e) => set({ actions: a.actions.map((y, j) => (j === i ? { ...y, action: e.target.value } : y)) })} /></td>
                      <td><input type="text" value={x.owner} onChange={(e) => set({ actions: a.actions.map((y, j) => (j === i ? { ...y, owner: e.target.value } : y)) })} /></td>
                      <td><input type="text" value={x.by} onChange={(e) => set({ actions: a.actions.map((y, j) => (j === i ? { ...y, by: e.target.value } : y)) })} /></td>
                    </>
                  ) : (<><td>{x.action}</td><td>{x.owner}</td><td>{x.by}</td></>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p><strong>Review date:</strong> {editing ? <input type="text" value={a.reviewDate} onChange={(e) => set({ reviewDate: e.target.value })} /> : a.reviewDate}</p>

        <p className="footer-note">I have used an AI tool to organise my questions from my own documents. Please correct any errors and help me fill the evidence gaps. These are questions, not allegations.</p>
      </article>

      <div className="actions spread">
        <button className="btn secondary" onClick={onBack}>Back to review</button>
        <button className="btn secondary" onClick={onNext}>I have my adviser's reply</button>
      </div>
      <p className="pullquote no-print">The test is not whether your adviser can answer an AI. It is whether you can understand their answer and make a decision of your own.</p>
    </div>
  )
}

function FollowUp({ followup, setFollowup, run, terms, onBack }) {
  const [reading, setReading] = useState(false)
  const fileRef = useRef(null)
  async function addFile(file) {
    if (!file) return
    setReading(true)
    try {
      const { text, issues } = await extractFile(file)
      if (!text) { window.alert(issues[0] || 'No text could be read from that file.'); return }
      setFollowup((f) => ({ ...f, response: (f.response ? f.response + '\n\n' : '') + text }))
    } finally { setReading(false) }
  }
  const masked = useMemo(() => redact(followup.response, terms).text, [followup.response, terms])
  return (
    <div>
      <p className="eyebrow">Step 7</p>
      <h1>Your adviser's response</h1>
      <p className="lead">Add their reply and we'll check whether each question was answered with evidence, answered in part, or remains unresolved — and correct earlier conclusions if the reply warrants it.</p>
      <div className="card">
        <label className="field" htmlFor="reply">
          <span>Paste the reply</span>
        </label>
        <p className="small muted" style={{ marginTop: -10 }}>Or <button className="link-btn" onClick={() => fileRef.current?.click()}>upload it</button>. Personal details are masked before sending.</p>
        <input ref={fileRef} type="file" accept=".pdf,.docx,.txt,.md,.eml" style={{ display: 'none' }} onChange={(e) => { addFile(e.target.files?.[0]); e.target.value = '' }} />
        <textarea id="reply" value={followup.response} onChange={(e) => setFollowup((f) => ({ ...f, response: e.target.value }))} style={{ minHeight: 200, marginBottom: 16 }} />
        {reading && <div className="status"><span className="spinner" /> Reading file…</div>}
        <button className="btn" disabled={!followup.response.trim() || followup.status === 'loading'} onClick={() => run(masked)}>
          {followup.status === 'loading' ? 'Assessing…' : 'Assess the reply'}
        </button>
      </div>

      {followup.status === 'loading' && <Loading>Comparing the reply with your questions…</Loading>}
      {followup.status === 'error' && <ErrorBox error={followup.error} retry={() => run(masked)} />}
      {followup.status === 'done' && (
        <div className="card">
          <h2>Assessment</h2>
          <Paragraphs text={followup.result.overall} />
          {followup.result.assessments.map((x, i) => {
            const [label, tone] = STATUS_LABEL[x.status] || [x.status, '']
            return (
              <div className="finding" key={i} style={{ borderLeftColor: `var(--${tone === 'ok' ? 'ok' : tone === 'warn' ? 'orange' : 'bad'})` }}>
                <p style={{ marginBottom: 4 }}><span className={`chip ${tone}`}>{label}</span></p>
                <p style={{ marginBottom: 4 }}><strong>{x.question}</strong></p>
                <p className="small">{x.explanation}</p>
                {x.revisedConclusion && x.revisedConclusion.toLowerCase() !== 'no change' && <p className="small"><strong>Revised view:</strong> {x.revisedConclusion}</p>}
                <p className="small"><strong>Next step:</strong> {x.nextStep}</p>
              </div>
            )
          })}
          <p className="small muted">Agreement does not mean an answer is adequate, and disagreement does not mean it is wrong.</p>
        </div>
      )}

      <div className="actions">
        <button className="btn secondary" onClick={onBack}>Back to agenda</button>
      </div>
    </div>
  )
}

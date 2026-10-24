# Ask My Adviser

A members' tool from the **Academy of Life Planning**, built on the guide *Top Ten AI Prompts to Use on Your Financial Adviser* (Steve Conley, 24 October 2026).

**Understand what you pay. Test what you receive. Decide what you need.**

People add their adviser's documents, say what matters to them, choose up to three of the guide's fifteen questions, and receive:

1. A list of what could be read, with dates and likely missing documents
2. A review of each chosen area — plain-English explanation, evidence labelled as documented fact / firm's claim / calculation / inference / unknown with file, date, page and extract, calculations with working, the strongest fair case for the service, gaps, and three questions to send the adviser
3. A one-page meeting agenda in their own voice (editable, print or save as PDF)
4. An assessment of the adviser's reply: answered with evidence, partly answered, or unresolved

Education and scrutiny only — not financial advice.

## How privacy works

- PDFs (`pdfjs-dist`) and Word files (`mammoth`) are read **in the browser**. Files are never uploaded.
- `src/redact.js` masks NI numbers, account/policy/reference numbers, sort codes, card numbers, IBANs, dates of birth, emails, phone numbers and postcodes, plus any words the person lists. The person can check and edit the masked text.
- Only masked text goes to `/api/analyse`, which calls the Claude API. Nothing is stored or logged.
- The server builds every Claude request itself (model, system prompt, output schema, token limits). The browser cannot use the endpoint as an open proxy.

## Deploy on Vercel

1. In Vercel: **Add New → Project → Import** `WharfWizard/ask-my-adviser`. Framework preset: Vite (detected automatically).
2. **Settings → Environment Variables**:

| Variable | Required | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Claude API key |
| `CLAUDE_MODEL` | Optional | Defaults to `claude-sonnet-5-5` |
| `DAILY_ANALYSIS_LIMIT` | Optional | Soft per-member daily limit, default 30 |
| `MLR_JWKS_URL` | Optional | Defaults to `https://myliferecord.app/.well-known/jwks.json` |
| `MLR_JWKS` | Optional | My Life Record's key set as inline JSON, instead of fetching it |
| `VITE_MLR_URL` | Optional | My Life Record's address, defaults to `https://myliferecord.app` |
| `MEMBERSHIP_REQUIRED` | Testing only | `false` opens the app to anyone. Never set in production |

3. Redeploy after adding variables. Add a custom domain under **Settings → Domains**.
4. In My Life Record, add this site's address to `ASK_MY_ADVISER_ORIGINS` in `src/app/api/unlock/route.js`. My Life Record will not send passes anywhere else.

## Membership: the My Life Record pass

Ask My Adviser holds no accounts. Membership is confirmed by My Life Record:

1. **Continue with My Life Record** sends the person to
   `https://myliferecord.app/api/unlock?app=ask-my-adviser&return=<this site>/unlock&state=<random>`.
2. My Life Record checks their Google sign-in and Academy OS membership (a membership subscription or a redeemed planner code). If they aren't signed in or aren't a member yet, it handles that and brings them back afterwards.
3. It redirects to `/unlock?state=<same>#mlr_pass=<pass>`. The pass is a 7-day EdDSA-signed token (`iss` `https://myliferecord.app`, `aud` `ask-my-adviser`, `mbr: true`, and a `sub` that is unique to this app, so apps can't link a person across the ecosystem).
4. The browser checks `state` matches what it sent, clears the address bar, and keeps the pass for the session (`sessionStorage`). It never sees the person's Google account or My Life Record data.
5. Every call to `/api/analyse` carries the pass, and the server checks its signature against My Life Record's published key, plus issuer, audience, expiry and `mbr`.

## Costs and limits

- Each review is several Claude calls: one document check, one per chosen area (up to three), one agenda, and optionally one follow-up. The documents are marked for prompt caching so the later calls in a session reuse them at a lower cost.
- Up to 25 documents and 250,000 characters of text per session.
- `api/analyse.js` may run for up to 300 seconds (Vercel's current maximum on Hobby).
- The daily limit is held in memory, so it resets when Vercel starts a new instance. It slows misuse; it is not a hard cap. A durable limit would need a store such as Upstash.

## Develop

```bash
npm install
npm test          # masking and API tests
npm run build
npx vercel dev    # runs the front end and /api together (needs the variables above in .env.local)
```

## Known limits

- Scanned or photographed documents have no text layer and cannot be read; the app says so and suggests pasting key details.
- Claude cannot browse the web inside this tool. Regulatory points rely on the guide's UK reference notes (checked 24 October 2026) and are flagged for checking.
- Automatic masking is a safety net, not a guarantee.

---

*Academy of Life Planning · Total Wealth Planning™ · Plan life before money.*

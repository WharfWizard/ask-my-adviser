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
| `MEMBER_ACCESS_CODES` | One of these two | Comma-separated member codes, e.g. `AOLP-7Q2K, AOLP-M4ZD` |
| `MEMBERSHIP_VERIFY_URL` | One of these two | My Life Record endpoint (see below). Takes priority over the code list |
| `MEMBERSHIP_VERIFY_SECRET` | Optional | Sent as `Authorization: Bearer …` to the verify URL |
| `CLAUDE_MODEL` | Optional | Defaults to `claude-sonnet-5-5` |
| `DAILY_ANALYSIS_LIMIT` | Optional | Soft per-code daily limit, default 30 |
| `MEMBERSHIP_REQUIRED` | Testing only | `false` opens the app to anyone. Never set in production |

3. Redeploy after adding variables. Add a custom domain under **Settings → Domains** if wanted.

If neither membership variable is set, the app refuses all analyses rather than running open.

### Connecting to My Life Record membership

When My Life Record can confirm members, set `MEMBERSHIP_VERIFY_URL`. The app will send:

```
POST <MEMBERSHIP_VERIFY_URL>
Content-Type: application/json
Authorization: Bearer <MEMBERSHIP_VERIFY_SECRET>   (if set)

{ "code": "<what the member typed>", "app": "ask-my-adviser" }
```

and expects `{ "valid": true }` for a current member. Results are cached for 10 minutes per running instance.

## Costs and limits

- Each review is several Claude calls: one document check, one per chosen area (up to three), one agenda, and optionally one follow-up. The documents are marked for prompt caching so the later calls in a session reuse them at a lower cost.
- Up to 25 documents and 250,000 characters of text per session.
- `api/analyse.js` may run for up to 300 seconds (Vercel's current maximum on Hobby).
- The daily limit is held in memory, so it resets when Vercel starts a new instance. It slows misuse; it is not a hard cap. A durable limit would need a store such as Vercel KV/Upstash.

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

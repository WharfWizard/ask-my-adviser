// Masks personal identifiers in the browser before anything is sent.
// This is a safety net, not a guarantee — the person reviews the text too.

const RULES = [
  {
    type: 'NI-NUMBER',
    label: 'National Insurance numbers',
    re: /\b[A-Z]{2} ?\d{2} ?\d{2} ?\d{2} ?[A-D]\b/gi,
  },
  {
    type: 'IBAN',
    label: 'IBANs',
    re: /\bGB\d{2} ?[A-Z]{4}(?: ?\d{4}){3} ?\d{2}\b/gi,
  },
  {
    type: 'CARD',
    label: 'Card numbers',
    re: /\b(?:\d{4}[ -]?){3}\d{1,7}\b/g,
    test: (m) => m.replace(/\D/g, '').length >= 13,
  },
  {
    type: 'SORT-CODE',
    label: 'Sort codes',
    re: /(sort[\s-]*code\s*[:.\-]?\s*)(\d{2}[ -]?\d{2}[ -]?\d{2})/gi,
    group: 2,
  },
  {
    type: 'ACCOUNT-NO',
    label: 'Account, policy and reference numbers',
    re: /((?:account|acct|a\/c|policy|plan|client|customer|member(?:ship)?|reference|ref|contract|certificate|investor|portfolio|wrapper|isa|sipp|pension|scheme|bond)\s*(?:number|no\.?|num\.?|#|id|ref(?:erence)?)?\s*[:.\-#]?\s*)([A-Z0-9][A-Z0-9\-/]{4,24})\b/gi,
    group: 2,
    // At least five digits, and not a year or tax year such as 2025 or 2024/25.
    test: (m) => m.replace(/[^0-9]/g, '').length >= 5 && !/^(19|20)\d{2}([/-]\d{2,4})?$/.test(m),
  },
  {
    type: 'DATE-OF-BIRTH',
    label: 'Dates of birth',
    re: /((?:date\s+of\s+birth|d\.?o\.?b\.?|born)\s*[:.\-]?\s*)(\d{1,2}[ ./-](?:\d{1,2}|[A-Za-z]{3,9})[ ./-]\d{2,4})/gi,
    group: 2,
  },
  {
    type: 'EMAIL',
    label: 'Email addresses',
    re: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  },
  {
    type: 'PHONE',
    label: 'Phone numbers',
    re: /(?:\+44 ?\(?0?\)? ?|\b0)(?:\d[ -]?){9,10}\b/g,
  },
  {
    type: 'POSTCODE',
    label: 'Postcodes',
    re: /\b(?:GIR ?0AA|[A-PR-UWYZ][A-HK-Y]?\d[A-Z\d]? ?\d[ABD-HJLNP-UW-Z]{2})\b/g,
  },
]

export const REDACTION_LABELS = Object.fromEntries(RULES.map((r) => [r.type, r.label]))

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function redact(text, extraTerms = []) {
  const counts = {}
  let out = text

  for (const rule of RULES) {
    out = out.replace(rule.re, (...args) => {
      const match = args[0]
      const target = rule.group ? args[rule.group] : match
      if (!target || (rule.test && !rule.test(target))) return match
      counts[rule.type] = (counts[rule.type] || 0) + 1
      const masked = `[REDACTED-${rule.type}]`
      return rule.group ? match.slice(0, match.length - target.length) + masked : masked
    })
  }

  const terms = extraTerms.map((t) => t.trim()).filter((t) => t.length >= 2)
  for (const term of terms) {
    const re = new RegExp(`\\b${escapeRe(term)}\\b`, 'gi')
    out = out.replace(re, () => {
      counts.CUSTOM = (counts.CUSTOM || 0) + 1
      return '[REDACTED-NAME]'
    })
  }

  return { text: out, counts }
}

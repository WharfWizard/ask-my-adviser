// Reads documents inside the person's browser. Nothing is uploaded here.
import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

const TEXT_TYPES = /\.(txt|md|csv|eml|html?|json|rtf)$/i

export async function extractFile(file) {
  const name = file.name
  if (/\.pdf$/i.test(name) || file.type === 'application/pdf') return extractPdf(file)
  if (/\.docx$/i.test(name)) return extractDocx(file)
  if (/\.doc$/i.test(name)) {
    return { text: '', pages: 0, issues: ['Older .doc files cannot be read here. Please save it as .docx or PDF and add it again.'] }
  }
  if (TEXT_TYPES.test(name) || file.type.startsWith('text/')) {
    let text = await file.text()
    if (/\.html?$/i.test(name)) text = new DOMParser().parseFromString(text, 'text/html').body.innerText
    return { text: text.trim(), pages: 0, issues: [] }
  }
  if (file.type.startsWith('image/')) {
    return { text: '', pages: 0, issues: ['Photos and screenshots cannot be read here. Please add the original PDF, or type out the key details using “Paste text”.'] }
  }
  return { text: '', pages: 0, issues: ['This file type cannot be read here. Try PDF, Word (.docx) or a text file.'] }
}

async function extractPdf(file) {
  const data = new Uint8Array(await file.arrayBuffer())
  let pdf
  try {
    pdf = await pdfjsLib.getDocument({ data, isEvalSupported: false }).promise
  } catch (err) {
    const msg = err?.name === 'PasswordException'
      ? 'This PDF is password-protected. Please save an unprotected copy and add it again.'
      : 'This PDF could not be opened. It may be damaged.'
    return { text: '', pages: 0, issues: [msg] }
  }
  const parts = []
  const emptyPages = []
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p)
    const content = await page.getTextContent()
    let pageText = ''
    for (const item of content.items) {
      if (!('str' in item)) continue
      pageText += item.str + (item.hasEOL ? '\n' : ' ')
    }
    pageText = pageText.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
    if (pageText.replace(/\s/g, '').length < 25) emptyPages.push(p)
    parts.push(`[Page ${p}]\n${pageText}`)
  }
  const issues = []
  if (emptyPages.length === pdf.numPages) {
    issues.push('No text could be read. This looks like a scanned or photographed document. Try a digital copy from your adviser or provider, or paste the key details as text.')
  } else if (emptyPages.length) {
    issues.push(`Little or no text on page${emptyPages.length > 1 ? 's' : ''} ${emptyPages.join(', ')} — possibly scanned images or blank pages.`)
  }
  return { text: parts.join('\n\n'), pages: pdf.numPages, issues }
}

async function extractDocx(file) {
  try {
    const mammoth = (await import('mammoth')).default
    const { value } = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })
    return { text: value.trim(), pages: 0, issues: value.trim() ? [] : ['No text found in this Word document.'] }
  } catch {
    return { text: '', pages: 0, issues: ['This Word document could not be opened.'] }
  }
}

// Best-effort guess at the document date from its filename, e.g. 2025-03-14_review.pdf
export function guessDate(name) {
  const m = name.match(/(20\d{2})[-_.](\d{2})[-_.](\d{2})/) || name.match(/(\d{2})[-_.](\d{2})[-_.](20\d{2})/)
  if (!m) return ''
  return m[1].length === 4 ? `${m[1]}-${m[2]}-${m[3]}` : `${m[3]}-${m[2]}-${m[1]}`
}

import test from 'node:test'
import assert from 'node:assert/strict'
import { redact } from '../src/redact.js'

test('masks identifiers', () => {
  const input = [
    'NI number: QQ 12 34 56 C',
    'Sort code: 12-34-56 Account number: 12345678',
    'Policy No. AB1234567',
    'Date of birth: 14/03/1961',
    'Email jane.smith@example.co.uk or call 01234 567890 / +44 7700 900123',
    '1 High Street, Spilsby PE23 5AA',
    'Card 4111 1111 1111 1111',
    'IBAN GB29 NWBK 6016 1331 9268 19',
  ].join('\n')
  const { text, counts } = redact(input, ['Jane Smith'])
  for (const secret of ['QQ 12 34 56 C', '12-34-56', '12345678', 'AB1234567', '14/03/1961', 'jane.smith@example.co.uk', '01234 567890', '7700 900123', 'PE23 5AA', '4111 1111', 'NWBK']) {
    assert.ok(!text.includes(secret), `should hide ${secret}\n${text}`)
  }
  assert.ok(counts['NI-NUMBER'] && counts['SORT-CODE'] && counts['ACCOUNT-NO'] && counts.EMAIL && counts.PHONE && counts.POSTCODE)
})

test('keeps the figures the analysis needs', () => {
  const input = 'Ongoing advice fee 0.75% a year (£1,875.00). Pension 2025 review. ISA 2024/25 allowance £20,000. Portfolio value £250,000 on 31/03/2025. Fund ISIN GB00B3X7QG63, OCF 0.22%. Plan 2 of 3.'
  const { text } = redact(input)
  for (const keep of ['0.75%', '£1,875.00', 'Pension 2025', 'ISA 2024/25', '£20,000', '£250,000', '31/03/2025', '0.22%', 'Plan 2']) {
    assert.ok(text.includes(keep), `should keep ${keep}\n${text}`)
  }
})

test('masks extra terms the person adds', () => {
  const { text } = redact('Dear Mr Bloggs, regarding Joe Bloggs', ['Bloggs'])
  assert.ok(!text.includes('Bloggs'))
})

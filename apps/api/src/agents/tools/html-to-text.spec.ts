import { describe, it, expect } from 'vitest'
import { htmlToText } from './html-to-text'

describe('htmlToText', () => {
  const html = `
    <!doctype html>
    <html>
      <head><title>Docs</title><style>.x{color:red}</style></head>
      <body>
        <nav><a href="/">Home</a></nav>
        <script>window.analytics = 1; console.log('tracking')</script>
        <h1>Pricing &amp; Models</h1>
        <p>Sonnet costs &#36;3 per 1M &lt;input&gt; tokens.</p>
        <ul><li>Fast</li><li>Cheap</li></ul>
      </body>
    </html>`

  it('keeps visible text and drops markup, scripts and styles', () => {
    const out = htmlToText(html)
    expect(out).toContain('Pricing & Models')
    expect(out).toContain('Sonnet costs $3 per 1M <input> tokens.')
    expect(out).toContain('Fast')
    expect(out).toContain('Cheap')
    // no script/style leakage
    expect(out).not.toContain('analytics')
    expect(out).not.toContain('color:red')
    // no angle-bracket tags survive (the decoded <input> is fine, tags are not)
    expect(out).not.toMatch(/<\/?(h1|p|ul|li|script|style|nav|div)\b/i)
  })

  it('collapses whitespace and blank lines', () => {
    const out = htmlToText('<p>a</p>\n\n\n   <p>   b   c   </p>')
    expect(out).toBe('a\nb c')
  })

  it('decodes numeric and hex entities', () => {
    expect(htmlToText('<p>&#65;&#x42;&nbsp;C</p>')).toBe('AB C')
  })
})

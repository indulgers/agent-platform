/**
 * Dependency-free HTML → readable text. Not a full parser — a pragmatic cleaner
 * for feeding fetched web pages to an LLM: it drops scripts/styles/markup so the
 * model sees content instead of tokens of noise. Deterministic and pure.
 */
export function htmlToText(html: string): string {
  let s = html

  // Remove whole non-content elements (including their contents).
  s = s.replace(/<!--[\s\S]*?-->/g, ' ')
  s = s.replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1>/gi, ' ')
  s = s.replace(/<head\b[\s\S]*?<\/head>/gi, ' ')

  // Block-level boundaries → newlines so structure survives as line breaks.
  s = s.replace(/<\/(p|div|section|article|header|footer|li|ul|ol|tr|table|h[1-6]|blockquote|pre)>/gi, '\n')
  s = s.replace(/<(br|hr)\s*\/?>/gi, '\n')
  s = s.replace(/<li\b[^>]*>/gi, '\n- ')

  // Strip every remaining tag.
  s = s.replace(/<[^>]+>/g, ' ')

  // Decode the handful of entities that actually matter.
  s = decodeEntities(s)

  // Collapse whitespace: trim each line, drop blank runs.
  s = s
    .split('\n')
    .map(line => line.replace(/[ \t\f\v ]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')

  return s.trim()
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code: string) => safeFromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => safeFromCodePoint(parseInt(hex, 16)))
}

function safeFromCodePoint(code: number): string {
  try {
    return String.fromCodePoint(code)
  } catch {
    return ''
  }
}

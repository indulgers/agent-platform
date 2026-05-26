import { useEffect, useMemo, useRef } from 'react'
import { marked } from 'marked'
import hljs from 'highlight.js/lib/core'
import DOMPurify from 'dompurify'
import { cn } from '@/lib/utils'

/**
 * Lazy-register the languages we expect to see in agent output. Keeping the
 * bundle small — hljs's "common" build adds ~30 languages we don't need.
 */
import bash from 'highlight.js/lib/languages/bash'
import json from 'highlight.js/lib/languages/json'
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import python from 'highlight.js/lib/languages/python'
import sql from 'highlight.js/lib/languages/sql'
import yaml from 'highlight.js/lib/languages/yaml'
import xml from 'highlight.js/lib/languages/xml'
import css from 'highlight.js/lib/languages/css'
import markdown from 'highlight.js/lib/languages/markdown'
import diff from 'highlight.js/lib/languages/diff'
import go from 'highlight.js/lib/languages/go'
import rust from 'highlight.js/lib/languages/rust'
import dockerfile from 'highlight.js/lib/languages/dockerfile'
import 'highlight.js/styles/github-dark.css'

hljs.registerLanguage('bash', bash)
hljs.registerLanguage('sh', bash)
hljs.registerLanguage('shell', bash)
hljs.registerLanguage('json', json)
hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('js', javascript)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('ts', typescript)
hljs.registerLanguage('tsx', typescript)
hljs.registerLanguage('jsx', javascript)
hljs.registerLanguage('python', python)
hljs.registerLanguage('py', python)
hljs.registerLanguage('sql', sql)
hljs.registerLanguage('yaml', yaml)
hljs.registerLanguage('yml', yaml)
hljs.registerLanguage('xml', xml)
hljs.registerLanguage('html', xml)
hljs.registerLanguage('css', css)
hljs.registerLanguage('markdown', markdown)
hljs.registerLanguage('md', markdown)
hljs.registerLanguage('diff', diff)
hljs.registerLanguage('go', go)
hljs.registerLanguage('rust', rust)
hljs.registerLanguage('rs', rust)
hljs.registerLanguage('dockerfile', dockerfile)

// One shared marked instance with a custom code renderer that emits a wrapper
// with language label + copy button. We bind the copy handlers after injection.
const renderer = new marked.Renderer()
renderer.code = ({ text, lang }) => {
  const language = (lang ?? '').trim().toLowerCase()
  let highlighted: string
  if (language && hljs.getLanguage(language)) {
    try {
      highlighted = hljs.highlight(text, { language, ignoreIllegals: true }).value
    } catch {
      highlighted = escapeHtml(text)
    }
  } else {
    highlighted = escapeHtml(text)
  }
  const label = language || 'text'
  // data-copy-source carries the raw text so the copy button can grab it
  // without us walking the DOM and re-escaping.
  const encoded = encodeURIComponent(text)
  return `<div class="md-code"><div class="md-code__bar"><span class="md-code__lang">${escapeHtml(label)}</span><button type="button" class="md-code__copy" data-copy-source="${encoded}" aria-label="Copy code">Copy</button></div><pre><code class="hljs language-${escapeHtml(language)}">${highlighted}</code></pre></div>`
}
renderer.link = ({ href, title, text }) => {
  const safeHref = (href ?? '').trim()
  // Block javascript: and data: schemes; DOMPurify also catches these, this is belt+braces.
  if (/^javascript:|^data:/i.test(safeHref)) return escapeHtml(text)
  const titleAttr = title ? ` title="${escapeHtml(title)}"` : ''
  return `<a href="${escapeHtml(safeHref)}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`
}

marked.use({ renderer, gfm: true, breaks: false })

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  )
}

export interface MarkdownProps {
  /** Raw markdown text (typically streamed from the agent). */
  content: string
  className?: string
}

export function Markdown({ content, className }: MarkdownProps) {
  const ref = useRef<HTMLDivElement>(null)

  const html = useMemo(() => {
    const raw = marked.parse(content, { async: false }) as string
    return DOMPurify.sanitize(raw, {
      ADD_ATTR: ['target', 'rel', 'data-copy-source'],
    })
  }, [content])

  useEffect(() => {
    if (!ref.current) return
    const buttons = ref.current.querySelectorAll<HTMLButtonElement>('.md-code__copy')

    const handlers = new Map<HTMLButtonElement, (e: MouseEvent) => void>()
    buttons.forEach(btn => {
      const handler = async (e: MouseEvent) => {
        e.preventDefault()
        const src = btn.dataset.copySource
        if (!src) return
        try {
          await navigator.clipboard.writeText(decodeURIComponent(src))
          const prev = btn.textContent
          btn.textContent = 'Copied'
          btn.classList.add('md-code__copy--ok')
          setTimeout(() => {
            btn.textContent = prev
            btn.classList.remove('md-code__copy--ok')
          }, 1200)
        } catch {
          /* clipboard denied — fail quietly */
        }
      }
      handlers.set(btn, handler)
      btn.addEventListener('click', handler)
    })

    return () => {
      handlers.forEach((handler, btn) => btn.removeEventListener('click', handler))
    }
  }, [html])

  return (
    <div
      ref={ref}
      className={cn('md', className)}
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

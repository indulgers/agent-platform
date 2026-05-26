import { Fragment, useEffect, useMemo, useRef } from 'react'
import { marked } from 'marked'
import hljs from 'highlight.js/lib/core'
import DOMPurify from 'dompurify'
import { cn } from '@/lib/utils'
import { MermaidBlock } from '@/components/mermaid-block'

/**
 * Lazy-register the languages we expect to see in agent output. Keeps the
 * bundle smaller than hljs's "common" build.
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

const renderer = new marked.Renderer()
renderer.code = ({ text, lang }) => {
  // mermaid blocks are extracted upstream — if one slips through here it
  // means we missed it during splitting; render as a plain code block.
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
  const encoded = encodeURIComponent(text)
  return `<div class="md-code"><div class="md-code__bar"><span class="md-code__lang">${escapeHtml(label)}</span><button type="button" class="md-code__copy" data-copy-source="${encoded}" aria-label="Copy code">Copy</button></div><pre><code class="hljs language-${escapeHtml(language)}">${highlighted}</code></pre></div>`
}
renderer.link = ({ href, title, text }) => {
  const safeHref = (href ?? '').trim()
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

/**
 * Split the source content into ordered segments: plain markdown (rendered via
 * marked) and mermaid blocks (rendered via the lazy MermaidBlock component).
 *
 * We need this because mermaid wants to render its own SVG into a DOM node,
 * not into a string that DOMPurify would sanitize the structure out of.
 */
interface Segment {
  kind: 'md' | 'mermaid'
  content: string
}

function splitSegments(source: string): Segment[] {
  // Match ```mermaid ... ``` with non-greedy body, optionally newline-padded.
  const fence = /```mermaid[ \t]*\n([\s\S]*?)```/g
  const out: Segment[] = []
  let last = 0
  let m: RegExpExecArray | null
  while ((m = fence.exec(source)) !== null) {
    if (m.index > last) {
      out.push({ kind: 'md', content: source.slice(last, m.index) })
    }
    out.push({ kind: 'mermaid', content: m[1] ?? '' })
    last = m.index + m[0].length
  }
  if (last < source.length) out.push({ kind: 'md', content: source.slice(last) })
  if (out.length === 0) out.push({ kind: 'md', content: source })
  return out
}

export interface MarkdownProps {
  content: string
  className?: string
}

export function Markdown({ content, className }: MarkdownProps) {
  const segments = useMemo(() => splitSegments(content), [content])

  return (
    <div className={cn('md', className)}>
      {segments.map((seg, i) =>
        seg.kind === 'mermaid' ? (
          <MermaidBlock key={`m-${i}`} source={seg.content} />
        ) : (
          <MarkdownChunk key={`t-${i}`} source={seg.content} />
        ),
      )}
    </div>
  )
}

function MarkdownChunk({ source }: { source: string }) {
  const ref = useRef<HTMLDivElement>(null)

  const html = useMemo(() => {
    const raw = marked.parse(source, { async: false }) as string
    return DOMPurify.sanitize(raw, {
      ADD_ATTR: ['target', 'rel', 'data-copy-source'],
    })
  }, [source])

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
          /* clipboard denied */
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
    <Fragment>
      <div
        ref={ref}
        className="md-chunk"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </Fragment>
  )
}

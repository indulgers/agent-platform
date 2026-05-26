import { useEffect, useState } from 'react'

/**
 * Dynamically imports mermaid the first time a block is mounted and renders
 * the diagram into inline SVG. Lazy because mermaid + its diagram backends
 * are ~140KB gzipped per chunk — we don't want them in the main bundle.
 *
 * The SVG is stored in state and inserted via dangerouslySetInnerHTML, so a
 * single element renders the SVG once it's available without needing a ref
 * (avoiding the "ref unmounted while in loading state" timing bug).
 */

let initPromise: Promise<typeof import('mermaid').default> | null = null

function loadMermaid(): Promise<typeof import('mermaid').default> {
  if (initPromise) return initPromise
  initPromise = import('mermaid').then(mod => {
    const mermaid = mod.default
    const isLight = document.documentElement.getAttribute('data-theme') === 'light'
    mermaid.initialize({
      startOnLoad: false,
      theme: isLight ? 'default' : 'dark',
      securityLevel: 'strict',
      fontFamily: "'Inter', system-ui, sans-serif",
    })
    return mermaid
  })
  return initPromise
}

let renderCounter = 0

export function MermaidBlock({ source }: { source: string }) {
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string>('')

  useEffect(() => {
    let cancelled = false
    setSvg(null)
    setError('')

    if (!source.trim()) {
      setError('Empty mermaid block')
      return
    }

    ;(async () => {
      try {
        const mermaid = await loadMermaid()
        if (cancelled) return
        const id = `mmd-${++renderCounter}`
        const { svg } = await mermaid.render(id, source)
        if (cancelled) return
        setSvg(svg)
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
      }
    })()

    return () => {
      cancelled = true
    }
  }, [source])

  if (error) {
    return (
      <div className="my-3 border border-[color:color-mix(in_oklab,var(--color-danger)_40%,var(--color-hairline))] bg-[color:color-mix(in_oklab,var(--color-danger)_8%,var(--color-surface-1))] rounded-md overflow-hidden text-xs">
        <div className="px-3 py-1.5 border-b border-[color:var(--color-hairline)] font-mono text-[11px] text-[color:var(--color-danger)]">
          mermaid · render error
        </div>
        <div className="px-3 py-2 text-[color:var(--color-text-secondary)] whitespace-pre-wrap font-mono">{error}</div>
        <pre className="m-0 px-3 py-2 border-t border-[color:var(--color-hairline)] bg-[color:var(--color-surface-2)] overflow-x-auto text-[12px] leading-[1.5]">
          {source}
        </pre>
      </div>
    )
  }

  return (
    <div className="my-3 rounded-md border border-[color:var(--color-hairline)] bg-[color:var(--color-surface-2)] p-4 overflow-x-auto flex justify-center items-center min-h-[80px]">
      {svg ? (
        <div
          className="mermaid-svg w-full flex justify-center"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <div className="text-xs text-muted-foreground font-mono">rendering diagram…</div>
      )}
    </div>
  )
}

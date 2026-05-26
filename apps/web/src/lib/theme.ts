/**
 * Theme runtime for the SPA — mirrored from apps/landing/src/lib/theme.ts so the
 * two surfaces share the same localStorage key. Pick light on landing, log into
 * the app, stay in light.
 *
 * Default = dark (brand identity). prefers-color-scheme is intentionally
 * ignored — the inline <html data-theme="dark"> wins until the user explicitly
 * toggles, matching the landing behaviour.
 */

const THEME_KEY = 'agent-platform/theme'

export type Theme = 'dark' | 'light'

function urlOverride(): Theme | null {
  const v = new URLSearchParams(location.search).get('theme')
  return v === 'dark' || v === 'light' ? v : null
}

function detectTheme(): Theme {
  const override = urlOverride()
  if (override) return override
  const stored = localStorage.getItem(THEME_KEY) as Theme | null
  return stored === 'light' ? 'light' : 'dark'
}

export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme)
  localStorage.setItem(THEME_KEY, theme)
  // Notify any listeners (e.g. canvas backgrounds that switch palette)
  document.dispatchEvent(new CustomEvent('agent-platform/theme-change', { detail: theme }))
}

export function getTheme(): Theme {
  return (document.documentElement.getAttribute('data-theme') as Theme) ?? 'dark'
}

export function toggleTheme(): Theme {
  const next: Theme = getTheme() === 'light' ? 'dark' : 'light'
  applyTheme(next)
  return next
}

export function initTheme(): void {
  applyTheme(detectTheme())
}

/** React hook — exported here so callers don't have to wire the listener themselves. */
import { useEffect, useState } from 'react'

export function useTheme(): { theme: Theme; toggle: () => void } {
  const [theme, setTheme] = useState<Theme>(() => getTheme())
  useEffect(() => {
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<Theme>).detail
      if (detail === 'dark' || detail === 'light') setTheme(detail)
    }
    document.addEventListener('agent-platform/theme-change', onChange)
    return () => document.removeEventListener('agent-platform/theme-change', onChange)
  }, [])
  return { theme, toggle: () => toggleTheme() }
}

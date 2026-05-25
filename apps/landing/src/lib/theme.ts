/**
 * Theme + language runtime. Tiny on purpose — no framework, no hydration cost.
 *
 * Theme: `data-theme="dark"|"light"` on <html>. Default = dark.
 * Language: `data-lang="en"|"zh"` on <html>; CSS hides the opposite language block.
 *
 * Both prefs are mirrored to localStorage so they survive a refresh.
 */

const THEME_KEY = 'agent-platform/theme'
const LANG_KEY = 'agent-platform/lang'

export type Theme = 'dark' | 'light'
export type Lang = 'en' | 'zh'

function urlOverride<T extends string>(key: string, allowed: readonly T[]): T | null {
  const v = new URLSearchParams(location.search).get(key)
  return v && (allowed as readonly string[]).includes(v) ? (v as T) : null
}

function detectLang(): Lang {
  const override = urlOverride<Lang>('lang', ['en', 'zh'] as const)
  if (override) return override
  const stored = localStorage.getItem(LANG_KEY) as Lang | null
  if (stored === 'en' || stored === 'zh') return stored
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

function detectTheme(): Theme {
  // Dark is the brand identity — only honour an explicit, stored user choice
  // or a URL override. Inline <html data-theme="dark"> sets the default before
  // this script runs, so we never auto-flip on prefers-color-scheme.
  const override = urlOverride<Theme>('theme', ['dark', 'light'] as const)
  if (override) return override
  const stored = localStorage.getItem(THEME_KEY) as Theme | null
  return stored === 'light' ? 'light' : 'dark'
}

export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme)
  localStorage.setItem(THEME_KEY, theme)
  const btn = document.querySelector<HTMLButtonElement>('[data-toggle-theme]')
  if (btn) {
    btn.setAttribute('aria-pressed', String(theme === 'light'))
    btn.dataset.theme = theme
  }
}

export function applyLang(lang: Lang): void {
  document.documentElement.setAttribute('data-lang', lang)
  document.documentElement.setAttribute('lang', lang === 'zh' ? 'zh-CN' : 'en')
  localStorage.setItem(LANG_KEY, lang)
  document
    .querySelectorAll<HTMLButtonElement>('[data-set-lang]')
    .forEach(b => b.setAttribute('aria-pressed', String(b.dataset.setLang === lang)))
}

export function initThemeAndLang(): void {
  applyTheme(detectTheme())
  applyLang(detectLang())

  document.querySelector('[data-toggle-theme]')?.addEventListener('click', () => {
    const next: Theme = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light'
    applyTheme(next)
  })

  document.querySelectorAll<HTMLButtonElement>('[data-set-lang]').forEach(btn =>
    btn.addEventListener('click', () => {
      applyLang(btn.dataset.setLang as Lang)
    }),
  )
}

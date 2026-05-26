import { createRootRoute, Link, Outlet } from '@tanstack/react-router'
import { Moon, Sun } from 'lucide-react'
import { useAuthStore } from '@/stores/auth-store'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Kbd } from '@/components/ui/kbd'
import { useTheme } from '@/lib/theme'

function RootLayout() {
  const user = useAuthStore(s => s.user)
  const clear = useAuthStore(s => s.clear)
  const { theme, toggle } = useTheme()

  return (
    <div className="h-screen overflow-hidden flex flex-col bg-background">
      <header className="sticky top-0 z-50 h-14 border-b border-border bg-background/80 backdrop-blur-md backdrop-saturate-150">
        <div className="h-full px-4 flex items-center justify-between gap-4">
          <Link to="/" className="flex items-center gap-2 text-[14px] font-semibold tracking-[-0.011em]">
            <span
              aria-hidden="true"
              className="w-5 h-5 rounded-md grid place-items-center shadow-sm"
              style={{
                background:
                  'linear-gradient(135deg, var(--color-accent) 0%, color-mix(in oklab, var(--color-accent) 50%, #fff) 100%)',
              }}
            >
              <span className="w-2 h-2 rounded-[2px] bg-background opacity-85" />
            </span>
            <span>agent-platform</span>
            <Badge tone="accent" dot className="ml-1.5">
              dev
            </Badge>
          </Link>

          <div className="flex items-center gap-2 text-[13px]">
            <button
              type="button"
              onClick={toggle}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-[color:var(--color-surface-2)] border border-transparent hover:border-border transition-colors"
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
              title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            >
              {theme === 'dark' ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
            </button>

            {user ? (
              <>
                <span className="text-muted-foreground font-mono text-[12.5px]">{user.email}</span>
                <Kbd>⌘K</Kbd>
                <Button size="sm" variant="ghost" onClick={clear}>
                  Sign out
                </Button>
              </>
            ) : (
              <>
                <Button size="sm" variant="ghost" asChild>
                  <Link to="/login">Login</Link>
                </Button>
                <Button size="sm" asChild>
                  <Link to="/register">Register</Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </header>
      <main className="flex-1 flex flex-col min-h-0">
        <Outlet />
      </main>
    </div>
  )
}

export const Route = createRootRoute({ component: RootLayout })

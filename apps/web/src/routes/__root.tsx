import { createRootRoute, Link, Outlet } from '@tanstack/react-router'
import { useAuthStore } from '@/stores/auth-store'
import { Button } from '@/components/ui/button'

function RootLayout() {
  const user = useAuthStore(s => s.user)
  const clear = useAuthStore(s => s.clear)

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b px-4 py-3 flex items-center justify-between">
        <Link to="/" className="font-semibold text-sm tracking-tight">
          agent-platform
        </Link>
        <div className="flex items-center gap-2 text-sm">
          {user ? (
            <>
              <span className="text-muted-foreground">{user.email}</span>
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
      </header>
      <main className="flex-1 flex flex-col">
        <Outlet />
      </main>
    </div>
  )
}

export const Route = createRootRoute({ component: RootLayout })

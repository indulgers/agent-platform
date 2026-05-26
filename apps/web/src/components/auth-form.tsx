import { useState, type FormEvent } from 'react'
import { useNavigate, Link } from '@tanstack/react-router'
import { api, ApiError } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Kbd } from '@/components/ui/kbd'
import { NetworkSphere } from '@/components/network-sphere'
import { useAuthStore } from '@/stores/auth-store'
import type { AuthTokenResponse } from '@agent-platform/shared'

export function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  const setAuth = useAuthStore(s => s.setAuth)
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const res = await api<AuthTokenResponse>(`/auth/${mode}`, {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      })
      setAuth(res.accessToken, res.user)
      navigate({ to: '/' })
    } catch (err) {
      if (err instanceof ApiError) {
        const body = err.body as { message?: string | string[] } | undefined
        const msg = Array.isArray(body?.message) ? body!.message.join(', ') : body?.message
        setError(msg ?? err.message)
      } else {
        setError(err instanceof Error ? err.message : String(err))
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_440px] min-h-[calc(100vh-3.5rem)]">
      {/* hero pane — quiet, illustrative, with a slowly-rotating node sphere */}
      <aside
        className="hidden lg:flex flex-col justify-between p-10 border-r border-border relative overflow-hidden"
        style={{
          background:
            'radial-gradient(60% 50% at 20% 20%, color-mix(in oklab, var(--color-accent) 15%, transparent) 0%, transparent 60%), var(--color-surface-1)',
        }}
      >
        {/* 3D-projected network of nodes. Sits behind the copy at z-index 0,
           foreground text uses pointer-events-none so the sphere is still
           interactive (move the mouse to tilt it). */}
        <div className="absolute inset-0 z-0">
          <NetworkSphere />
        </div>

        {/* Soft vignette so the corner copy stays readable over busier nodes */}
        <div
          aria-hidden="true"
          className="absolute inset-0 z-[1] pointer-events-none"
          style={{
            background:
              'radial-gradient(120% 80% at 30% 80%, color-mix(in oklab, var(--color-surface-1) 80%, transparent) 0%, transparent 55%), radial-gradient(120% 80% at 0% 0%, color-mix(in oklab, var(--color-surface-1) 70%, transparent) 0%, transparent 50%)',
          }}
        />

        <div className="relative z-[2] flex items-center gap-2 font-semibold text-sm tracking-[-0.011em] pointer-events-none">
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
        </div>

        <div className="relative z-[2] space-y-4 max-w-[36ch] pointer-events-none">
          <p
            className="font-display text-[26px] leading-[1.2] tracking-[-0.02em] text-foreground"
            style={{ fontFamily: "'Inter Tight', sans-serif" }}
          >
            {mode === 'login' ? 'Welcome back. The agent is ready when you are.' : 'Spin up your own agent. In two minutes.'}
          </p>
          <p className="text-sm text-muted-foreground leading-[1.55]">
            {mode === 'login'
              ? 'Pick up the conversation right where you left off — tools, memory, and history are persisted server-side.'
              : 'No SaaS lock-in. Bring your own keys, plug in your own tools, ship behind a single docker compose up.'}
          </p>
        </div>

        <div className="relative z-[2] flex items-center gap-2 text-[11px] font-mono text-muted-foreground tracking-[0.04em] pointer-events-none">
          <span>v0.1</span>
          <span>·</span>
          <span>self-hosted</span>
          <span>·</span>
          <span>MIT-style</span>
        </div>
      </aside>

      {/* form pane */}
      <section className="flex items-center justify-center px-6 py-12">
        <form onSubmit={submit} className="w-full max-w-[360px] space-y-5">
          <div className="space-y-1">
            <h1 className="text-[22px] font-semibold tracking-[-0.011em]">
              {mode === 'login' ? 'Sign in' : 'Create your account'}
            </h1>
            <p className="text-sm text-muted-foreground">
              {mode === 'login' ? (
                <>
                  No account?{' '}
                  <Link to="/register" className="text-foreground underline-offset-2 hover:underline">
                    Register →
                  </Link>
                </>
              ) : (
                <>
                  Already have one?{' '}
                  <Link to="/login" className="text-foreground underline-offset-2 hover:underline">
                    Sign in →
                  </Link>
                </>
              )}
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-[12.5px] font-medium text-muted-foreground">Email</label>
            <Input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoComplete="email"
              placeholder="you@example.com"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[12.5px] font-medium text-muted-foreground">Password</label>
              {mode === 'register' && (
                <span className="text-[11px] font-mono text-muted-foreground">min 8 chars</span>
              )}
            </div>
            <Input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              minLength={mode === 'register' ? 8 : 1}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              placeholder="••••••••"
            />
          </div>

          {error && (
            <div className="text-sm text-[color:var(--color-danger)] bg-[color:color-mix(in_oklab,var(--color-danger)_8%,var(--color-surface-1))] border border-[color:color-mix(in_oklab,var(--color-danger)_30%,var(--color-hairline))] rounded-md px-3 py-2">
              {error}
            </div>
          )}

          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? '…' : mode === 'login' ? 'Sign in' : 'Create account'}
            <Kbd className="ml-2 bg-white/15 border-white/25 text-white">↵</Kbd>
          </Button>
        </form>
      </section>
    </div>
  )
}

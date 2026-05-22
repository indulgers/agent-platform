import { useState, type FormEvent } from 'react'
import { useNavigate, Link } from '@tanstack/react-router'
import { api, ApiError } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
    <form onSubmit={submit} className="max-w-sm w-full mx-auto p-6 space-y-4 mt-12">
      <h1 className="text-xl font-semibold">{mode === 'login' ? 'Sign in' : 'Create account'}</h1>
      <div className="space-y-2">
        <label className="text-sm font-medium">Email</label>
        <Input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" />
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium">Password</label>
        <Input
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          required
          minLength={mode === 'register' ? 8 : 1}
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={submitting} className="w-full">
        {submitting ? '…' : mode === 'login' ? 'Sign in' : 'Create account'}
      </Button>
      <p className="text-sm text-muted-foreground text-center">
        {mode === 'login' ? (
          <>
            No account?{' '}
            <Link to="/register" className="underline">
              Register
            </Link>
          </>
        ) : (
          <>
            Have an account?{' '}
            <Link to="/login" className="underline">
              Sign in
            </Link>
          </>
        )}
      </p>
    </form>
  )
}

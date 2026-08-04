import { createFileRoute, redirect, Outlet, useParams } from '@tanstack/react-router'
import { useAuthStore } from '@/stores/auth-store'
import { RunList } from '@/components/runs/run-list'

export const Route = createFileRoute('/runs')({
  beforeLoad: () => {
    if (!useAuthStore.getState().token) throw redirect({ to: '/login' })
  },
  component: RunsLayout,
})

function RunsLayout() {
  // Non-strict so the layout resolves the active run id when a child route has one.
  const params = useParams({ strict: false }) as { id?: string }
  return (
    <div className="flex-1 flex min-h-0">
      <RunList activeId={params.id} />
      <Outlet />
    </div>
  )
}

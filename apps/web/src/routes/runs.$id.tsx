import { createFileRoute } from '@tanstack/react-router'
import { RunDetail } from '@/components/runs/run-detail'

export const Route = createFileRoute('/runs/$id')({
  component: RunDetailPage,
})

function RunDetailPage() {
  const { id } = Route.useParams()
  return <RunDetail runId={id} />
}

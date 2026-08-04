import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/runs/')({
  component: RunsEmpty,
})

function RunsEmpty() {
  return (
    <div className="flex-1 grid place-items-center text-sm text-muted-foreground">
      Select a run, or launch a new one.
    </div>
  )
}

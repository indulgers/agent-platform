import { Sparkles, Globe, Database, Workflow } from 'lucide-react'

interface Suggestion {
  icon: typeof Globe
  label: string
  prompt: string
}

const SUGGESTIONS: Suggestion[] = [
  {
    icon: Globe,
    label: 'Summarise a webpage',
    prompt: 'Fetch https://en.wikipedia.org/wiki/Bourne_shell and give me a 3-bullet summary.',
  },
  {
    icon: Database,
    label: 'Recall a past memory',
    prompt: 'What have I told you previously about my project priorities?',
  },
  {
    icon: Workflow,
    label: 'Multi-step plan',
    prompt: 'Help me plan a weekend hack: research a topic, draft an outline, list 3 risks.',
  },
  {
    icon: Sparkles,
    label: 'Markdown table demo',
    prompt: 'Show me a markdown table comparing OpenAI, Anthropic, and DeepSeek by context window, pricing, and tool-calling support.',
  },
]

export function Welcome({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <div className="flex-1 flex items-center justify-center px-6 py-12">
      <div className="max-w-xl w-full space-y-6">
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="w-9 h-9 rounded-lg grid place-items-center shadow-sm"
            style={{
              background:
                'linear-gradient(135deg, var(--color-accent) 0%, color-mix(in oklab, var(--color-accent) 50%, #fff) 100%)',
            }}
          >
            <span className="w-3.5 h-3.5 rounded-[3px] bg-background opacity-85" />
          </span>
          <div>
            <h2 className="text-[20px] font-semibold tracking-[-0.011em]">Ask the agent</h2>
            <p className="text-sm text-muted-foreground">
              It can fetch URLs, search your memory, and chain tools. Try one of these or type your own.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {SUGGESTIONS.map(s => {
            const Icon = s.icon
            return (
              <button
                key={s.label}
                onClick={() => onPick(s.prompt)}
                className="group text-left p-3 rounded-lg border border-border bg-[color:var(--color-surface-1)] hover:border-[color:var(--color-hairline-strong)] hover:bg-[color:var(--color-surface-2)] transition-colors"
              >
                <div className="flex items-center gap-2 mb-1">
                  <Icon className="w-3.5 h-3.5 text-[color:var(--color-accent)]" />
                  <span className="text-[13px] font-medium">{s.label}</span>
                </div>
                <div className="text-[12px] text-muted-foreground line-clamp-2 leading-[1.45]">{s.prompt}</div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

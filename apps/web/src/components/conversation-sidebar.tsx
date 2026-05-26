import { useMemo, useState, type KeyboardEvent } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { Plus, MessageSquare, MoreHorizontal, Pencil, Trash2, Search, X } from 'lucide-react'
import {
  useConversations,
  useCreateConversation,
  useDeleteConversation,
  useRenameConversation,
  type ConversationRow,
} from '@/lib/conversations'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Kbd } from '@/components/ui/kbd'
import { cn } from '@/lib/utils'

export function ConversationSidebar({ activeId }: { activeId?: string }) {
  const navigate = useNavigate()
  const { data: conversations = [], isLoading } = useConversations()
  const create = useCreateConversation()
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return conversations
    return conversations.filter(c => c.title.toLowerCase().includes(q))
  }, [conversations, query])

  const onNewChat = async () => {
    const c = await create.mutateAsync({})
    void navigate({ to: '/chat/$id', params: { id: c.id } })
  }

  return (
    <aside
      className="hidden md:flex flex-col w-[260px] shrink-0 border-r border-border bg-[color:var(--color-surface-1)]"
      aria-label="Conversations"
    >
      <div className="px-3 pt-3 pb-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={onNewChat}
          disabled={create.isPending}
          className="w-full justify-start gap-2"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>New chat</span>
          <Kbd className="ml-auto bg-transparent border-transparent text-muted-foreground">⌘N</Kbd>
        </Button>
      </div>

      <div className="px-3 pb-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search…"
            className="w-full h-8 pl-7 pr-7 text-[12.5px] bg-[color:var(--color-surface-2)] border border-border rounded-md placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-[color:var(--color-accent)] focus:border-[color:var(--color-accent)] transition-colors"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded text-muted-foreground hover:text-foreground hover:bg-[color:var(--color-surface-3)]"
              aria-label="Clear search"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      <div className="px-3 pb-2 text-[11px] font-mono text-muted-foreground tracking-[0.06em] flex items-center justify-between">
        <span>CONVERSATIONS</span>
        {query && (
          <span className="text-[10px] normal-case tracking-normal">
            {filtered.length} of {conversations.length}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-0.5">
        {isLoading && <div className="px-2 text-xs text-muted-foreground">Loading…</div>}
        {!isLoading && conversations.length === 0 && (
          <div className="px-2 text-xs text-muted-foreground">No conversations yet.</div>
        )}
        {!isLoading && conversations.length > 0 && filtered.length === 0 && (
          <div className="px-2 py-3 text-xs text-muted-foreground italic">No matches.</div>
        )}
        {filtered.map(c => (
          <ConversationRowItem key={c.id} conversation={c} active={c.id === activeId} />
        ))}
      </div>
    </aside>
  )
}

function ConversationRowItem({ conversation, active }: { conversation: ConversationRow; active: boolean }) {
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)
  const [draftTitle, setDraftTitle] = useState(conversation.title)
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const rename = useRenameConversation()
  const remove = useDeleteConversation()

  const startRename = () => {
    setDraftTitle(conversation.title)
    setEditing(true)
    setMenuOpen(false)
  }

  const commitRename = () => {
    const next = draftTitle.trim()
    if (next && next !== conversation.title) {
      rename.mutate({ id: conversation.id, title: next })
    }
    setEditing(false)
  }

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      commitRename()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setEditing(false)
    }
  }

  const onDelete = async () => {
    setConfirmingDelete(false)
    setMenuOpen(false)
    await remove.mutateAsync(conversation.id)
    if (active) {
      // navigate to fresh chat — the parent route guard will redirect or pick another
      void navigate({ to: '/' })
    }
  }

  return (
    <div
      className={cn(
        'group relative flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] transition-colors',
        active
          ? 'bg-[color:var(--color-surface-3)] text-foreground'
          : 'text-muted-foreground hover:bg-[color:var(--color-surface-2)] hover:text-foreground',
      )}
    >
      <MessageSquare className="w-3.5 h-3.5 shrink-0 opacity-70" />

      {editing ? (
        <Input
          autoFocus
          value={draftTitle}
          onChange={e => setDraftTitle(e.target.value)}
          onBlur={commitRename}
          onKeyDown={onKey}
          className="h-6 px-1.5 py-0 text-[13px] bg-[color:var(--color-surface-2)] flex-1"
        />
      ) : (
        <Link
          to="/chat/$id"
          params={{ id: conversation.id }}
          className="flex-1 truncate"
          onDoubleClick={startRename}
          title={conversation.title}
        >
          {conversation.title}
        </Link>
      )}

      {!editing && (
        <button
          type="button"
          onClick={e => {
            e.preventDefault()
            setMenuOpen(o => !o)
          }}
          className={cn(
            'p-1 rounded transition-opacity',
            menuOpen || confirmingDelete ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
            'hover:bg-[color:var(--color-surface-3)]',
          )}
          aria-label="More"
        >
          <MoreHorizontal className="w-3.5 h-3.5" />
        </button>
      )}

      {menuOpen && !confirmingDelete && (
        <div
          className="absolute right-2 top-7 z-50 min-w-[140px] bg-[color:var(--color-surface-2)] border border-border rounded-md shadow-lg overflow-hidden"
          onMouseLeave={() => setMenuOpen(false)}
        >
          <button
            type="button"
            onClick={startRename}
            className="w-full text-left px-3 py-1.5 text-[12.5px] hover:bg-[color:var(--color-surface-3)] text-foreground flex items-center gap-2"
          >
            <Pencil className="w-3 h-3" /> Rename
          </button>
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            className="w-full text-left px-3 py-1.5 text-[12.5px] hover:bg-[color:var(--color-surface-3)] text-[color:var(--color-danger)] flex items-center gap-2"
          >
            <Trash2 className="w-3 h-3" /> Delete
          </button>
        </div>
      )}

      {confirmingDelete && (
        <div
          className="absolute right-2 top-7 z-50 min-w-[200px] bg-[color:var(--color-surface-2)] border border-border rounded-md shadow-lg p-3 space-y-2"
        >
          <div className="text-[12.5px] text-foreground">Delete this conversation?</div>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" className="flex-1" onClick={() => setConfirmingDelete(false)}>
              Cancel
            </Button>
            <Button size="sm" variant="destructive" className="flex-1" onClick={onDelete}>
              Delete
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

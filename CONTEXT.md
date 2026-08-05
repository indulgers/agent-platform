# agent-platform

A durable agent platform: users set a goal, the agent proposes a plan, and — once
approved — works toward it across tools while the user can watch and steer it.

## Language

### The agent runtime

**Run**:
A durable, resumable execution of the agent toward a single Goal. Survives crashes
and can be watched, paused, and stopped. Moves through the statuses `planning →
awaiting_approval → running → paused → done | failed`.
_Avoid_: Task, job, session.

**Goal**:
The natural-language objective a user hands the agent when launching a Run.
_Avoid_: Prompt, query, request.

**Plan**:
The agent's proposed, user-approvable sequence of steps for a Run. Editable before
approval; execution does not begin until it is approved.

**PlanStep**:
One described step of a Plan. Editable (text, order, add, remove) before approval.
_Avoid_: Task, subtask.

**RunStep**:
A persisted unit of a Run's execution — the replay log. A tool call, a tool
result, or the final answer. Distinct from a PlanStep, which is intent, not record.

**Checkpoint**:
A point where the Run pauses to ask the user's approval before running a risky
tool call. Resolved by approving (resume and run it) or rejecting (stop the Run).
_Avoid_: Confirmation, gate, prompt.

**Interrupt** (surfaced to users as **Stop**):
A user request to halt an in-flight Run. The Run stops at its next checkpoint and
ends `failed`.
_Avoid_: Cancel, abort, kill.

### The Runs workspace (web)

**Runs workspace**:
The top-level web surface for durable Runs, separate from the chat surface. Laid
out master-detail as a run list rail beside a run detail pane.

**Run list rail**:
The left column of the Runs workspace listing a user's Runs, most-recently-updated
first, each with its Goal, status, and a timestamp.
_Avoid_: Sidebar (that word is the chat surface's conversation list).

**Run detail**:
The pane showing one Run: its live or replayed timeline plus, when the Run needs
the user, the action card.

**Action card**:
The single pinned slot at the bottom of the run detail that holds whatever the Run
needs from the user — the editable Plan when awaiting approval, or the pending tool
call when paused at a checkpoint.

**Run event stream**:
The live Server-Sent-Events feed of a Run's events, bridged from the worker over
Redis pub/sub. Consumed by the run detail to watch a Run in real time. See
ADR-0006.

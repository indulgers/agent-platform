import { Injectable } from '@nestjs/common'
import { ToolRegistry } from '../tools'
import { DefaultAgentStrategy } from './default-agent.strategy'
import type { AgentStrategy, PlanDraft, RunnerOptions, RunnerResult } from './agent-strategy.interface'

// Re-exported for existing importers; the canonical definitions now live with
// the strategy contract.
export type { RunnerOptions, RunnerResult } from './agent-strategy.interface'

/**
 * Hosts the agent tools and delegates a run to an AgentStrategy. The strategy
 * is the pluggable seam: by default it's the act-until-stop loop, but callers
 * (e.g. the RunEngine) may pass a different strategy per run.
 */
@Injectable()
export class AgentRunner {
  private readonly defaultStrategy: AgentStrategy = new DefaultAgentStrategy()

  constructor(private readonly tools: ToolRegistry) {}

  run(opts: RunnerOptions, strategy: AgentStrategy = this.defaultStrategy): Promise<RunnerResult> {
    return strategy.run({ ...opts, tools: this.tools })
  }

  /** Run a strategy's planning phase. Throws if the strategy has none. */
  plan(opts: RunnerOptions, strategy: AgentStrategy): Promise<PlanDraft> {
    if (!strategy.plan) throw new Error(`Strategy "${strategy.name}" has no planning phase`)
    return strategy.plan({ ...opts, tools: this.tools })
  }
}

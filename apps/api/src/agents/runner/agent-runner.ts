import { Injectable } from '@nestjs/common'
import { ToolRegistry } from '../tools'
import { DefaultAgentStrategy } from './default-agent.strategy'
import type { AgentStrategy, RunnerOptions, RunnerResult } from './agent-strategy.interface'

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
}

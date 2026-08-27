import type { AgentStrategy, RunnerResult, StrategyContext } from './agent-strategy.interface'
import { DEFAULT_TURN_POLICY, ToolTurnProgression } from './tool-turn-progression'

/** Default act-until-stop policy over the shared model/tool turn protocol. */
export class DefaultAgentStrategy implements AgentStrategy {
  readonly name = 'default'
  private readonly turns = new ToolTurnProgression()

  run(ctx: StrategyContext): Promise<RunnerResult> {
    return this.turns.run(ctx, ctx.systemPrompt, DEFAULT_TURN_POLICY)
  }
}

import type { BuildConfig } from '../../core/types.js';
import { ContextPackPlanner } from './plan.js';
import { ContextPackRunner } from './run.js';
import { ContextPackEmitter } from './emit.js';

/**
 * Thin orchestrator for context pack generation
 * Coordinates plan -> run -> emit phases
 */
export class ContextPackService {
  private rootPath: string;
  private config: BuildConfig;

  constructor(rootPath: string, config: BuildConfig) {
    this.rootPath = rootPath;
    this.config = config;
  }

  /**
   * Generate context pack using plan -> run -> emit phases
   */
  async generate(): Promise<void> {
    const startTime = Date.now();

    // Phase 1: Plan
    const planner = new ContextPackPlanner(this.rootPath, this.config);
    const plan = await planner.createPlan();

    // Phase 2: Run
    const runner = new ContextPackRunner(plan);
    const result = await runner.execute();

    // Early return for validate-only mode
    if (this.config.validateOnly) {
      return;
    }

    // Phase 3: Emit
    const emitter = new ContextPackEmitter(plan, result);
    await emitter.emit(startTime);
  }
}
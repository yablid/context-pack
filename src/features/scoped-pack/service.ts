import type { TsProgramService } from '../../core/ts-program/service.js';
import type {
  PlanOnlyConfig,
  ScopedIndex,
  ScopedConfig
} from '../../core/contracts/scoped.js';
import type { FileInfo } from '../../core/types.js';
import { ScopedPackPlanner } from './plan.js';
import { ScopedPackSlicer } from './slice.js';
import { ScopedPackEmitter, type ScopedPackEmitResult } from './emit.js';
import type { PasteResult } from './paste-formatter.js';

/**
 * Thin orchestrator for scoped pack generation
 * Coordinates plan -> slice -> emit phases
 */
export class ScopedPackService {
  private readonly tsProgramService: TsProgramService;
  private readonly rootPath: string;

  constructor(tsProgramService: TsProgramService, rootPath: string) {
    this.tsProgramService = tsProgramService;
    this.rootPath = rootPath;
  }

  /**
   * Generate plan-only index from configuration
   */
  async generateIndex(config: PlanOnlyConfig): Promise<ScopedIndex> {
    // Phase 1: Plan
    const planner = new ScopedPackPlanner(this.tsProgramService, this.rootPath);
    planner.validateConfig(config);
    const plan = await planner.createPlan(config);

    // Phase 2: Slice
    const slicer = new ScopedPackSlicer(plan);
    const sliceResult = await slicer.slice();

    // Phase 3: Emit
    const emitter = new ScopedPackEmitter(plan, sliceResult);
    return emitter.generateIndex();
  }

  /**
   * Generate paste output from scoped configuration
   */
  async generatePaste(scopedConfig: ScopedConfig, files: FileInfo[]): Promise<PasteResult> {
    if (!scopedConfig.paste) {
      throw new Error('Paste configuration not provided');
    }

    // Phase 1: Plan
    const planner = new ScopedPackPlanner(this.tsProgramService, this.rootPath);
    planner.validateConfig(scopedConfig.planOnly);
    const plan = await planner.createPlan(scopedConfig.planOnly);

    // Phase 2: Slice
    const slicer = new ScopedPackSlicer(plan);
    const sliceResult = await slicer.slice();

    // Phase 3: Emit
    const emitter = new ScopedPackEmitter(plan, sliceResult);
    return emitter.generatePaste(scopedConfig, files);
  }

  /**
   * Generate paste string from scoped configuration
   */
  async generatePasteString(scopedConfig: ScopedConfig, files: FileInfo[]): Promise<string> {
    if (!scopedConfig.paste) {
      throw new Error('Paste configuration not provided');
    }

    // Phase 1: Plan
    const planner = new ScopedPackPlanner(this.tsProgramService, this.rootPath);
    planner.validateConfig(scopedConfig.planOnly);
    const plan = await planner.createPlan(scopedConfig.planOnly);

    // Phase 2: Slice
    const slicer = new ScopedPackSlicer(plan);
    const sliceResult = await slicer.slice();

    // Phase 3: Emit
    const emitter = new ScopedPackEmitter(plan, sliceResult);
    return emitter.generatePasteString(scopedConfig, files);
  }

  /**
   * Generate comprehensive output (index + paste if configured)
   */
  async generate(config: PlanOnlyConfig, scopedConfig?: ScopedConfig, files?: FileInfo[]): Promise<ScopedPackEmitResult> {
    // Phase 1: Plan
    const planner = new ScopedPackPlanner(this.tsProgramService, this.rootPath);
    planner.validateConfig(config);
    const plan = await planner.createPlan(config);

    // Phase 2: Slice
    const slicer = new ScopedPackSlicer(plan);
    const sliceResult = await slicer.slice();

    // Phase 3: Emit
    const emitter = new ScopedPackEmitter(plan, sliceResult);
    return emitter.emit(scopedConfig, files);
  }

  /**
   * Get performance metrics for the last operation
   */
  async getPerformanceMetrics(config: PlanOnlyConfig) {
    // Phase 1: Plan
    const planner = new ScopedPackPlanner(this.tsProgramService, this.rootPath);
    const plan = await planner.createPlan(config);

    // Phase 2: Slice
    const slicer = new ScopedPackSlicer(plan);
    const sliceResult = await slicer.slice();

    // Phase 3: Emit (for metrics only)
    const emitter = new ScopedPackEmitter(plan, sliceResult);
    return emitter.getPerformanceMetrics();
  }
}
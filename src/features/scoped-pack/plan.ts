import type { TsProgramService } from '../../core/ts-program/service.js';
import type {
  PlanOnlyConfig,
  SeedResolutionResult,
  ScopedConfig
} from '../../core/contracts/scoped.js';
import { SymbolResolver } from './symbol-resolver.js';

export interface ScopedPackPlan {
  config: PlanOnlyConfig;
  resolution: SeedResolutionResult;
  tsProgramService: TsProgramService;
  symbolResolver: SymbolResolver;
  rootPath: string;
}

/**
 * Planning phase for scoped pack generation
 * Handles configuration validation, seed resolution, and initial setup
 */
export class ScopedPackPlanner {
  private readonly tsProgramService: TsProgramService;
  private readonly symbolResolver: SymbolResolver;
  private readonly rootPath: string;

  constructor(tsProgramService: TsProgramService, rootPath: string) {
    this.tsProgramService = tsProgramService;
    this.symbolResolver = new SymbolResolver(tsProgramService, rootPath);
    this.rootPath = rootPath;
  }

  /**
   * Create execution plan for scoped pack generation
   */
  async createPlan(config: PlanOnlyConfig): Promise<ScopedPackPlan> {
    // Ensure TsProgramService is initialized
    const program = this.tsProgramService.getProgram();
    if (!program) {
      throw new Error('TsProgramService not initialized');
    }

    // Configure symbol resolver
    this.symbolResolver.setIncludeNonExported(config.includeNonExported ?? false);

    // Resolve the seed
    const resolution = await this.symbolResolver.resolveSeed(config.seed);

    return {
      config,
      resolution,
      tsProgramService: this.tsProgramService,
      symbolResolver: this.symbolResolver,
      rootPath: this.rootPath
    };
  }

  /**
   * Extract scoped config from full config
   */
  extractScopedConfig(fullConfig: any): ScopedConfig {
    return {
      planOnly: fullConfig.planOnly || {},
      paste: fullConfig.paste
    };
  }

  /**
   * Validate configuration
   */
  validateConfig(config: PlanOnlyConfig): void {
    if (!config.seed) {
      throw new Error('Seed is required for scoped pack generation');
    }

    if (config.maxDepth && (config.maxDepth < 1 || config.maxDepth > 10)) {
      throw new Error('maxDepth must be between 1 and 10');
    }

    if (config.maxFiles && config.maxFiles < 1) {
      throw new Error('maxFiles must be greater than 0');
    }

    if (config.maxBytes && config.maxBytes < 1000) {
      throw new Error('maxBytes must be at least 1000');
    }
  }
}
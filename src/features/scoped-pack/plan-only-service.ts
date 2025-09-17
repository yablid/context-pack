/**
 * Plan-Only Service - Legacy wrapper for ScopedPackService
 * @deprecated Use ScopedPackService directly
 */

import type { TsProgramService } from '../../core/ts-program/service.js';
import type {
  PlanOnlyConfig,
  ScopedIndex,
  ScopedConfig
} from '../../core/contracts/scoped.js';
import type { FileInfo } from '../../core/types.js';
import { ScopedPackService } from './service.js';
import type { PasteResult } from './paste-formatter.js';

export class PlanOnlyService {
  private service: ScopedPackService;

  constructor(tsProgramService: TsProgramService, rootPath: string) {
    this.service = new ScopedPackService(tsProgramService, rootPath);
  }

  /**
   * Generate plan-only index from configuration
   */
  async generateIndex(config: PlanOnlyConfig): Promise<ScopedIndex> {
    return this.service.generateIndex(config);
  }

  /**
   * Generate paste output from scoped configuration
   */
  async generatePaste(scopedConfig: ScopedConfig, files: FileInfo[]): Promise<PasteResult> {
    return this.service.generatePaste(scopedConfig, files);
  }

  /**
   * Generate paste string from scoped configuration
   */
  async generatePasteString(scopedConfig: ScopedConfig, files: FileInfo[]): Promise<string> {
    return this.service.generatePasteString(scopedConfig, files);
  }
}
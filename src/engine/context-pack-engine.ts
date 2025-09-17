import type { BuildConfig } from '../core/types.js';
import { ContextPackService } from '../features/context-pack/service.js';

/**
 * Legacy wrapper for ContextPackEngine
 * @deprecated Use ContextPackService directly
 */
export class ContextPackEngine {
  private service: ContextPackService;

  constructor(rootPath: string, config: BuildConfig) {
    this.service = new ContextPackService(rootPath, config);
  }

  async generate(): Promise<void> {
    return this.service.generate();
  }
}
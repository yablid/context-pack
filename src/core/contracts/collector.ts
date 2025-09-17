/**
 * Core collector contract
 * Type-only interface with no runtime dependencies
 */

import type { Artifact, FileInfo } from '../types.js';

export interface CollectorContext {
  rootPath: string;
  packages: string[];
  files: FileInfo[];
  budgetHint: number;
  riskProfile: string;
  verbose?: boolean;
  timeout?: number;
  memoryLimitMB?: number;
}

export interface Collector {
  readonly name: string;
  readonly schemaIds: string[];

  detect(rootPath: string): Promise<boolean | number>;
  collect(context: CollectorContext): Promise<Artifact[]>;
}

export interface CollectorExecutionContext extends CollectorContext {
  timeout?: number; // milliseconds
  memoryLimitMB?: number;
}
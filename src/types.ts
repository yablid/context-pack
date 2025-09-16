// Core types for the Context Pack system

export interface Artifact {
  id: string;
  filename: string;
  kind: 'json' | 'text';
  schemaId: string;
  sizeHint: number;
  data?: unknown;
  text?: string;
}

export interface PackMetadata {
  specVersion: string;
  generator: {
    name: string;
    version: string;
  };
  createdAt: string; // UTC ISO string
  preset: string;
  riskProfile: 'safe' | 'normal' | 'extended' | 'minimal';
  level: 'summary' | 'contracts' | 'full-api' | 'deep';
  budgets: {
    targetBytes: number;
    actualBytes: number;
  };
  git?: {
    commit?: string;
    branch?: string;
    isDirty?: boolean;
  };
  downsampling: DownsamplingDecision[];
  validation?: {
    enabled: boolean;
    stats: {
      totalArtifacts: number;
      validArtifacts: number;
      errorCount: number;
      warningCount: number;
    };
    failedCollectors?: string[];
  };
  health?: {
    totalCollectors: number;
    successful: number;
    partial: number;
    failed: number;
    timeout: number;
    skipped: number;
    totalExecutionTime: number;
    collectors: CollectorHealth[];
  };
  meta?: Record<string, unknown>;
}

export interface DownsamplingDecision {
  artifactId: string;
  reason: string;
  originalCount: number;
  finalCount: number;
  strategy: string;
}

export interface FileInfo {
  path: string; // POSIX-style relative path
  bytes: number;
  sha256: string;
  loc: number; // lines of code, 0 for non-text files
  kind: 'code' | 'config' | 'test' | 'asset' | 'docs';
  bucket: 'public' | 'internal' | 'unknown';
  ignoreReason?: string;
}

export interface CollectorContext {
  rootPath: string;
  packages: string[]; // workspace package directories
  files: FileInfo[];
  budgetHint: number; // suggested size budget for this collector
  riskProfile: 'safe' | 'normal' | 'extended' | 'minimal';
  verbose: boolean;
}

export interface Collector {
  name: string;
  detect(rootPath: string): Promise<boolean | number>; // boolean or confidence score 0-1
  collect(context: CollectorContext): Promise<Artifact[]>;
  schemaIds: string[]; // schemas this collector produces
}

export interface DetectorResult {
  name: string;
  confidence: number; // 0-1
  metadata?: Record<string, unknown>;
}

export interface IgnoreRules {
  gitignore: string[];
  defaults: string[];
  user: string[];
}

export interface BuildConfig {
  level: 'summary' | 'contracts' | 'full-api' | 'deep';
  budgetBytes: number;
  riskProfile: 'safe' | 'normal' | 'extended' | 'minimal';
  preset: string;
  packages?: string[];
  exclude?: string[];
  deterministic: boolean;
  format: 'json' | 'ndjson';
  verbose: boolean;
  strict: boolean;
  validateSchemas: boolean;
  validateOnly?: boolean;
  out: string;
  hashFiles?: boolean;
  maxHashFileSizeMB?: number;
  concurrency?: number;
  // Scoped pack configuration
  scope?: {
    seed: string;
    budgetTokens: number;
    mode: 'static' | 'hybrid';
    allowCodeBodies: boolean;
    include?: {
      tests?: boolean;
      docs?: boolean;
    };
  };
}

export interface CollectorHealth {
  name: string;
  status: 'ok' | 'partial' | 'failed' | 'timeout' | 'skipped';
  durationMs: number;
  errorMessage?: string; // tests expect this
  errorCode?: string;
}

export interface CollectorRunResult {
  artifacts: Artifact[];
  health: CollectorHealth;
  success: boolean;
  error?: any;
}

export interface CollectorExecutionContext extends CollectorContext {
  timeout?: number; // milliseconds
  memoryLimitMB?: number;
}
// Contracts for paste pack functionality
// Single-file directory dump with security and budget controls

export interface PastePackConfig {
  readonly rootPath: string;
  readonly outputPath?: string;
  readonly allowCodeBodies: boolean;
  readonly format: 'paste';
  readonly budgets: {
    readonly maxFiles?: number;       // Default: 100
    readonly maxLoc?: number;         // Default: 50000
    readonly maxBytes?: number;       // Default: 2000000
  };
  readonly include?: {
    readonly patterns?: string[];     // File glob patterns to include
    readonly extensions?: string[];   // File extensions to include (.ts, .js, etc.)
  };
  readonly exclude?: {
    readonly patterns?: string[];     // File glob patterns to exclude
    readonly directories?: string[];  // Directories to exclude
  };
}

export interface PastePackFile {
  readonly path: string;
  readonly content: string;
  readonly metadata: {
    readonly size: number;
    readonly loc: number;
    readonly extension: string;
    readonly included: boolean;
    readonly excludeReason?: string;
  };
}

export interface PastePackResult {
  readonly metadata: {
    readonly generatedAt: string;
    readonly rootPath: string;
    readonly config: PastePackConfig;
  };
  readonly summary: {
    readonly totalFilesScanned: number;
    readonly filesIncluded: number;
    readonly filesExcluded: number;
    readonly totalLoc: number;
    readonly totalBytes: number;
    readonly truncated: boolean;
    readonly truncationReason?: string;
  };
  readonly files: readonly PastePackFile[];
  readonly content: string; // Final paste output
}

export interface PastePackArtifact {
  readonly id: string;
  readonly filename: string;
  readonly kind: 'text';
  readonly schemaId: 'paste-pack';
  readonly sizeHint: number;
  readonly text: string;
}
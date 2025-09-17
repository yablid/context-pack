/**
 * Scoped Pack Contracts - Frozen interfaces for symbol-targeted context generation
 *
 * These contracts MUST remain stable across implementations to prevent churn
 * in goldens, formatters, and downstream consumers.
 */

// Seed Grammar: Precise targeting of symbols or locations
export type SeedGrammar =
  | `${string}#${string}`     // path#symbol
  | `${string}:${number}:${number}`; // path:line:col

export interface SeedLocation {
  readonly path: string;
  readonly type: 'symbol' | 'location';
  readonly symbol?: string;
  readonly line?: number;
  readonly column?: number;
}

// Failure Modes: Structured errors for seed resolution
export interface SeedResolutionDiagnostic {
  readonly code: 'SEED_NOT_FOUND' | 'MULTIPLE_DECLARATIONS' | 'AMBIENT_TYPE' | 'PROJECT_REFERENCE' | 'REEXPORTED_SYMBOL' | 'INVALID_GRAMMAR';
  readonly message: string;
  readonly path?: string;
  readonly symbol?: string;
  readonly alternatives?: readonly string[];
}

export interface SeedResolutionResult {
  readonly seed: SeedGrammar;
  readonly success: boolean;
  readonly location?: SeedLocation;
  readonly diagnostics: readonly SeedResolutionDiagnostic[];
}

// Plan-Only Output: Symbol graph with stable IDs
export interface ScopedSymbolNode {
  readonly id: string;           // Stable ID: `${normalizedPath}#${symbolName}`
  readonly path: string;         // POSIX normalized path
  readonly symbol: string;
  readonly kind: 'class' | 'interface' | 'function' | 'variable' | 'type' | 'enum' | 'namespace';
  readonly line?: number;
  readonly column?: number;
  readonly exported: boolean;
}

export interface ScopedSymbolEdge {
  readonly from: string;         // Source node ID
  readonly to: string;           // Target node ID
  readonly type: 'imports' | 'calls' | 'extends' | 'implements' | 'references';
  readonly line?: number;
}

export interface ScopedSymbolGraph {
  readonly nodes: readonly ScopedSymbolNode[];
  readonly edges: readonly ScopedSymbolEdge[];
  readonly seedNodeId: string;
  readonly generatedAt: string;  // ISO timestamp
}

export interface ScopedIndex {
  readonly seed: SeedGrammar;
  readonly resolution: SeedResolutionResult;
  readonly symbolGraph: ScopedSymbolGraph;
  readonly stats: {
    readonly totalNodes: number;
    readonly totalEdges: number;
    readonly depthFromSeed: number;
    readonly filesEmitted: number;
    readonly locEmitted: number;
    readonly bytesEmitted: number;
    readonly depthUsed: number;
    readonly truncated: boolean;
  };
}

// Plan-Only Configuration
export interface PlanOnlyConfig {
  readonly seed: SeedGrammar;
  readonly rootPath: string;
  readonly maxDepth?: number;    // Default: 2
  readonly includeTests?: boolean; // Default: false
  readonly includeDocs?: boolean;  // Default: false
  readonly includeNonExported?: boolean; // Default: false
  readonly tsconfig?: string;    // Override tsconfig path
  // Budget guards for BFS-based collection
  readonly maxFiles?: number;     // Default: 50
  readonly maxLoc?: number;       // Default: 10000
  readonly maxBytes?: number;     // Default: 500000
}

// Paste Formatter Configuration
export interface PasteConfig {
  readonly budgetTokens: number;
  readonly budgetBytes: number;
  readonly budgetFiles?: number;
  readonly budgetLoc?: number;
  readonly allowCodeBodies: boolean;
  readonly redactSecrets: boolean;
}

// Combined Scoped Configuration
export interface ScopedConfig {
  readonly planOnly: PlanOnlyConfig;
  readonly paste?: PasteConfig;
}
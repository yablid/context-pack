// Contracts for refactor report functionality
// Defines input/output structures for graph-based refactoring signals

export interface RefactorReportConfig {
  readonly rootPath: string;
  readonly importGraphPath?: string;  // Path to import-graph.json artifact
  readonly exportsPath?: string;      // Path to exports.json artifact
  readonly format: 'json' | 'paste';
  readonly outputPath?: string;
}

export interface SuggestedCut {
  readonly edge: {
    readonly from: string;
    readonly to: string;
    readonly kind: string;
    readonly specifier: string;
  };
  readonly reason: string;
  readonly impact: 'low' | 'medium' | 'high';
  readonly alternatives?: string[];
}

export interface RefactorReport {
  readonly metadata: {
    readonly generatedAt: string; // ISO timestamp
    readonly analysisType: 'structural-signals';
    readonly sourceArtifacts: {
      readonly importGraph?: string;
      readonly exports?: string;
    };
  };
  readonly structural: {
    readonly sccCount: number;
    readonly hasCycles: boolean;
    readonly totalNodes: number;
    readonly totalEdges: number;
    readonly internalEdges: number;
    readonly externalEdges: number;
    readonly suggestedCuts: SuggestedCut[];
  };
  readonly fanAnalysis: {
    readonly topFanIn: ReadonlyArray<{ readonly path: string; readonly count: number }>;
    readonly topFanOut: ReadonlyArray<{ readonly path: string; readonly count: number }>;
    readonly thresholds: {
      readonly fanIn: number;
      readonly fanOut: number;
    };
  };
  readonly reexportHubs: ReadonlyArray<{
    readonly path: string;
    readonly reexportCount: number;
    readonly totalExports: number;
    readonly reexportRatio: number;
  }>;
  readonly externalReach: {
    readonly totalExternalDeps: number;
    readonly topExternalDeps: ReadonlyArray<readonly [string, number]>;
    readonly filesWithExternalDeps: number;
  };
  readonly roleClassification: {
    readonly roots: readonly string[];
    readonly leaves: readonly string[];
    readonly isolated: readonly string[];
    readonly orchestrators: readonly string[];
    readonly kernels: readonly string[];
  };
  readonly hotspots: ReadonlyArray<{
    readonly path: string;
    readonly score: number;
    readonly reasons: readonly string[];
  }>;
  readonly summary: {
    readonly primaryConcerns: readonly string[];
    readonly recommendedActions: readonly string[];
    readonly riskAssessment: 'low' | 'medium' | 'high';
  };
}

export interface RefactorReportResult {
  readonly report: RefactorReport;
  readonly artifacts: ReadonlyArray<{
    readonly id: string;
    readonly filename: string;
    readonly kind: 'json' | 'text';
    readonly schemaId: string;
    readonly sizeHint: number;
    readonly data?: unknown;
    readonly text?: string;
  }>;
}
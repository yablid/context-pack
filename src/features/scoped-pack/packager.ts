import type { Artifact } from '../../core/types.js';
import type { SymbolReference } from '../../core/ts-program/service.js';
import type { DependencyGraph } from './graph-builder.js';
import type { RankedNode, RankingResult } from './ranker.js';
import type { CodeSlice } from './slicer.js';
import type { StubGenerationResult } from './stubber.js';
import type { ScopedConfig } from '../../core/types.js';
import type { ScopedScope } from '../../core/validation/scoped-scope.js';
import type { ScopedSymbolGraph } from '../../core/validation/scoped-symbol-graph.js';
import type { ScopedSlice } from '../../core/validation/scoped-slices.js';
import type { ScopedIndexEntry } from '../../core/validation/scoped-index.js';
import { CanonicalJSON } from '../../core/io/canonical-json.js';
import { TokenCounter } from '../../core/tokens/token-counter.js';
import { getGitInfo } from '../../utils/git-info.js';
import { BudgetPolicy } from '../../utils/budget-policy.js';

export interface PackagingInput {
  config: ScopedConfig;
  seedRef: SymbolReference;
  graph: DependencyGraph;
  rankedNodes: RankedNode[];
  slices: CodeSlice[];
  stubs: StubGenerationResult;
}

export interface PlanOnlyInput {
  config: ScopedConfig;
  seedRef: SymbolReference;
  graph: DependencyGraph;
  rankedNodes: RankedNode[];
}

export interface PackagerConfig {
  seed: string;
  mode: 'static' | 'hybrid';
  rootPath: string;
}

/**
 * ScopedPackager creates the final scoped pack artifacts
 * Converts internal data structures to the schema-compliant format
 */
export class ScopedPackager {
  private config: PackagerConfig;

  constructor(config: PackagerConfig) {
    this.config = config;
  }

  /**
   * Create all scoped pack artifacts
   */
  async createArtifacts(input: PackagingInput): Promise<Artifact[]> {
    const artifacts: Artifact[] = [];

    // Generate git information for reproducibility
    const gitInfo = await getGitInfo(this.config.rootPath);

    // Create 00-scope.json
    const scopeArtifact = await this.createScopeArtifact(input, gitInfo);
    artifacts.push(scopeArtifact);

    // Create 10-symbol-graph.json
    const graphArtifact = await this.createSymbolGraphArtifact(input);
    artifacts.push(graphArtifact);

    // Create 20-slices.ndjson
    const slicesArtifact = await this.createSlicesArtifact(input);
    artifacts.push(slicesArtifact);

    // Create 30-stubs.d.ts
    const stubsArtifact = await this.createStubsArtifact(input);
    artifacts.push(stubsArtifact);

    // Create 40-index.ndjson
    const indexArtifact = await this.createIndexArtifact(input);
    artifacts.push(indexArtifact);

    return artifacts;
  }

  /**
   * Create plan-only artifacts (scope + graph only)
   * Used for --scope-plan-only to enable fast budget estimation
   */
  async createPlanOnlyArtifacts(input: PlanOnlyInput): Promise<Artifact[]> {
    const artifacts: Artifact[] = [];

    // Generate git information for reproducibility
    const gitInfo = await getGitInfo(this.config.rootPath);

    // Create 00-scope.json with plan-only markers
    let scopeArtifact = await this.createScopeArtifact(input, gitInfo);

    // Tag as plan-only
    if (scopeArtifact?.data && typeof scopeArtifact.data === 'object') {
      const scopeData: any = scopeArtifact.data;
      scopeData.planOnly = true;
      scopeData.results = {
        ...(scopeData.results || {}),
        stopReason: 'plan_only'
      };
      scopeArtifact = {
        ...scopeArtifact,
        data: scopeData
      };
    }
    artifacts.push(scopeArtifact);

    // Create 10-symbol-graph.json
    const graphArtifact = await this.createSymbolGraphArtifact(input);
    artifacts.push(graphArtifact);

    return artifacts;
  }

  private async createScopeArtifact(input: PackagingInput | PlanOnlyInput, gitInfo: any): Promise<Artifact> {
    const scopeData: ScopedScope = {
      specVersion: '1',
      seed: this.config.seed,
      commit: gitInfo.commit,
      branch: gitInfo.branch,
      isDirty: gitInfo.isDirty,
      mode: this.config.mode,
      budgets: {
        tokens: input.config.budgetTokens,
        bytes: input.config.budgetBytes
      },
      policy: {
        includeTests: input.config.include?.tests ?? false,
        includeDocs: input.config.include?.docs ?? false,
        preferTypes: true, // Default preference
        allowCodeBodies: input.config.allowCodeBodies
      },
      determinism: {
        edgeWeights: 'v1',
        sort: 'stable'
      },
      results: {
        totalSymbols: input.graph.nodes.length,
        includedSymbols: input.rankedNodes.filter(n => n.included).length,
        budgetExceeded: input.rankedNodes.filter(n => !n.withinBudget).length,
        stubbed: 'stubs' in input ? input.stubs.internalSymbols + input.stubs.externalPackages : 0,
        totalFiles: input.graph.stats.filesTouched,
        maxDepth: input.graph.stats.maxDepth
      }
    };

    return this.createArtifact(
      'scoped-scope',
      'scoped/00-scope.json',
      'scoped/00-scope',
      scopeData
    );
  }

  private async createSymbolGraphArtifact(input: PackagingInput | PlanOnlyInput): Promise<Artifact> {
    // Convert internal graph to schema format
    const nodes = input.graph.nodes.map(node => ({
      id: this.createSymbolId(node.symbol),
      kind: this.inferSymbolKind(node.symbol.fqn.symbol) as any,
      path: node.symbol.fqn.path,
      name: node.symbol.fqn.symbol,
      line: node.symbol.fqn.line,
      column: node.symbol.fqn.column,
      included: input.rankedNodes.find(r => r.id === node.id)?.included ?? false,
      reason: node.reasons
    }));

    const edges = input.graph.edges.map(edge => ({
      from: `${edge.from.path}#${edge.from.symbol}`,
      to: `${edge.to.path}#${edge.to.symbol}`,
      type: edge.type as any,
      weight: edge.weight,
      reason: edge.reason
    }));

    const graphData: ScopedSymbolGraph = {
      nodes,
      edges,
      ranking: {
        algorithm: 'weighted-bfs',
        maxDepth: 5,
        weights: {
          calls: 3.0,
          typeRef: 2.5,
          extends: 2.0,
          implements: 2.0,
          imports: 1.5,
          sameFileSibling: 1.2,
          testCovers: 1.0,
          docMentions: 0.3
        },
        stopConditions: {
          budgetExhausted: true, // TODO: Get from ranker
          maxDepthReached: false,
          maxFilesReached: false,
          manual: false
        }
      },
      stats: {
        totalNodes: input.graph.nodes.length,
        totalEdges: input.graph.edges.length,
        includedNodes: input.rankedNodes.filter(n => n.included).length,
        stubbedNodes: 'stubs' in input ? input.stubs.internalSymbols : 0,
        filesTouched: input.graph.stats.filesTouched,
        externalPackages: input.graph.stats.externalPackages,
        hasCycles: false, // TODO: Implement cycle detection
        sccCount: 0
      }
    };

    return this.createArtifact(
      'scoped-symbol-graph',
      'scoped/10-symbol-graph.json',
      'scoped/10-symbol-graph',
      graphData
    );
  }

  private async createSlicesArtifact(input: PackagingInput): Promise<Artifact> {
    // Convert slices to NDJSON format
    const sliceLines: string[] = [];

    for (const slice of input.slices) {
      const sliceData: ScopedSlice = {
        path: slice.path,
        startLine: slice.startLine,
        endLine: slice.endLine,
        startChar: slice.startChar,
        endChar: slice.endChar,
        reasons: slice.reasons,
        symbolId: slice.symbolId,
        symbolName: slice.symbolName,
        symbolKind: slice.symbolKind,
        doc: slice.doc,
        body: slice.body,
        context: slice.context,
        tokens: slice.tokens
      };

      sliceLines.push(CanonicalJSON.stringify(sliceData));
    }

    const ndjsonContent = sliceLines.join('\n');

    return {
      id: 'scoped-slices',
      filename: 'scoped/20-slices.ndjson',
      kind: 'text',
      schemaId: 'scoped/20-slices',
      sizeHint: Buffer.byteLength(ndjsonContent, 'utf-8'),
      text: ndjsonContent
    };
  }

  private async createStubsArtifact(input: PackagingInput): Promise<Artifact> {
    return {
      id: 'scoped-stubs',
      filename: 'scoped/30-stubs.d.ts',
      kind: 'text',
      schemaId: 'scoped/30-stubs',
      sizeHint: Buffer.byteLength(input.stubs.content, 'utf-8'),
      text: input.stubs.content
    };
  }

  private async createIndexArtifact(input: PackagingInput): Promise<Artifact> {
    const indexLines: string[] = [];

    // Create index entries for all symbols
    for (const node of input.graph.nodes) {
      const rankedNode = input.rankedNodes.find(r => r.id === node.id);
      const nodeSlices = input.slices.filter(s => s.symbolId === node.id);

      const indexEntry: ScopedIndexEntry = {
        symbol: node.id,
        name: node.symbol.fqn.symbol,
        kind: this.inferSymbolKind(node.symbol.fqn.symbol) as any,
        path: node.symbol.fqn.path,
        included: rankedNode?.included ?? false,
        slices: nodeSlices.map(s => ({
          path: s.path,
          start: s.startLine,
          end: s.endLine,
          primary: true
        })),
        reasons: node.reasons,
        ranking: {
          distance: node.distance,
          score: rankedNode?.score ?? 0,
          withinBudget: rankedNode?.withinBudget ?? false
        },
        tokens: nodeSlices.length > 0 ? {
          conservative: nodeSlices.reduce((sum, s) => sum + (s.tokens?.conservative ?? 0), 0),
          optimistic: nodeSlices.reduce((sum, s) => sum + (s.tokens?.optimistic ?? 0), 0),
          average: nodeSlices.reduce((sum, s) => sum + (s.tokens?.average ?? 0), 0)
        } : undefined
      };

      indexLines.push(CanonicalJSON.stringify(indexEntry));
    }

    const ndjsonContent = indexLines.join('\n');

    return {
      id: 'scoped-index',
      filename: 'scoped/40-index.ndjson',
      kind: 'text',
      schemaId: 'scoped/40-index',
      sizeHint: Buffer.byteLength(ndjsonContent, 'utf-8'),
      text: ndjsonContent
    };
  }

  private createArtifact(
    id: string,
    filename: string,
    schemaId: string,
    data: any
  ): Artifact {
    return {
      id,
      filename,
      kind: 'json',
      schemaId,
      sizeHint: Buffer.byteLength(CanonicalJSON.stringify(data), 'utf-8'),
      data
    };
  }


  private createSymbolId(ref: SymbolReference): string {
    const location = ref.fqn.line && ref.fqn.column
      ? `@${ref.fqn.line}:${ref.fqn.column}`
      : '';
    return `${ref.fqn.path}#${ref.fqn.symbol}${location}`;
  }

  private inferSymbolKind(symbolName: string): string {
    if (symbolName.startsWith('I') && symbolName[1]?.toUpperCase() === symbolName[1]) {
      return 'interface';
    }

    if (symbolName[0]?.toUpperCase() === symbolName[0] && !symbolName.includes('_')) {
      return 'class';
    }

    if (symbolName.endsWith('Type') || symbolName.endsWith('Config')) {
      return 'type';
    }

    if (symbolName[0]?.toUpperCase() === symbolName[0] && symbolName.endsWith('Enum')) {
      return 'enum';
    }

    return 'function';
  }
}
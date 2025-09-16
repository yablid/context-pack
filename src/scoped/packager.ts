import { execSync } from 'node:child_process';
import type { Artifact } from '../types.js';
import type { SymbolReference } from '../engine/ts-program-service.js';
import type { DependencyGraph } from './graph-builder.js';
import type { RankedNode, RankingResult } from './ranker.js';
import type { CodeSlice } from './slicer.js';
import type { StubGenerationResult } from './stubber.js';
import type { ScopedConfig } from '../collectors/scoped-collector.js';
import type { ScopedScope } from '../schemas/scoped-scope.js';
import type { ScopedSymbolGraph } from '../schemas/scoped-symbol-graph.js';
import type { ScopedSlice } from '../schemas/scoped-slices.js';
import type { ScopedIndexEntry } from '../schemas/scoped-index.js';
import { CanonicalJSON } from '../engine/canonical-json.js';
import { TokenCounter } from '../utils/token-counter.js';

export interface PackagingInput {
  config: ScopedConfig;
  seedRef: SymbolReference;
  graph: DependencyGraph;
  rankedNodes: RankedNode[];
  slices: CodeSlice[];
  stubs: StubGenerationResult;
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
    const gitInfo = await this.getGitInfo();

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

  private async createScopeArtifact(input: PackagingInput, gitInfo: any): Promise<Artifact> {
    const scopeData: ScopedScope = {
      specVersion: '1',
      seed: this.config.seed,
      commit: gitInfo.commit,
      branch: gitInfo.branch,
      isDirty: gitInfo.isDirty,
      mode: this.config.mode,
      budgets: {
        tokens: input.config.budgetTokens,
        bytes: 1500000 // TODO: Get from global budget
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
        stubbed: input.stubs.internalSymbols + input.stubs.externalPackages,
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

  private async createSymbolGraphArtifact(input: PackagingInput): Promise<Artifact> {
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
        stubbedNodes: input.stubs.internalSymbols,
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

  private async getGitInfo(): Promise<{ commit?: string; branch?: string; isDirty?: boolean }> {
    try {
      const commit = execSync('git rev-parse HEAD', {
        cwd: this.config.rootPath,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore']
      }).trim();

      const branch = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: this.config.rootPath,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore']
      }).trim();

      const isDirty = execSync('git diff --quiet || echo "dirty"', {
        cwd: this.config.rootPath,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore']
      }).trim() === 'dirty';

      return { commit, branch, isDirty };
    } catch {
      return {};
    }
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
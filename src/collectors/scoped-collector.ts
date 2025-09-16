import { BaseCollector } from './base-collector.js';
import type { Artifact, CollectorContext } from '../types.js';
import { TsProgramService } from '../engine/ts-program-service.js';
import { GraphBuilder } from '../scoped/graph-builder.js';
import { Ranker } from '../scoped/ranker.js';
import { Slicer } from '../scoped/slicer.js';
import { StubGenerator } from '../scoped/stubber.js';
import { ScopedPackager } from '../scoped/packager.js';
import type { ScopedScope } from '../schemas/scoped-scope.js';

export interface ScopedConfig {
  seed: string;
  budgetTokens: number;
  mode: 'static' | 'hybrid';
  allowCodeBodies: boolean;
  include?: {
    tests?: boolean;
    docs?: boolean;
  };
}

/**
 * ScopedCollector - Special collector for symbol-level context extraction
 * Extends BaseCollector for infrastructure reuse but is NOT registered in collector registry
 * Only invoked directly by ContextPackEngine when --scope flag is present
 */
export class ScopedCollector extends BaseCollector {
  readonly name = 'scoped';
  readonly schemaIds = [
    'scoped/00-scope',
    'scoped/10-symbol-graph',
    'scoped/20-slices',
    'scoped/30-stubs',
    'scoped/40-index'
  ];

  private config: ScopedConfig;
  private tsProgramService: TsProgramService;

  constructor(config: ScopedConfig) {
    super();
    this.config = config;
    this.tsProgramService = new TsProgramService(''); // Will be initialized with proper root path
  }

  async detect(rootPath: string): Promise<boolean> {
    // Always return true if we have a scope configuration
    // This collector is only invoked when explicitly requested via --scope
    try {
      this.tsProgramService = new TsProgramService(rootPath);
      await this.tsProgramService.initialize();
      return true;
    } catch {
      return false;
    }
  }

  async collect(context: CollectorContext): Promise<Artifact[]> {
    this.log(`Generating scoped pack for: ${this.config.seed}`, context);

    // Initialize TypeScript Program service with correct root path
    this.tsProgramService = new TsProgramService(context.rootPath);
    await this.tsProgramService.initialize();

    // Parse and resolve the seed FQN
    const seedFqn = this.tsProgramService.parseFQN(this.config.seed);
    const seedRef = this.tsProgramService.resolveFqnToNode(seedFqn);

    if (!seedRef) {
      throw new Error(`Could not resolve seed symbol: ${this.config.seed}`);
    }

    this.log(`Resolved seed symbol: ${seedRef.fqn.symbol} in ${seedRef.fqn.path}`, context);

    // Step 1: Build dependency graph
    const graphBuilder = new GraphBuilder(this.tsProgramService, {
      includeTests: this.config.include?.tests ?? false,
      includeDocs: this.config.include?.docs ?? false,
      maxDepth: 5, // Configurable limit
      maxFiles: 100 // Prevent runaway graph expansion
    });

    const graph = await graphBuilder.buildGraph(seedRef);
    this.log(`Built graph with ${graph.nodes.length} nodes and ${graph.edges.length} edges`, context);

    // Step 2: Rank symbols using weighted BFS
    const ranker = new Ranker({
      budgetTokens: this.config.budgetTokens,
      globalBudgetBytes: context.budgetHint,
      weights: {
        calls: 3.0,
        typeRef: 2.5,
        extends: 2.0,
        implements: 2.0,
        imports: 1.5,
        sameFileSibling: 1.2,
        testCovers: 1.0,
        docMentions: 0.3
      }
    });

    const rankingResult = await ranker.rankNodes(graph, seedRef);
    this.log(`Ranked ${rankingResult.nodes.length} nodes within budget`, context);

    // Step 3: Extract code slices
    const slicer = new Slicer({
      allowCodeBodies: this.config.allowCodeBodies,
      contextLines: 3,
      mergeOverlapping: true
    });

    const slices = await slicer.extractSlices(rankingResult.nodes, context.rootPath);
    this.log(`Extracted ${slices.length} code slices`, context);

    // Step 4: Generate stubs for external/excluded symbols
    const stubGenerator = new StubGenerator(this.tsProgramService);
    const stubs = await stubGenerator.generateStubs(graph.nodes, rankingResult.nodes);
    this.log(`Generated stubs for ${stubs.externalPackages} external packages`, context);

    // Step 5: Package everything into artifacts
    const packager = new ScopedPackager({
      seed: this.config.seed,
      mode: this.config.mode,
      rootPath: context.rootPath
    });

    const artifacts = await packager.createArtifacts({
      config: this.config,
      seedRef,
      graph,
      rankedNodes: rankingResult.nodes,
      slices,
      stubs
    });

    this.log(`Generated ${artifacts.length} scoped artifacts`, context);
    return artifacts;
  }
}

/**
 * Create a scoped collector instance
 * This is the main entry point for the ContextPackEngine
 */
export function createScopedCollector(config: ScopedConfig): ScopedCollector {
  return new ScopedCollector(config);
}
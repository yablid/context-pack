/**
 * Plan-Only Service - Orchestrates seed resolution and symbol graph generation
 */

import type { TsProgramService } from '../../core/ts-program/service.js';
import type {
  PlanOnlyConfig,
  ScopedIndex,
  SeedResolutionResult,
  ScopedSymbolGraph,
  ScopedSymbolNode,
  ScopedSymbolEdge,
  ScopedConfig,
  PasteConfig
} from '../../core/contracts/scoped.js';
import type { FileInfo } from '../../core/types.js';
import { SymbolResolver } from './symbol-resolver.js';
import { PasteFormatter, type PasteResult } from './paste-formatter.js';

export class PlanOnlyService {
  private readonly tsProgramService: TsProgramService;
  private readonly symbolResolver: SymbolResolver;
  private readonly pasteFormatter: PasteFormatter;
  private readonly rootPath: string;

  constructor(tsProgramService: TsProgramService, rootPath: string) {
    this.tsProgramService = tsProgramService;
    this.symbolResolver = new SymbolResolver(tsProgramService, rootPath);
    this.pasteFormatter = new PasteFormatter(rootPath);
    this.rootPath = rootPath;
  }

  /**
   * Generate plan-only index from configuration
   */
  async generateIndex(config: PlanOnlyConfig): Promise<ScopedIndex> {
    // Ensure TsProgramService is initialized
    const program = this.tsProgramService.getProgram();
    if (!program) {
      throw new Error('TsProgramService not initialized');
    }

    // Configure symbol resolver
    this.symbolResolver.setIncludeNonExported(config.includeNonExported ?? false);

    // Resolve the seed
    const resolution = await this.symbolResolver.resolveSeed(config.seed);

    let symbolGraph: ScopedSymbolGraph;

    if (resolution.success) {
      // Build symbol graph with deterministic ordering
      symbolGraph = await this.symbolResolver.buildSymbolGraph(
        resolution,
        config.maxDepth || 2
      );

      // Apply filters based on config
      symbolGraph = this.applyFilters(symbolGraph, config);
    } else {
      // Create empty graph for failed resolution
      symbolGraph = {
        nodes: [],
        edges: [],
        seedNodeId: '',
        generatedAt: new Date().toISOString(),
      };
    }

    // Calculate stats
    const stats = this.calculateStats(symbolGraph, resolution);

    return {
      seed: config.seed,
      resolution,
      symbolGraph,
      stats,
    };
  }

  /**
   * Generate paste output from scoped configuration
   */
  async generatePaste(scopedConfig: ScopedConfig, files: FileInfo[]): Promise<PasteResult> {
    if (!scopedConfig.paste) {
      throw new Error('Paste configuration not provided');
    }

    // First generate the index
    const index = await this.generateIndex(scopedConfig.planOnly);

    // Then format to paste
    return this.pasteFormatter.formatToPaste(index, scopedConfig.paste, files);
  }

  /**
   * Generate paste string from scoped configuration
   */
  async generatePasteString(scopedConfig: ScopedConfig, files: FileInfo[]): Promise<string> {
    const pasteResult = await this.generatePaste(scopedConfig, files);
    return this.pasteFormatter.renderPaste(pasteResult);
  }

  /**
   * Apply filters based on configuration
   */
  private applyFilters(graph: ScopedSymbolGraph, config: PlanOnlyConfig): ScopedSymbolGraph {
    let filteredNodes = [...graph.nodes];
    let filteredEdges = [...graph.edges];

    // Filter out test files if not included
    if (!config.includeTests) {
      const testPaths = new Set(
        filteredNodes
          .filter(node => this.isTestFile(node.path))
          .map(node => node.id)
      );

      filteredNodes = filteredNodes.filter(node => !testPaths.has(node.id));
      filteredEdges = filteredEdges.filter(edge =>
        !testPaths.has(edge.from) && !testPaths.has(edge.to)
      );
    }

    // Filter out documentation files if not included
    if (!config.includeDocs) {
      const docPaths = new Set(
        filteredNodes
          .filter(node => this.isDocFile(node.path))
          .map(node => node.id)
      );

      filteredNodes = filteredNodes.filter(node => !docPaths.has(node.id));
      filteredEdges = filteredEdges.filter(edge =>
        !docPaths.has(edge.from) && !docPaths.has(edge.to)
      );
    }

    // Ensure deterministic ordering
    filteredNodes.sort((a, b) => a.id.localeCompare(b.id));
    filteredEdges.sort((a, b) => {
      const fromCmp = a.from.localeCompare(b.from);
      if (fromCmp !== 0) return fromCmp;
      return a.to.localeCompare(b.to);
    });

    return {
      ...graph,
      nodes: filteredNodes,
      edges: filteredEdges,
    };
  }

  /**
   * Calculate statistics for the index
   */
  private calculateStats(graph: ScopedSymbolGraph, resolution: SeedResolutionResult) {
    const totalNodes = graph.nodes.length;
    const totalEdges = graph.edges.length;

    // Calculate depth from seed using BFS
    let depthFromSeed = 0;
    if (resolution.success && graph.seedNodeId) {
      depthFromSeed = this.calculateMaxDepthFromSeed(graph);
    }

    // Calculate emitted metrics
    const filesEmitted = new Set(graph.nodes.map(n => n.path)).size;
    const locEmitted = 0; // Will be calculated if code bodies included
    const bytesEmitted = JSON.stringify(graph).length;
    const depthUsed = depthFromSeed;
    const truncated = (graph as any)._truncated || false;

    return {
      totalNodes,
      totalEdges,
      depthFromSeed,
      filesEmitted,
      locEmitted,
      bytesEmitted,
      depthUsed,
      truncated,
    };
  }

  /**
   * Calculate maximum depth from seed node
   */
  private calculateMaxDepthFromSeed(graph: ScopedSymbolGraph): number {
    const { nodes, edges, seedNodeId } = graph;

    if (!seedNodeId || !nodes.find(n => n.id === seedNodeId)) {
      return 0;
    }

    // Build adjacency list
    const adjacencyList = new Map<string, string[]>();
    for (const edge of edges) {
      if (!adjacencyList.has(edge.from)) {
        adjacencyList.set(edge.from, []);
      }
      adjacencyList.get(edge.from)!.push(edge.to);
    }

    // BFS to find maximum depth
    const visited = new Set<string>();
    const queue: Array<{ nodeId: string; depth: number }> = [{ nodeId: seedNodeId, depth: 0 }];
    let maxDepth = 0;

    while (queue.length > 0) {
      const { nodeId, depth } = queue.shift()!;

      if (visited.has(nodeId)) continue;
      visited.add(nodeId);

      maxDepth = Math.max(maxDepth, depth);

      const neighbors = adjacencyList.get(nodeId) || [];
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          queue.push({ nodeId: neighbor, depth: depth + 1 });
        }
      }
    }

    return maxDepth;
  }

  /**
   * Check if file is a test file
   */
  private isTestFile(filePath: string): boolean {
    const testPatterns = [
      /\.test\./,
      /\.spec\./,
      /\/__tests__\//,
      /\/tests?\//,
      /\.stories\./,
    ];

    return testPatterns.some(pattern => pattern.test(filePath));
  }

  /**
   * Check if file is a documentation file
   */
  private isDocFile(filePath: string): boolean {
    const docPatterns = [
      /\.md$/,
      /\.mdx$/,
      /\/docs?\//,
      /\/documentation\//,
      /README/i,
      /CHANGELOG/i,
    ];

    return docPatterns.some(pattern => pattern.test(filePath));
  }

  /**
   * Build symbol graph with BFS-based budget enforcement
   */
  private async buildBudgetedSymbolGraph(
    resolution: SeedResolutionResult,
    config: PlanOnlyConfig
  ): Promise<ScopedSymbolGraph> {
    const maxDepth = config.maxDepth ?? 2;
    const maxFiles = config.maxFiles ?? 50;
    const maxBytes = config.maxBytes ?? 500000;
    const maxLoc = config.maxLoc ?? 10000;

    // Build full graph first
    const fullGraph = await this.symbolResolver.buildSymbolGraph(
      resolution,
      Math.min(maxDepth + 1, 5) // Build slightly more than needed
    );

    // Apply BFS traversal with budget enforcement
    const visited = new Set<string>();
    const queue: Array<{ nodeId: string; depth: number }> = [];
    const includedNodes: ScopedSymbolNode[] = [];
    const includedEdges: ScopedSymbolEdge[] = [];
    const filesInScope = new Set<string>();
    let currentBytes = 0;
    let truncated = false;

    // Start with seed node
    queue.push({ nodeId: fullGraph.seedNodeId, depth: 0 });

    // Build adjacency list for efficient traversal
    const adjacency = new Map<string, string[]>();
    for (const edge of fullGraph.edges) {
      if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
      adjacency.get(edge.from)!.push(edge.to);
    }

    // BFS traversal with budget checks
    while (queue.length > 0) {
      const { nodeId, depth } = queue.shift()!;

      if (visited.has(nodeId)) continue;
      if (depth > maxDepth) {
        truncated = true;
        continue;
      }

      const node = fullGraph.nodes.find(n => n.id === nodeId);
      if (!node) continue;

      // Check file budget
      if (!filesInScope.has(node.path)) {
        if (filesInScope.size >= maxFiles) {
          truncated = true;
          continue;
        }
        filesInScope.add(node.path);
      }

      // Check byte budget (rough estimate)
      const nodeBytes = JSON.stringify(node).length;
      if (currentBytes + nodeBytes > maxBytes) {
        truncated = true;
        continue;
      }

      // Add node
      visited.add(nodeId);
      includedNodes.push(node);
      currentBytes += nodeBytes;

      // Add edges from this node
      const neighbors = adjacency.get(nodeId) || [];
      for (const neighbor of neighbors) {
        const edge = fullGraph.edges.find(
          e => e.from === nodeId && e.to === neighbor
        );
        if (edge && !includedEdges.some(e => e.from === edge.from && e.to === edge.to)) {
          includedEdges.push(edge);
        }

        // Queue neighbor for next depth
        if (!visited.has(neighbor)) {
          queue.push({ nodeId: neighbor, depth: depth + 1 });
        }
      }
    }

    // Sort for determinism
    includedNodes.sort((a: ScopedSymbolNode, b: ScopedSymbolNode) => a.id.localeCompare(b.id));
    includedEdges.sort((a: ScopedSymbolEdge, b: ScopedSymbolEdge) => {
      const fromCmp = a.from.localeCompare(b.from);
      return fromCmp !== 0 ? fromCmp : a.to.localeCompare(b.to);
    });

    const result: ScopedSymbolGraph & { _truncated?: boolean } = {
      nodes: includedNodes,
      edges: includedEdges,
      seedNodeId: fullGraph.seedNodeId,
      generatedAt: fullGraph.generatedAt,
    };

    if (truncated) {
      result._truncated = true;
    }

    return result;
  }
}
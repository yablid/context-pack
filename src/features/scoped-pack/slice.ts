import type {
  ScopedSymbolGraph,
  ScopedSymbolNode,
  ScopedSymbolEdge,
  PlanOnlyConfig,
  SeedResolutionResult
} from '../../core/contracts/scoped.js';
import type { ScopedPackPlan } from './plan.js';

export interface ScopedSliceResult {
  symbolGraph: ScopedSymbolGraph;
  truncated: boolean;
  filesInScope: Set<string>;
  totalBytes: number;
}

/**
 * Slicing phase for scoped pack generation
 * Handles symbol graph building, filtering, and budget enforcement
 */
export class ScopedPackSlicer {
  private plan: ScopedPackPlan;

  constructor(plan: ScopedPackPlan) {
    this.plan = plan;
  }

  /**
   * Build and filter symbol graph based on configuration
   */
  async slice(): Promise<ScopedSliceResult> {
    let symbolGraph: ScopedSymbolGraph;
    let truncated = false;
    let filesInScope = new Set<string>();
    let totalBytes = 0;

    if (this.plan.resolution.success) {
      // Build symbol graph with budget enforcement
      const result = await this.buildBudgetedSymbolGraph(
        this.plan.resolution,
        this.plan.config
      );

      symbolGraph = result.graph;
      truncated = result.truncated;
      filesInScope = result.filesInScope;
      totalBytes = result.totalBytes;

      // Apply filters based on config
      symbolGraph = this.applyFilters(symbolGraph, this.plan.config);
    } else {
      // Create empty graph for failed resolution
      symbolGraph = {
        nodes: [],
        edges: [],
        seedNodeId: '',
        generatedAt: new Date().toISOString(),
      };
    }

    return {
      symbolGraph,
      truncated,
      filesInScope,
      totalBytes
    };
  }

  /**
   * Build symbol graph with BFS-based budget enforcement
   */
  private async buildBudgetedSymbolGraph(
    resolution: SeedResolutionResult,
    config: PlanOnlyConfig
  ): Promise<{
    graph: ScopedSymbolGraph;
    truncated: boolean;
    filesInScope: Set<string>;
    totalBytes: number;
  }> {
    const maxDepth = config.maxDepth ?? 2;
    const maxFiles = config.maxFiles ?? 50;
    const maxBytes = config.maxBytes ?? 500000;

    // Build full graph first
    const fullGraph = await this.plan.symbolResolver.buildSymbolGraph(
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

    const graph: ScopedSymbolGraph = {
      nodes: includedNodes,
      edges: includedEdges,
      seedNodeId: fullGraph.seedNodeId,
      generatedAt: fullGraph.generatedAt,
    };

    return {
      graph,
      truncated,
      filesInScope,
      totalBytes: currentBytes
    };
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
}
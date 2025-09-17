import type {
  ScopedIndex,
  ScopedSymbolGraph,
  SeedResolutionResult,
  ScopedConfig,
  PasteConfig
} from '../../core/contracts/scoped.js';
import type { FileInfo } from '../../core/types.js';
import type { ScopedPackPlan } from './plan.js';
import type { ScopedSliceResult } from './slice.js';
import { PasteFormatter, type PasteResult } from './paste-formatter.js';

export interface ScopedPackEmitResult {
  index?: ScopedIndex;
  pasteResult?: PasteResult;
  pasteString?: string;
}

/**
 * Output generation phase for scoped pack generation
 * Handles statistics calculation, formatting, and output generation
 */
export class ScopedPackEmitter {
  private plan: ScopedPackPlan;
  private sliceResult: ScopedSliceResult;
  private pasteFormatter: PasteFormatter;

  constructor(plan: ScopedPackPlan, sliceResult: ScopedSliceResult) {
    this.plan = plan;
    this.sliceResult = sliceResult;
    this.pasteFormatter = new PasteFormatter(plan.rootPath);
  }

  /**
   * Generate index output
   */
  async generateIndex(): Promise<ScopedIndex> {
    // Calculate stats
    const stats = this.calculateStats(this.sliceResult.symbolGraph, this.plan.resolution);

    return {
      seed: this.plan.config.seed,
      resolution: this.plan.resolution,
      symbolGraph: this.sliceResult.symbolGraph,
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
    const index = await this.generateIndex();

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
   * Generate comprehensive output based on configuration
   */
  async emit(scopedConfig?: ScopedConfig, files?: FileInfo[]): Promise<ScopedPackEmitResult> {
    const result: ScopedPackEmitResult = {};

    // Always generate index
    result.index = await this.generateIndex();

    // Generate paste outputs if requested
    if (scopedConfig?.paste && files) {
      result.pasteResult = await this.generatePaste(scopedConfig, files);
      result.pasteString = await this.generatePasteString(scopedConfig, files);
    }

    return result;
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
    const truncated = this.sliceResult.truncated;

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
   * Format statistics for display
   */
  formatStats() {
    const stats = this.calculateStats(this.sliceResult.symbolGraph, this.plan.resolution);

    return {
      summary: `${stats.totalNodes} symbols across ${stats.filesEmitted} files (depth: ${stats.depthUsed})`,
      details: {
        nodes: stats.totalNodes,
        edges: stats.totalEdges,
        files: stats.filesEmitted,
        bytes: stats.bytesEmitted,
        depth: stats.depthUsed,
        truncated: stats.truncated
      }
    };
  }

  /**
   * Get performance metrics
   */
  getPerformanceMetrics() {
    return {
      filesInScope: this.sliceResult.filesInScope.size,
      totalBytes: this.sliceResult.totalBytes,
      truncated: this.sliceResult.truncated,
      symbolGraph: {
        nodes: this.sliceResult.symbolGraph.nodes.length,
        edges: this.sliceResult.symbolGraph.edges.length
      }
    };
  }
}
import type { TsProgramService, SymbolReference, SymbolEdge, EdgeType } from '../../core/ts-program/service.js';

export interface GraphNode {
  id: string;
  symbol: SymbolReference;
  included: boolean;
  reasons: string[];
  distance: number; // Distance from seed node
}

export interface DependencyGraph {
  nodes: GraphNode[];
  edges: SymbolEdge[];
  seedNode: GraphNode;
  stats: {
    totalNodes: number;
    totalEdges: number;
    maxDepth: number;
    filesTouched: number;
    externalPackages: string[];
  };
}

export interface GraphBuilderConfig {
  includeTests: boolean;
  includeDocs: boolean;
  maxDepth: number;
  maxFiles: number;
}

/**
 * GraphBuilder constructs a symbol dependency graph starting from a seed symbol
 * Uses TypeScript APIs to find references, type dependencies, and call relationships
 */
export class GraphBuilder {
  private tsProgramService: TsProgramService;
  private config: GraphBuilderConfig;

  constructor(tsProgramService: TsProgramService, config: GraphBuilderConfig) {
    this.tsProgramService = tsProgramService;
    this.config = config;
  }

  /**
   * Build dependency graph starting from seed symbol
   */
  async buildGraph(seedRef: SymbolReference): Promise<DependencyGraph> {
    const nodes = new Map<string, GraphNode>();
    const edges: SymbolEdge[] = [];
    const visited = new Set<string>();
    const queue: Array<{ ref: SymbolReference; distance: number; reason: string }> = [];

    // Create seed node
    const seedId = this.createSymbolId(seedRef);
    const seedNode: GraphNode = {
      id: seedId,
      symbol: seedRef,
      included: true,
      reasons: ['seed'],
      distance: 0
    };
    nodes.set(seedId, seedNode);

    // Start BFS from seed
    queue.push({ ref: seedRef, distance: 0, reason: 'seed' });

    const filesTouched = new Set<string>();
    const externalPackages = new Set<string>();

    while (queue.length > 0 && nodes.size < 1000) { // Safety limit
      const { ref, distance, reason } = queue.shift()!;
      const nodeId = this.createSymbolId(ref);

      if (visited.has(nodeId) || distance >= this.config.maxDepth) {
        continue;
      }
      visited.add(nodeId);

      // Track file usage
      filesTouched.add(ref.fqn.path);

      // Skip if we've hit file limit
      if (filesTouched.size > this.config.maxFiles) {
        break;
      }

      // Skip test files if not included
      if (!this.config.includeTests && this.isTestFile(ref.fqn.path)) {
        continue;
      }

      // Skip doc files if not included
      if (!this.config.includeDocs && this.isDocFile(ref.fqn.path)) {
        continue;
      }

      // Ensure node exists
      if (!nodes.has(nodeId)) {
        nodes.set(nodeId, {
          id: nodeId,
          symbol: ref,
          included: false, // Will be determined by ranker
          reasons: [reason],
          distance
        });
      }

      try {
        // Find type dependencies
        const typeEdges = this.tsProgramService.getTypeRefs(ref);
        for (const edge of typeEdges) {
          edges.push(edge);
          await this.enqueueTarget(edge.to, distance + 1, `typeRef:${edge.reason}`, queue, nodes);
        }

        // Find call dependencies
        const callEdges = this.tsProgramService.getCallGraphEdges(ref);
        for (const edge of callEdges) {
          edges.push(edge);
          await this.enqueueTarget(edge.to, distance + 1, `call:${edge.reason}`, queue, nodes);
        }

        // Find references (incoming edges)
        const references = this.tsProgramService.findReferences(ref);
        for (const refSymbol of references) {
          const refId = this.createSymbolId(refSymbol);
          if (!visited.has(refId)) {
            edges.push({
              from: refSymbol.fqn,
              to: ref.fqn,
              type: 'calls', // Assume it's a call relationship for references
              weight: 2.0,
              reason: 'referenced-by'
            });
            queue.push({ ref: refSymbol, distance: distance + 1, reason: 'referenced-by' });
          }
        }

        // Same-file siblings (other symbols in same file)
        await this.addSameFileSiblings(ref, distance + 1, queue, nodes, edges);

      } catch (error) {
        // Continue on errors - some symbols may not be analyzable
        console.warn(`Error analyzing symbol ${nodeId}:`, error);
      }
    }

    // Calculate stats
    const stats = {
      totalNodes: nodes.size,
      totalEdges: edges.length,
      maxDepth: Math.max(...Array.from(nodes.values()).map(n => n.distance)),
      filesTouched: filesTouched.size,
      externalPackages: Array.from(externalPackages).sort()
    };

    return {
      nodes: Array.from(nodes.values()).sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id)),
      edges: this.deduplicateEdges(edges),
      seedNode,
      stats
    };
  }

  private async enqueueTarget(
    targetFqn: any, // FQN from ts-program-service
    distance: number,
    reason: string,
    queue: Array<{ ref: SymbolReference; distance: number; reason: string }>,
    nodes: Map<string, GraphNode>
  ): Promise<void> {
    // Try to resolve the target FQN to a symbol reference
    try {
      const targetRef = this.tsProgramService.resolveFqnToNode(targetFqn);
      if (targetRef) {
        const targetId = this.createSymbolId(targetRef);

        // Add to queue if not already processed
        if (!nodes.has(targetId)) {
          queue.push({ ref: targetRef, distance, reason });
        } else {
          // Update existing node's reasons
          const existingNode = nodes.get(targetId)!;
          if (!existingNode.reasons.includes(reason)) {
            existingNode.reasons.push(reason);
          }
        }
      }
    } catch {
      // Ignore unresolvable targets (external symbols, etc.)
    }
  }

  private async addSameFileSiblings(
    ref: SymbolReference,
    distance: number,
    queue: Array<{ ref: SymbolReference; distance: number; reason: string }>,
    nodes: Map<string, GraphNode>,
    edges: SymbolEdge[]
  ): Promise<void> {
    // This is a simplified implementation - in practice, we'd walk the AST
    // to find all exported symbols in the same file

    // For now, we'll skip this to keep complexity manageable
    // In a full implementation, we would:
    // 1. Get all symbols from the source file
    // 2. Filter to public exports
    // 3. Add edges with 'sameFileSibling' type
    // 4. Enqueue them for processing
  }

  private createSymbolId(ref: SymbolReference): string {
    // Create a deterministic ID for the symbol
    const location = ref.fqn.line && ref.fqn.column
      ? `@${ref.fqn.line}:${ref.fqn.column}`
      : '';
    return `${ref.fqn.path}#${ref.fqn.symbol}${location}`;
  }

  private isTestFile(path: string): boolean {
    return path.includes('.test.') ||
           path.includes('.spec.') ||
           path.includes('/__tests__/') ||
           path.includes('/test/') ||
           path.includes('/tests/');
  }

  private isDocFile(path: string): boolean {
    return path.endsWith('.md') ||
           path.includes('/docs/') ||
           path.includes('/documentation/');
  }

  private deduplicateEdges(edges: SymbolEdge[]): SymbolEdge[] {
    const seen = new Set<string>();
    const deduplicated: SymbolEdge[] = [];

    for (const edge of edges) {
      const key = `${edge.from.path}#${edge.from.symbol}=>${edge.to.path}#${edge.to.symbol}:${edge.type}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduplicated.push(edge);
      }
    }

    return deduplicated.sort((a, b) => {
      const fromCmp = `${a.from.path}#${a.from.symbol}`.localeCompare(`${b.from.path}#${b.from.symbol}`);
      if (fromCmp !== 0) return fromCmp;
      const toCmp = `${a.to.path}#${a.to.symbol}`.localeCompare(`${b.to.path}#${b.to.symbol}`);
      if (toCmp !== 0) return toCmp;
      return a.type.localeCompare(b.type);
    });
  }
}
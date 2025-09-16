import type { DependencyGraph, GraphNode } from './graph-builder.js';
import type { SymbolReference } from '../engine/ts-program-service.js';
import { TokenCounter } from '../utils/token-counter.js';

export interface RankedNode extends GraphNode {
  rank: number;
  score: number;
  withinBudget: boolean;
  tokenEstimate: number;
}

export interface RankerConfig {
  budgetTokens: number;
  globalBudgetBytes: number;
  weights: Record<string, number>;
}

export interface RankingResult {
  nodes: RankedNode[];
  stats: {
    totalNodes: number;
    includedNodes: number;
    budgetExhausted: boolean;
    maxDepthReached: boolean;
    tokensUsed: number;
    bytesUsed: number;
  };
}

/**
 * Ranker performs weighted BFS ranking of symbols in dependency graph
 * Enforces token and byte budget constraints
 */
export class Ranker {
  private config: RankerConfig;

  constructor(config: RankerConfig) {
    this.config = config;
  }

  /**
   * Rank nodes using weighted BFS with budget enforcement
   */
  async rankNodes(graph: DependencyGraph, seedRef: SymbolReference): Promise<RankingResult> {
    // Initialize priority queue with seed node
    const queue: Array<{ node: GraphNode; score: number }> = [];
    const processed = new Set<string>();
    const rankedNodes: RankedNode[] = [];

    // Find seed node in graph
    const seedNode = graph.nodes.find(n => n.id === this.createSymbolId(seedRef));
    if (!seedNode) {
      throw new Error('Seed node not found in graph');
    }

    // Start with seed node (highest priority)
    queue.push({ node: seedNode, score: 1000.0 });

    let tokensUsed = 0;
    let bytesUsed = 0;
    let budgetExhausted = false;
    let rank = 0;

    // Process queue in priority order
    while (queue.length > 0 && !budgetExhausted) {
      // Sort queue by score (highest first)
      queue.sort((a, b) => b.score - a.score);

      const { node, score } = queue.shift()!;

      if (processed.has(node.id)) {
        continue;
      }
      processed.add(node.id);

      // Estimate token cost for this node
      const tokenEstimate = await this.estimateNodeTokens(node);

      // Check if we can afford this node
      const wouldExceedTokens = tokensUsed + tokenEstimate > this.config.budgetTokens;
      const wouldExceedBytes = bytesUsed + (tokenEstimate * 4) > this.config.globalBudgetBytes;

      const withinBudget = !wouldExceedTokens && !wouldExceedBytes;

      if (!withinBudget && node.id !== seedNode.id) {
        // Budget exhausted, but always include seed
        budgetExhausted = true;
      }

      const rankedNode: RankedNode = {
        ...node,
        rank: rank++,
        score,
        withinBudget,
        tokenEstimate,
        included: withinBudget || node.id === seedNode.id // Always include seed
      };

      rankedNodes.push(rankedNode);

      if (rankedNode.included) {
        tokensUsed += tokenEstimate;
        bytesUsed += tokenEstimate * 4; // Rough bytes estimate
      }

      // Add outgoing edges to queue if we haven't exceeded budget
      if (!budgetExhausted) {
        await this.enqueueOutgoingEdges(node, graph, queue, processed);
      }
    }

    const stats = {
      totalNodes: graph.nodes.length,
      includedNodes: rankedNodes.filter(n => n.included).length,
      budgetExhausted,
      maxDepthReached: false, // TODO: implement depth checking
      tokensUsed,
      bytesUsed
    };

    // Sort final results by rank
    rankedNodes.sort((a, b) => a.rank - b.rank);

    return { nodes: rankedNodes, stats };
  }

  private async enqueueOutgoingEdges(
    node: GraphNode,
    graph: DependencyGraph,
    queue: Array<{ node: GraphNode; score: number }>,
    processed: Set<string>
  ): Promise<void> {
    // Find edges from this node
    const outgoingEdges = graph.edges.filter(edge =>
      this.createSymbolId(node.symbol) === `${edge.from.path}#${edge.from.symbol}`
    );

    for (const edge of outgoingEdges) {
      // Find target node
      const targetId = `${edge.to.path}#${edge.to.symbol}`;
      const targetNode = graph.nodes.find(n => n.id === targetId);

      if (targetNode && !processed.has(targetNode.id)) {
        // Calculate edge-weighted score
        const edgeWeight = this.config.weights[edge.type] || 1.0;
        const distancePenalty = Math.pow(0.8, targetNode.distance); // Decay by distance
        const newScore = edgeWeight * distancePenalty;

        // Add to queue if not already queued with higher score
        const existingIndex = queue.findIndex(item => item.node.id === targetNode.id);
        if (existingIndex >= 0) {
          if (queue[existingIndex].score < newScore) {
            queue[existingIndex].score = newScore;
          }
        } else {
          queue.push({ node: targetNode, score: newScore });
        }
      }
    }
  }

  private async estimateNodeTokens(node: GraphNode): Promise<number> {
    // Rough estimation based on symbol type and complexity
    // In practice, we'd need to look at the actual code to be more accurate

    // Base token count by symbol type
    const baseTokens = this.getBaseTokensBySymbolType(node.symbol.fqn.symbol);

    // Adjust for distance (closer symbols likely more relevant, may be larger)
    const distanceMultiplier = node.distance === 0 ? 1.5 : Math.max(0.5, 1.0 - (node.distance * 0.1));

    return Math.round(baseTokens * distanceMultiplier);
  }

  private getBaseTokensBySymbolType(symbolName: string): number {
    // Heuristic token estimates based on common patterns

    // Interfaces and types tend to be smaller
    if (symbolName.startsWith('I') && symbolName[1]?.toUpperCase() === symbolName[1]) {
      return 50; // Interface
    }

    // Classes tend to be larger
    if (symbolName[0]?.toUpperCase() === symbolName[0]) {
      return 200; // Class (assuming PascalCase)
    }

    // Functions
    if (symbolName.includes('create') || symbolName.includes('build') || symbolName.includes('generate')) {
      return 150; // Likely complex functions
    }

    // Default
    return 100;
  }

  private createSymbolId(ref: SymbolReference): string {
    const location = ref.fqn.line && ref.fqn.column
      ? `@${ref.fqn.line}:${ref.fqn.column}`
      : '';
    return `${ref.fqn.path}#${ref.fqn.symbol}${location}`;
  }
}
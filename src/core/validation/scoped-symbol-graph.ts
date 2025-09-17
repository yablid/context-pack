import { z } from 'zod';

/**
 * Schema for scoped/10-symbol-graph.json - Nodes and edges for the scoped dependency graph
 */
export const ScopedSymbolGraphSchema = z.object({
  /** Symbol nodes in the dependency graph */
  nodes: z.array(z.object({
    /** Unique symbol identifier */
    id: z.string(),
    /** Symbol kind */
    kind: z.enum([
      'function', 'class', 'interface', 'type', 'enum', 'var', 'const',
      'method', 'property', 'constructor', 'getter', 'setter',
      'namespace', 'module', 'default'
    ] as const),
    /** File path relative to project root */
    path: z.string(),
    /** Symbol name */
    name: z.string(),
    /** Line number in source file */
    line: z.number().int().positive().optional(),
    /** Column number in source file */
    column: z.number().int().nonnegative().optional(),
    /** Whether this is an external symbol (from node_modules) */
    isExternal: z.boolean().optional(),
    /** Package name for external symbols */
    package: z.string().optional(),
    /** Whether this symbol was included in slices */
    included: z.boolean(),
    /** Reason for inclusion/exclusion */
    reason: z.array(z.string()),
    /** Additional metadata */
    meta: z.record(z.string(), z.unknown()).optional()
  })),

  /** Dependency edges between symbols */
  edges: z.array(z.object({
    /** Source symbol ID */
    from: z.string(),
    /** Target symbol ID */
    to: z.string(),
    /** Edge type */
    type: z.enum([
      'calls', 'isCalledBy', 'typeRef', 'extends', 'implements',
      'imports', 'sameFileSibling', 'testCovers', 'docMentions'
    ] as const),
    /** Edge weight for ranking */
    weight: z.number().positive(),
    /** Reason for this edge */
    reason: z.string(),
    /** Optional metadata */
    meta: z.record(z.string(), z.unknown()).optional()
  })),

  /** Graph ranking configuration */
  ranking: z.object({
    /** Ranking algorithm used */
    algorithm: z.enum(['weighted-bfs', 'pagerank', 'manual'] as const),
    /** Maximum graph depth explored */
    maxDepth: z.number().int().positive(),
    /** Edge weight configuration version */
    weights: z.record(z.string(), z.number().positive()),
    /** Stop conditions that were applied */
    stopConditions: z.object({
      /** Token budget exhausted */
      budgetExhausted: z.boolean(),
      /** Maximum depth reached */
      maxDepthReached: z.boolean(),
      /** Maximum files limit reached */
      maxFilesReached: z.boolean(),
      /** Manual stop condition */
      manual: z.boolean()
    })
  }),

  /** Graph statistics */
  stats: z.object({
    /** Total nodes discovered */
    totalNodes: z.number().int().nonnegative(),
    /** Total edges discovered */
    totalEdges: z.number().int().nonnegative(),
    /** Nodes included in output */
    includedNodes: z.number().int().nonnegative(),
    /** Nodes converted to stubs */
    stubbedNodes: z.number().int().nonnegative(),
    /** Files touched */
    filesTouched: z.number().int().nonnegative(),
    /** External packages referenced */
    externalPackages: z.array(z.string()),
    /** Whether the graph contains cycles */
    hasCycles: z.boolean(),
    /** Strongly connected component count */
    sccCount: z.number().int().nonnegative().optional()
  })
});

export type ScopedSymbolGraph = z.infer<typeof ScopedSymbolGraphSchema>;
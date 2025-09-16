import { z } from 'zod';

/**
 * Schema for scoped/00-scope.json - Scope metadata and reproducibility
 */
export const ScopedScopeSchema = z.object({
  /** Specification version for scoped packs */
  specVersion: z.literal('1'),

  /** Original seed FQN string */
  seed: z.string(),

  /** Git commit hash for reproducibility */
  commit: z.string().optional(),

  /** Git branch */
  branch: z.string().optional(),

  /** Whether git working directory was dirty */
  isDirty: z.boolean().optional(),

  /** Scoped analysis mode */
  mode: z.enum(['static', 'hybrid'] as const),

  /** Budget constraints applied */
  budgets: z.object({
    /** Token budget for slices */
    tokens: z.number().int().positive(),
    /** Global byte budget (inherited from main pack) */
    bytes: z.number().int().positive()
  }),

  /** Policy settings */
  policy: z.object({
    /** Whether test files were included */
    includeTests: z.boolean(),
    /** Whether documentation files were included */
    includeDocs: z.boolean(),
    /** Whether types were preferred over implementations */
    preferTypes: z.boolean(),
    /** Whether code bodies were allowed to be emitted */
    allowCodeBodies: z.boolean()
  }),

  /** Determinism versioning */
  determinism: z.object({
    /** Edge weight algorithm version */
    edgeWeights: z.string(),
    /** Sorting algorithm version */
    sort: z.string()
  }),

  /** Analysis results summary */
  results: z.object({
    /** Total symbols discovered */
    totalSymbols: z.number().int().nonnegative(),
    /** Symbols included in final output */
    includedSymbols: z.number().int().nonnegative(),
    /** Symbols excluded due to budget constraints */
    budgetExceeded: z.number().int().nonnegative(),
    /** Symbols converted to stubs */
    stubbed: z.number().int().nonnegative(),
    /** Total files touched */
    totalFiles: z.number().int().nonnegative(),
    /** Maximum graph depth reached */
    maxDepth: z.number().int().nonnegative()
  }),

  /** Optional dynamic analysis results (for hybrid mode) */
  dynamic: z.object({
    /** Command used to gather coverage */
    command: z.string(),
    /** Coverage percentage achieved */
    coverage: z.number().min(0).max(100),
    /** Additional symbols discovered through execution */
    dynamicSymbols: z.number().int().nonnegative()
  }).optional(),

  /** Additional metadata */
  meta: z.record(z.string(), z.unknown()).optional()
});

export type ScopedScope = z.infer<typeof ScopedScopeSchema>;
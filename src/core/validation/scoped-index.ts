import { z } from 'zod';

/**
 * Schema for scoped/40-index.ndjson - Symbol to slice mapping with rationale
 * Each line is a JSON object representing the mapping for one symbol
 */
export const ScopedIndexEntrySchema = z.object({
  /** Symbol identifier */
  symbol: z.string(),

  /** Symbol name (human-readable) */
  name: z.string(),

  /** Symbol kind */
  kind: z.enum([
    'function', 'class', 'interface', 'type', 'enum', 'var', 'const',
    'method', 'property', 'constructor', 'getter', 'setter',
    'namespace', 'module', 'default'
  ] as const),

  /** File path where symbol is defined */
  path: z.string(),

  /** Whether this symbol was included in slices */
  included: z.boolean(),

  /** Slices that contain this symbol */
  slices: z.array(z.object({
    /** File path of the slice */
    path: z.string(),
    /** Start line of slice */
    start: z.number().int().positive(),
    /** End line of slice */
    end: z.number().int().positive(),
    /** Whether this is the primary slice for this symbol */
    primary: z.boolean().optional()
  })),

  /** Reasons why this symbol was included/excluded */
  reasons: z.array(z.string()),

  /** Graph ranking information */
  ranking: z.object({
    /** Distance from seed symbol */
    distance: z.number().int().nonnegative(),
    /** Final ranking score */
    score: z.number(),
    /** Whether included due to budget constraints */
    withinBudget: z.boolean()
  }),

  /** Dependencies (outgoing edges) */
  dependencies: z.array(z.object({
    /** Target symbol ID */
    target: z.string(),
    /** Edge type */
    type: z.string(),
    /** Edge weight */
    weight: z.number()
  })).optional(),

  /** Dependents (incoming edges) */
  dependents: z.array(z.object({
    /** Source symbol ID */
    source: z.string(),
    /** Edge type */
    type: z.string(),
    /** Edge weight */
    weight: z.number()
  })).optional(),

  /** External package information (for external symbols) */
  external: z.object({
    /** Package name */
    package: z.string(),
    /** Import specifier used */
    specifier: z.string(),
    /** Whether this was stubbed */
    stubbed: z.boolean()
  }).optional(),

  /** Token count estimate for this symbol's slices */
  tokens: z.object({
    conservative: z.number().int().nonnegative(),
    optimistic: z.number().int().nonnegative(),
    average: z.number().int().nonnegative()
  }).optional(),

  /** Additional metadata */
  meta: z.record(z.string(), z.unknown()).optional()
});

export type ScopedIndexEntry = z.infer<typeof ScopedIndexEntrySchema>;

/**
 * Schema for the entire NDJSON file (array of entries for validation)
 */
export const ScopedIndexSchema = z.array(ScopedIndexEntrySchema);
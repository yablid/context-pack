import { z } from 'zod';

/**
 * Schema for scoped/20-slices.ndjson - Code ranges with optional bodies
 * Each line is a JSON object representing one code slice
 */
export const ScopedSliceSchema = z.object({
  /** File path relative to project root (POSIX style) */
  path: z.string(),

  /** Start line number (1-based) */
  startLine: z.number().int().positive(),

  /** End line number (1-based, inclusive) */
  endLine: z.number().int().positive(),

  /** Start character offset in file (0-based) */
  startChar: z.number().int().nonnegative(),

  /** End character offset in file (0-based, exclusive) */
  endChar: z.number().int().nonnegative(),

  /** Reasons for including this slice */
  reasons: z.array(z.string()),

  /** Symbol ID that this slice represents */
  symbolId: z.string().optional(),

  /** Symbol name */
  symbolName: z.string().optional(),

  /** Symbol kind */
  symbolKind: z.string().optional(),

  /** JSDoc comment associated with this slice */
  doc: z.string().optional(),

  /** Code body (only present when allowCodeBodies is true) */
  body: z.string().optional(),

  /** Context lines included */
  context: z.object({
    /** Lines before the symbol */
    before: z.number().int().nonnegative(),
    /** Lines after the symbol */
    after: z.number().int().nonnegative()
  }),

  /** Whether this slice was merged with others */
  merged: z.boolean().optional(),

  /** Original slices that were merged into this one */
  mergedFrom: z.array(z.object({
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
    symbolId: z.string()
  })).optional(),

  /** Token count estimate for this slice */
  tokens: z.object({
    conservative: z.number().int().nonnegative(),
    optimistic: z.number().int().nonnegative(),
    average: z.number().int().nonnegative()
  }).optional(),

  /** Additional metadata */
  meta: z.record(z.string(), z.unknown()).optional()
});

export type ScopedSlice = z.infer<typeof ScopedSliceSchema>;

/**
 * Schema for the entire NDJSON file (array of slices for validation)
 */
export const ScopedSlicesSchema = z.array(ScopedSliceSchema);
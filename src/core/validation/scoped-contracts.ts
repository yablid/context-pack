/**
 * Zod schemas for scoped pack contracts - validation and type safety
 */

import { z } from 'zod';

// Seed Grammar Validation
export const SeedGrammarSchema = z.string().refine((value): value is `${string}#${string}` | `${string}:${number}:${number}` => {
  // path#symbol pattern
  if (value.includes('#') && !value.includes(':')) {
    const parts = value.split('#');
    return parts.length === 2 && parts[0].length > 0 && parts[1].length > 0;
  }

  // path:line:col pattern
  if (value.includes(':') && !value.includes('#')) {
    const parts = value.split(':');
    if (parts.length === 3) {
      const [path, line, col] = parts;
      const lineNum = parseInt(line, 10);
      const colNum = parseInt(col, 10);
      return path.length > 0 && !isNaN(lineNum) && !isNaN(colNum) && lineNum > 0 && colNum >= 0;
    }
  }

  return false;
}, {
  message: "Seed must be either 'path#symbol' or 'path:line:col' format"
});

export const SeedLocationSchema = z.object({
  path: z.string().min(1),
  type: z.enum(['symbol', 'location']),
  symbol: z.string().optional(),
  line: z.number().int().positive().optional(),
  column: z.number().int().min(0).optional(),
}).strict();

export const SeedResolutionDiagnosticSchema = z.object({
  code: z.enum(['SEED_NOT_FOUND', 'MULTIPLE_DECLARATIONS', 'AMBIENT_TYPE', 'PROJECT_REFERENCE', 'REEXPORTED_SYMBOL', 'INVALID_GRAMMAR']),
  message: z.string(),
  path: z.string().optional(),
  symbol: z.string().optional(),
  alternatives: z.array(z.string()).readonly().optional(),
}).strict();

export const SeedResolutionResultSchema = z.object({
  seed: SeedGrammarSchema,
  success: z.boolean(),
  location: SeedLocationSchema.optional(),
  diagnostics: z.array(SeedResolutionDiagnosticSchema).readonly(),
}).strict();

export const ScopedSymbolNodeSchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  symbol: z.string().min(1),
  kind: z.enum(['class', 'interface', 'function', 'variable', 'type', 'enum', 'namespace']),
  line: z.number().int().positive().optional(),
  column: z.number().int().min(0).optional(),
  exported: z.boolean(),
}).strict();

export const ScopedSymbolEdgeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  type: z.enum(['imports', 'calls', 'extends', 'implements', 'references']),
  line: z.number().int().positive().optional(),
}).strict();

export const ScopedSymbolGraphSchema = z.object({
  nodes: z.array(ScopedSymbolNodeSchema).readonly(),
  edges: z.array(ScopedSymbolEdgeSchema).readonly(),
  seedNodeId: z.string(), // Empty string allowed for failed resolutions
  generatedAt: z.string().datetime(),
}).strict();

export const ScopedIndexSchema = z.object({
  seed: SeedGrammarSchema,
  resolution: SeedResolutionResultSchema,
  symbolGraph: ScopedSymbolGraphSchema,
  stats: z.object({
    totalNodes: z.number().int().min(0),
    totalEdges: z.number().int().min(0),
    depthFromSeed: z.number().int().min(0),
    filesEmitted: z.number().int().min(0),
    locEmitted: z.number().int().min(0),
    bytesEmitted: z.number().int().min(0),
    depthUsed: z.number().int().min(0),
    truncated: z.boolean(),
  }).strict(),
}).strict();

export const PlanOnlyConfigSchema = z.object({
  seed: SeedGrammarSchema,
  rootPath: z.string().min(1),
  maxDepth: z.number().int().positive().default(2),
  includeTests: z.boolean().default(false),
  includeDocs: z.boolean().default(false),
  includeNonExported: z.boolean().default(false),
  tsconfig: z.string().optional(),
  maxFiles: z.number().int().positive().default(50),
  maxLoc: z.number().int().positive().default(10000),
  maxBytes: z.number().int().positive().default(500000),
}).strict();

export const PasteConfigSchema = z.object({
  budgetTokens: z.number().int().positive(),
  budgetBytes: z.number().int().positive(),
  budgetFiles: z.number().int().positive().optional(),
  budgetLoc: z.number().int().positive().optional(),
  allowCodeBodies: z.boolean(),
  redactSecrets: z.boolean(),
}).strict();

export const ScopedConfigSchema = z.object({
  planOnly: PlanOnlyConfigSchema,
  paste: PasteConfigSchema.optional(),
}).strict();

// Schema registry update
export const SCOPED_SCHEMA_REGISTRY = {
  'scoped-seed-grammar': SeedGrammarSchema,
  'scoped-seed-location': SeedLocationSchema,
  'scoped-seed-resolution-result': SeedResolutionResultSchema,
  'scoped-symbol-node': ScopedSymbolNodeSchema,
  'scoped-symbol-edge': ScopedSymbolEdgeSchema,
  'scoped-symbol-graph': ScopedSymbolGraphSchema,
  'scoped-index': ScopedIndexSchema,
  'scoped-plan-only-config': PlanOnlyConfigSchema,
  'scoped-paste-config': PasteConfigSchema,
  'scoped-config': ScopedConfigSchema,
} as const;

// Type exports for external use
export type SeedGrammar = z.infer<typeof SeedGrammarSchema>;
export type SeedLocation = z.infer<typeof SeedLocationSchema>;
export type SeedResolutionDiagnostic = z.infer<typeof SeedResolutionDiagnosticSchema>;
export type SeedResolutionResult = z.infer<typeof SeedResolutionResultSchema>;
export type ScopedSymbolNode = z.infer<typeof ScopedSymbolNodeSchema>;
export type ScopedSymbolEdge = z.infer<typeof ScopedSymbolEdgeSchema>;
export type ScopedSymbolGraph = z.infer<typeof ScopedSymbolGraphSchema>;
export type ScopedIndex = z.infer<typeof ScopedIndexSchema>;
export type PlanOnlyConfig = z.infer<typeof PlanOnlyConfigSchema>;
export type PasteConfig = z.infer<typeof PasteConfigSchema>;
export type ScopedConfig = z.infer<typeof ScopedConfigSchema>;
import { z } from 'zod';

/**
 * Schema for scoped/30-stubs.d.ts - TypeScript declaration file
 * This is a text artifact, so we use a simple string schema with validation
 */
export const ScopedStubsSchema = z.string().refine(
  (content) => {
    // Basic validation that this looks like a TypeScript declaration file
    if (!content.trim()) {
      return true; // Allow empty stubs
    }

    // Check for basic TypeScript declaration syntax
    const hasValidSyntax =
      content.includes('declare') ||
      content.includes('export') ||
      content.includes('interface') ||
      content.includes('type') ||
      content.includes('namespace');

    if (!hasValidSyntax) {
      return false;
    }

    // Check for obvious syntax errors (very basic)
    const openBraces = (content.match(/{/g) || []).length;
    const closeBraces = (content.match(/}/g) || []).length;

    // Allow slight mismatch in case of incomplete stubs, but flag major issues
    const braceDiff = Math.abs(openBraces - closeBraces);
    if (braceDiff > 2) {
      return false;
    }

    return true;
  },
  {
    message: "Content does not appear to be valid TypeScript declarations"
  }
);

/**
 * Metadata schema for the stub generation process (not part of the file content)
 * This could be used internally for validation but isn't part of the actual artifact
 */
export const ScopedStubsMetaSchema = z.object({
  /** Number of external packages stubbed */
  externalPackages: z.number().int().nonnegative(),

  /** Number of internal symbols stubbed */
  internalSymbols: z.number().int().nonnegative(),

  /** List of stubbed packages */
  packages: z.array(z.string()),

  /** List of stubbed internal symbols */
  symbols: z.array(z.object({
    name: z.string(),
    kind: z.string(),
    path: z.string(),
    reason: z.string()
  })),

  /** Generation timestamp */
  generatedAt: z.string().datetime(),

  /** Whether stubs were tested for compilation */
  compilationTested: z.boolean(),

  /** TypeScript version used for stub generation */
  tsVersion: z.string().optional()
});

export type ScopedStubs = z.infer<typeof ScopedStubsSchema>;
export type ScopedStubsMeta = z.infer<typeof ScopedStubsMetaSchema>;
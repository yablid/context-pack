export type ErrorCategory =
  | 'FileSystem'
  | 'Validation'
  | 'Configuration'
  | 'Collector'
  | 'Engine'
  | 'Unknown';

export interface RegisteredCode {
  code: string;          // e.g., E102
  category: ErrorCategory;
  exitCode: number;
}

// Registry aligned with tests:
// - E102 => Path traversal (FileSystem) => exit 3
// - E202 => Collector timeout (Collector) => exit 5 (arbitrary, not asserted by tests)
// Other codes can be extended as needed.
export const CODE_REGISTRY: Record<string, RegisteredCode> = {
  E101: { code: 'E101', category: 'FileSystem', exitCode: 3 },
  E102: { code: 'E102', category: 'FileSystem', exitCode: 3 },
  E103: { code: 'E103', category: 'FileSystem', exitCode: 3 },
  E201: { code: 'E201', category: 'Collector', exitCode: 5 },
  E202: { code: 'E202', category: 'Collector', exitCode: 5 },
  E203: { code: 'E203', category: 'Collector', exitCode: 5 },
  E301: { code: 'E301', category: 'Engine', exitCode: 4 },
  E401: { code: 'E401', category: 'Validation', exitCode: 2 },
  E701: { code: 'E701', category: 'Validation', exitCode: 2 },
  E702: { code: 'E702', category: 'Validation', exitCode: 2 }
};

export function mapToRegisteredCode(e: { code?: string }): RegisteredCode {
  if (e.code && CODE_REGISTRY[e.code]) return CODE_REGISTRY[e.code];
  // Map common class names to expected codes
  const name = (e as any)?.name as string | undefined;
  if (name === 'PathTraversalError') return CODE_REGISTRY.E102;
  if (name === 'PermissionDeniedError') return CODE_REGISTRY.E103;
  if (name === 'CollectorTimeoutError') return CODE_REGISTRY.E202;
  if (name === 'BudgetError') return CODE_REGISTRY.E401;
  if (name === 'InvalidLevelError') return CODE_REGISTRY.E702;
  // Fallback
  return { code: e.code || 'E000', category: 'Unknown', exitCode: 1 };
}

export function exitCodeForCategory(category: ErrorCategory): number {
  switch (category) {
    case 'FileSystem': return 3;
    case 'Validation': return 2;
    default: return 1;
  }
}
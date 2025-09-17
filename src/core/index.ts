/**
 * Core module exports
 * Minimal barrel for frequently used types and utilities
 */

// Types
export type {
  Artifact,
  BuildConfig,
  FileInfo,
  CollectorHealth,
  IgnoreRules,
  PackMetadata
} from './types.js';

// IO
export { CanonicalJSON } from './io/canonical-json.js';

// Validation
export { schemaValidator } from './validation/schema-validator.js';
export type { ValidationResult, ValidationStats } from './validation/schema-validator.js';

// Security
export { validateInputPath, validateOutputPath, PathValidator } from './security/path-validator.js';
export { SecretRedactor } from './security/secret-redaction.js';

// Tokens
export { TokenCounter } from './tokens/token-counter.js';
export { BudgetManager } from './tokens/budget-manager.js';

// File system
export { FileWalker } from './walker/file-walker.js';

// TypeScript
export { TsProgramService } from './ts-program/service.js';
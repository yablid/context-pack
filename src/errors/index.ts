/**
 * Context Pack Error System
 * 
 * Provides structured error handling with error codes, categories, and recovery information.
 */

// Error code registry
export {
  CODE_REGISTRY,
  mapToRegisteredCode,
  exitCodeForCategory,
  type ErrorCategory,
  type RegisteredCode
} from './error-codes.js';

// Base errors and types
export {
  BaseError,
  type BaseErrorInit
} from './specific-errors.js';

// Specific error classes  
export {
  InvalidLevelError,
  InvalidRiskProfileError,
  BudgetError,
  InvalidGlobPatternError,
  InvalidPathArgumentError,
  MutuallyExclusiveOptionsError,
  ConflictingOptionsError,
  PathTraversalError,
  PathNotAccessibleError,
  PermissionDeniedError,
  SchemaValidationError,
  CollectorTimeoutError,
  CollectorMemoryLimitError,
  InvalidPathCharactersError,
  type ErrorContext
} from './specific-errors.js';

// Error formatter
export {
  ErrorFormatter,
  createFormatterFromResults,
  formatError,
  type FormattedIssue,
  type OutputMode
} from './error-formatter.js';


// Import for internal use
import { BaseError } from './specific-errors.js';

// Utility functions
export function wrapError(error: unknown): BaseError {
  if (error instanceof BaseError) {
    return error;
  }
  
  if (error instanceof Error) {
    return new BaseError('E999', error.message, { details: { originalError: error.constructor.name, stack: error.stack } });
  }
  
  const message = typeof error === 'string' ? error : String(error);
  return new BaseError('E999', message, { details: { originalValue: error } });
}
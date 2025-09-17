/**
 * Minimal public error interface
 * Only expose what's truly needed by external consumers
 */

// Core error class and common errors
export {
  BaseError,
  SchemaValidationError,
  PathNotAccessibleError,
  PathTraversalError,
  InvalidPathCharactersError,
  PermissionDeniedError,
  type ErrorContext
} from './specific-errors.js';

// Error categories and exit codes for CLI
export { exitCodeForCategory } from './error-codes.js';
export type { ErrorCategory } from './error-codes.js';

// Error formatting for output
export { formatError } from './error-formatter.js';

// Utility function for wrapping unknown errors
import { BaseError as BaseErrorClass } from './specific-errors.js';

export function wrapError(error: unknown): BaseErrorClass {
  if (error instanceof BaseErrorClass) {
    return error;
  }

  if (error instanceof Error) {
    return new BaseErrorClass('E999', error.message, { details: { originalError: error.constructor.name, stack: error.stack } });
  }

  const message = typeof error === 'string' ? error : String(error);
  return new BaseErrorClass('E999', message, { details: { originalValue: error } });
}
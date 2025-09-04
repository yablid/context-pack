import { exitCodeForCategory, mapToRegisteredCode } from './error-codes.js';

export interface BaseErrorInit {
  recoverable?: boolean;
  details?: unknown;
  suggestion?: string;
}

/**
 * Base error expected by tests: (code, message, opts?)
 */
export class BaseError extends Error {
  code: string = 'E000';
  recoverable: boolean = false;
  details?: unknown;
  suggestion?: string;

  constructor(code: string, message: string, init: BaseErrorInit = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    if (init.recoverable !== undefined) this.recoverable = init.recoverable;
    this.details = init.details;
    this.suggestion = init.suggestion;
  }

  getExitCode(): number {
    const registered = mapToRegisteredCode(this);
    return registered.exitCode ?? exitCodeForCategory(registered.category);
  }
}

export class InvalidLevelError extends BaseError {
  constructor(level: string, allowed: string[]) {
    super('E702', `Invalid detail level: "${level}". Allowed: ${allowed.join(', ')}`);
  }
}

export class InvalidRiskProfileError extends BaseError {
  constructor(risk: string, allowed: string[]) {
    super('E301', `Invalid risk profile: "${risk}". Allowed: ${allowed.join(', ')}`);
  }
}

export class BudgetError extends BaseError {
  constructor(input: number | string, minBytes: number, maxBytes: number) {
    const shown = typeof input === 'string' ? input : `${input}`;
    super('E401', `Invalid budget size: ${shown}. Expected ${minBytes}–${maxBytes} bytes.`);
    this.details = { input, minBytes, maxBytes };
  }
}

export class InvalidGlobPatternError extends BaseError {
  constructor(pattern: string, reason: string, ctx?: unknown) {
    super('E301', `Invalid glob pattern "${pattern}": ${reason}`);
    this.details = { pattern, reason, ctx };
  }
}

export class InvalidPathArgumentError extends BaseError {
  constructor(path: string) {
    super('E301', `Invalid path argument: ${path}`);
    this.details = { path };
  }
}

export class MutuallyExclusiveOptionsError extends BaseError {
  constructor(a: string, b: string) {
    super('E301', `Options --${a} and --${b} are mutually exclusive`);
  }
}

export class ConflictingOptionsError extends BaseError {
  constructor(a: string, b: string) {
    super('E301', `Options --${a} conflict with --${b}`);
  }
}

export class PathTraversalError extends BaseError {
  constructor(path: string, ctx?: unknown) {
    // Tests expect E102 for traversal
    super('E102', `Path traversal detected for "${path}"`, { details: ctx });
  }
}

export class PathNotAccessibleError extends BaseError {
  constructor(path: string, ctx?: unknown) {
    super('E103', `Path not accessible: ${path}`, { details: ctx });
  }
}

export class PermissionDeniedError extends BaseError {
  constructor(path: string, op: string, ctx?: unknown) {
    super('E103', `Permission denied (${op}) for: ${path}`, { details: ctx, recoverable: false });
  }
}

export class SchemaValidationError extends BaseError {
  constructor(artifactId: string, schemaId: string, validationErrors: string[]) {
    super('E401', `Schema validation failed for ${artifactId} (${schemaId})`);
    this.details = { artifactId, schemaId, validationErrors };
  }
}

export class CollectorTimeoutError extends BaseError {
  constructor(name: string, ms: number) {
    super('E202', `Collector "${name}" timed out after ${ms}ms`);
    this.details = { name, ms };
  }
}

export class CollectorMemoryLimitError extends BaseError {
  constructor(name: string, memMB: number, limitMB: number) {
    super('E203', `Collector "${name}" exceeded memory limit: ${memMB}MB > ${limitMB}MB`);
    this.details = { name, memMB, limitMB };
  }
}

export class InvalidPathCharactersError extends BaseError {
  constructor(path: string, invalidChars: string[]) {
    super('E701', `Path contains invalid characters: ${path} (invalid: ${invalidChars.join(', ')})`);
    this.details = { path, invalidChars };
  }
}

// Export type for compatibility
export type ErrorContext = Record<string, unknown>;
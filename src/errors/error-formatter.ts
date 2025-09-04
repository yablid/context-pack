interface BaseErrorLike {
  name?: string;
  code?: string;
  message: string;
  details?: unknown;
  suggestion?: string;
  recoverable?: boolean;
}
import { mapToRegisteredCode, exitCodeForCategory, CODE_REGISTRY } from './error-codes.js';

export interface FormattedIssue {
  code: string;
  message: string;
  details?: unknown;
  suggestion?: string;
  recoverable?: boolean;
}

export type OutputMode = 'cli' | 'json';

/**
 * Error/Warn formatter used by CLI and tests.
 * Tests expect:
 *  - constructor accepting initial error array
 *  - JSON output containing { status, errorCount, warningCount, errors, warnings }
 *  - CLI output with emoji headers
 */
export class ErrorFormatter {
  private errors: BaseErrorLike[] = [];
  private warnings: BaseErrorLike[] = [];

  constructor(initial?: BaseErrorLike[]) {
    if (initial && initial.length) this.addErrors(initial);
  }

  addError(e: BaseErrorLike) { this.errors.push(e); }
  addErrors(es: BaseErrorLike[]) { for (const e of es) this.addError(e); }
  addWarning(w: BaseErrorLike) { this.warnings.push(w); }

  hasCriticalErrors(): boolean {
    return this.errors.some((e) => !e.recoverable);
  }

  getExitCode(): number {
    if (this.errors.length === 0) return 0;
    // Choose the "worst" exit code based on per-code exit codes
    let maxExit = 1;
    for (const error of this.errors) {
      const registered = mapToRegisteredCode(error);
      const exitCode = registered.exitCode ?? 1;
      if (exitCode > maxExit) maxExit = exitCode;
    }
    return maxExit;
  }

  toJSON(): {
    status: 'ok' | 'error';
    errorCount: number;
    warningCount: number;
    errors: FormattedIssue[];
    warnings: FormattedIssue[];
  } {
    return {
      status: this.errors.length ? 'error' : 'ok',
      errorCount: this.errors.length,
      warningCount: this.warnings.length,
      errors: this.errors.map(formatIssue),
      warnings: this.warnings.map(formatIssue)
    };
  }

  format(mode: OutputMode = 'cli'): string {
    if (mode === 'json') {
      return JSON.stringify(this.toJSON(), null, 2);
    }
    const j = this.toJSON();
    const lines: string[] = [];
    if (j.errorCount) lines.push(`❌ ${j.errorCount} error(s)`);
    if (j.warningCount) lines.push(`⚠️ ${j.warningCount} warning(s)`);
    for (const e of j.errors) {
      lines.push(`  - [${e.code}] ${e.message}`);
      if (e.suggestion) lines.push(`      💡 ${e.suggestion}`);
    }
    for (const w of j.warnings) {
      lines.push(`  - [${w.code}] ${w.message}`);
      if (w.suggestion) lines.push(`      💡 ${w.suggestion}`);
    }
    return lines.join('\n');
  }
}

export function createFormatterFromResults(errors: BaseErrorLike[] = [], warnings: BaseErrorLike[] = []) {
  const f = new ErrorFormatter(errors);
  for (const w of warnings) f.addWarning(w);
  return f;
}

export function formatError(e: BaseErrorLike, mode: OutputMode = 'cli'): string {
  return new ErrorFormatter([e]).format(mode);
}

function formatIssue(e: BaseErrorLike): FormattedIssue {
  const reg = mapToRegisteredCode(e);
  return {
    code: reg.code,
    message: e.message,
    details: e.details,
    suggestion: e.suggestion,
    recoverable: e.recoverable
  };
}
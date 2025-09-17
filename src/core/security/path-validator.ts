/**
 * Path validation utilities for secure file system operations
 * Prevents path traversal attacks and validates path accessibility
 */

import { access, stat, lstat } from 'node:fs/promises';
import { resolve, normalize, isAbsolute, sep, dirname } from 'node:path';
import { constants } from 'node:fs';
import {
  PathNotAccessibleError,
  PathTraversalError,
  InvalidPathCharactersError,
  PermissionDeniedError,
  type ErrorContext
} from '../../errors/public.js';

export interface PathValidationOptions {
  mustExist?: boolean;
  mustBeReadable?: boolean;
  mustBeWritable?: boolean;
  mustBeDirectory?: boolean;
  mustBeFile?: boolean;
  allowSymlinks?: boolean;
  maxDepth?: number;
}

export interface PathValidationResult {
  valid: true;
  resolvedPath: string;
  isDirectory: boolean;
  isFile: boolean;
  size?: number;
}

export interface PathValidationError {
  valid: false;
  error: Error;
}

/**
 * Comprehensive path validation with security checks
 */
export class PathValidator {
  private static readonly INVALID_CHARS = /[<>:"|?*\x00-\x1f\x80-\x9f]/;
  private static readonly DANGEROUS_NAMES = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i;
  
  /**
   * Validate a path with comprehensive security and accessibility checks
   */
  static async validatePath(
    inputPath: string, 
    options: PathValidationOptions = {}
  ): Promise<PathValidationResult | PathValidationError> {
    try {
      // Basic input validation
      if (!inputPath || typeof inputPath !== 'string') {
        throw new InvalidPathCharactersError(inputPath || 'undefined', ['empty or invalid type']);
      }

      // Check for dangerous characters
      this.checkDangerousCharacters(inputPath);

      // Resolve and normalize the path
      const resolvedPath = this.securePath(inputPath);

      // Existence + stats (prefer lstat for symlink detection)
      const lst = await lstat(resolvedPath).catch(() => null);
      const exists = !!lst;
      if (options.mustExist !== false && !exists) {
        throw new PathNotAccessibleError(resolvedPath, { operation: 'exist check' });
      }
      // For type checks we may need follow-stat if it's a symlink and allowed
      const st = exists ? await stat(resolvedPath).catch(() => null) : null;

      // Permissions
      await this.checkPermissions(resolvedPath, options, { exists, lst, st });
      
      // Validate path type
      if (lst || st) {
        this.validatePathType(resolvedPath, { lst, st }, options);
      }

      return {
        valid: true,
        resolvedPath,
        isDirectory: (st ?? lst)?.isDirectory?.() ?? false,
        isFile: (st ?? lst)?.isFile?.() ?? false,
        size: (st ?? lst)?.isFile?.() ? (st ?? lst)!.size : undefined
      };

    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error : new Error(String(error))
      };
    }
  }

  /**
   * Validate multiple paths in batch
   */
  static async validatePaths(
    paths: string[],
    options: PathValidationOptions = {}
  ): Promise<Array<PathValidationResult | PathValidationError>> {
    return Promise.all(paths.map(path => this.validatePath(path, options)));
  }

  /**
   * Quick check if a path is safe to use (no existence check)
   */
  static isPathSafe(inputPath: string): boolean {
    try {
      this.checkDangerousCharacters(inputPath);
      this.securePath(inputPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Resolve path safely, preventing traversal attacks
   */
  private static securePath(inputPath: string): string {
    // Normalize the path to resolve . and .. components
    const normalizedPath = normalize(inputPath);
    
    // Convert to absolute path if relative
    const absolutePath = isAbsolute(normalizedPath) 
      ? normalizedPath 
      : resolve(process.cwd(), normalizedPath);

    // Check for path traversal attempts
    const resolvedPath = resolve(absolutePath);
    
    // Ensure the resolved path is within acceptable bounds
    // This prevents ../../../etc/passwd type attacks
    if (inputPath.includes('..') && !resolvedPath.startsWith(process.cwd())) {
      // Emit the E102-mapped error class to satisfy tests
      throw new PathTraversalError(inputPath, {
        inputPath,
        resolvedPath,
        currentWorkingDirectory: process.cwd()
      });
    }

    return resolvedPath;
  }

  /**
   * Check for dangerous characters in path
   */
  private static checkDangerousCharacters(path: string): void {
    const invalidChars: string[] = [];

    // Check for invalid characters
    if (this.INVALID_CHARS.test(path)) {
      const matches = path.match(this.INVALID_CHARS);
      if (matches) {
        invalidChars.push(...matches);
      }
    }

    // Check for dangerous Windows reserved names
    const pathParts = path.split(/[/\\]/);
    for (const part of pathParts) {
      if (this.DANGEROUS_NAMES.test(part)) {
        invalidChars.push(part);
      }
    }

    if (invalidChars.length > 0) {
      throw new InvalidPathCharactersError(path, [...new Set(invalidChars)]);
    }
  }

  /**
   * Check if path exists
   */
  private static async checkPathExists(path: string): Promise<void> {
    try {
      await access(path, constants.F_OK);
    } catch {
      throw new PathNotAccessibleError(path, { operation: 'exist check' });
    }
  }

  /**
   * Check path permissions
   */
  private static async checkPermissions(
    path: string, 
    options: PathValidationOptions,
    ctx: { exists: boolean; lst: any | null; st: any | null }
  ): Promise<void> {
    try {
      const wantRead = options.mustBeReadable !== false;
      const wantWrite = !!options.mustBeWritable;

      if (ctx.exists) {
        // Existing path: check on the path itself
        let mode = constants.F_OK;
        if (wantRead) mode |= constants.R_OK;
        if (wantWrite) mode |= constants.W_OK;
        await access(path, mode);
      } else {
        // Non-existent path: check parent directory for writability when requested
        if (wantWrite) {
          const parent = dirname(path);
          // Need execute (traverse) + write on the parent directory
          await access(parent, constants.W_OK | constants.X_OK);
        }
        // If only readability requested on a non-existent path, that's not meaningful; skip
      }
    } catch {
      const operation = [];
      if (options.mustBeReadable !== false) operation.push('read');
      if (options.mustBeWritable) operation.push('write');
      
      throw new PermissionDeniedError(
        path, 
        operation.join('/'), 
        { requestedPermissions: operation }
      );
    }
  }

  /**
   * Validate path type (file vs directory)
   */
  private static validatePathType(
    path: string,
    stats: { lst: any | null; st: any | null },
    options: PathValidationOptions
  ): void {
    const lst = stats.lst;
    const st  = stats.st ?? stats.lst;
    if (!st) return;

    if (options.mustBeDirectory && !st.isDirectory()) {
      throw new PermissionDeniedError(path, 'type check', { 
        expectedType: 'directory', 
        actualType: st.isFile() ? 'file' : 'other' 
      });
    }

    if (options.mustBeFile && !st.isFile()) {
      throw new PermissionDeniedError(path, 'type check', { 
        expectedType: 'file', 
        actualType: st.isDirectory() ? 'directory' : 'other' 
      });
    }

    // Check symlinks if not allowed
    if (!options.allowSymlinks && lst?.isSymbolicLink?.()) {
      throw new PathNotAccessibleError(path, { 
        reason: 'symbolic links not allowed',
        actualType: 'symlink' 
      });
    }
  }
}

/**
 * Convenience function for validating input paths
 */
export async function validateInputPath(path: string): Promise<string> {
  const result = await PathValidator.validatePath(path, {
    mustExist: true,
    mustBeReadable: true,
    mustBeDirectory: true
  });

  if (!result.valid) {
    throw result.error;
  }

  return result.resolvedPath;
}

/**
 * Convenience function for validating output paths
 */
export async function validateOutputPath(path: string): Promise<string> {
  const result = await PathValidator.validatePath(path, {
    mustExist: false,
    mustBeWritable: true
  });

  if (!result.valid) {
    throw result.error;
  }

  return result.resolvedPath;
}
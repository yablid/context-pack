/**
 * Seed Parser - Parse and validate seed strings with comprehensive error handling
 */

import * as path from 'node:path';
import type { SeedGrammar, SeedLocation, SeedResolutionResult, SeedResolutionDiagnostic } from '../../core/contracts/scoped.js';

export class SeedParser {
  private readonly rootPath: string;

  constructor(rootPath: string) {
    // Normalize constructor input independently
    this.rootPath = path.isAbsolute(rootPath)
      ? rootPath.split(path.sep).join('/')
      : path.resolve(process.cwd(), rootPath).split(path.sep).join('/');
  }

  /**
   * Parse seed string into structured location
   */
  parseSeed(seed: string): SeedResolutionResult {
    const diagnostics: SeedResolutionDiagnostic[] = [];

    // Validate basic grammar
    if (!this.isValidSeedGrammar(seed)) {
      diagnostics.push({
        code: 'INVALID_GRAMMAR',
        message: `Invalid seed format. Expected 'path#symbol' or 'path:line:col', got: ${seed}`,
      });
      return {
        seed: seed as SeedGrammar,
        success: false,
        diagnostics,
      };
    }

    try {
      const location = this.parseValidSeed(seed as SeedGrammar);
      return {
        seed: seed as SeedGrammar,
        success: true,
        location,
        diagnostics,
      };
    } catch (error) {
      diagnostics.push({
        code: 'INVALID_GRAMMAR',
        message: error instanceof Error ? error.message : 'Unknown parsing error',
      });
      return {
        seed: seed as SeedGrammar,
        success: false,
        diagnostics,
      };
    }
  }

  /**
   * Validate seed grammar without parsing details
   */
  private isValidSeedGrammar(seed: string): seed is SeedGrammar {
    // path#symbol pattern
    if (seed.includes('#') && !seed.includes(':')) {
      const parts = seed.split('#');
      return parts.length === 2 && parts[0].length > 0 && parts[1].length > 0;
    }

    // path:line:col pattern
    if (seed.includes(':') && !seed.includes('#')) {
      const parts = seed.split(':');
      if (parts.length === 3) {
        const [seedPath, line, col] = parts;
        const lineNum = parseInt(line, 10);
        const colNum = parseInt(col, 10);
        return seedPath.length > 0 && !isNaN(lineNum) && !isNaN(colNum) && lineNum > 0 && colNum >= 0;
      }
    }

    return false;
  }

  /**
   * Parse valid seed into location structure
   */
  private parseValidSeed(seed: SeedGrammar): SeedLocation {
    if (seed.includes('#')) {
      // Symbol-based seed
      const [seedPath, symbol] = seed.split('#', 2);
      return {
        path: this.normalizePath(seedPath),
        type: 'symbol',
        symbol,
      };
    } else {
      // Location-based seed
      const [seedPath, lineStr, colStr] = seed.split(':', 3);
      const line = parseInt(lineStr, 10);
      const column = parseInt(colStr, 10);

      if (isNaN(line) || isNaN(column) || line <= 0 || column < 0) {
        throw new Error(`Invalid line:column coordinates: ${lineStr}:${colStr}`);
      }

      return {
        path: this.normalizePath(seedPath),
        type: 'location',
        line,
        column,
      };
    }
  }

  /**
   * Normalize path to POSIX format for deterministic output
   */
  private normalizePath(inputPath: string): string {
    // Convert to absolute if relative
    const absolutePath = path.isAbsolute(inputPath)
      ? inputPath
      : path.resolve(this.rootPath, inputPath);

    // Convert to POSIX format for deterministic output
    return absolutePath.split(path.sep).join('/');
  }

  /**
   * Create diagnostic for common failure modes
   */
  static createSeedNotFoundDiagnostic(seed: SeedGrammar, searchPath: string): SeedResolutionDiagnostic {
    return {
      code: 'SEED_NOT_FOUND',
      message: `Symbol or location not found in file: ${searchPath}`,
      path: searchPath,
    };
  }

  static createMultipleDeclarationsDiagnostic(
    seed: SeedGrammar,
    symbol: string,
    locations: string[]
  ): SeedResolutionDiagnostic {
    return {
      code: 'MULTIPLE_DECLARATIONS',
      message: `Multiple declarations found for symbol '${symbol}'`,
      symbol,
      alternatives: locations,
    };
  }

  static createAmbientTypeDiagnostic(seed: SeedGrammar, symbol: string): SeedResolutionDiagnostic {
    return {
      code: 'AMBIENT_TYPE',
      message: `Symbol '${symbol}' is an ambient type declaration`,
      symbol,
    };
  }

  static createProjectReferenceDiagnostic(seed: SeedGrammar, referencePath: string): SeedResolutionDiagnostic {
    return {
      code: 'PROJECT_REFERENCE',
      message: `Symbol is in external project reference: ${referencePath}`,
      path: referencePath,
    };
  }

  static createReexportedSymbolDiagnostic(
    seed: SeedGrammar,
    symbol: string,
    originalPath: string
  ): SeedResolutionDiagnostic {
    return {
      code: 'REEXPORTED_SYMBOL',
      message: `Symbol '${symbol}' is re-exported from: ${originalPath}`,
      symbol,
      path: originalPath,
    };
  }
}
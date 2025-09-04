/**
 * CLI argument validation utilities
 * Validates command line options and arguments with helpful error messages
 */

import {
  InvalidLevelError,
  BudgetError,
  InvalidRiskProfileError,
  ConflictingOptionsError,
  MutuallyExclusiveOptionsError,
  InvalidGlobPatternError,
  InvalidPathArgumentError
} from '../errors/index.js';

export interface CLIValidationOptions {
  preset?: string;
  level?: string;
  budgetBytes?: string | number;
  riskProfile?: string;
  packages?: string;
  exclude?: string;
  out?: string;
  format?: string;
  strict?: boolean;
  validate?: boolean;
  validateOnly?: boolean;
  verbose?: boolean;
  deterministic?: boolean;
  allowApiChange?: boolean;
  language?: string;
}

export interface ValidatedCLIOptions {
  preset: string;
  level: 'summary' | 'contracts' | 'full-api' | 'deep';
  budgetBytes: number;
  riskProfile: 'safe' | 'normal' | 'extended' | 'minimal';
  packages?: string[];
  exclude?: string[];
  out: string;
  format: 'json' | 'ndjson';
  strict: boolean;
  validateSchemas: boolean;
  validateOnly: boolean;
  verbose: boolean;
  deterministic: boolean;
  allowApiChange: boolean;
  language: 'auto' | 'ts' | 'py';
}

/**
 * Comprehensive CLI options validator
 */
export class CLIValidator {
  private static readonly VALID_LEVELS = ['summary', 'contracts', 'full-api', 'deep'] as const;
  private static readonly VALID_RISK_PROFILES = ['safe', 'normal', 'extended', 'minimal'] as const;
  private static readonly VALID_FORMATS = ['json', 'ndjson'] as const;
  private static readonly VALID_LANGUAGES = ['auto', 'ts', 'py'] as const;
  
  private static readonly MIN_BUDGET_BYTES = 1024; // 1KB
  private static readonly MAX_BUDGET_BYTES = 100 * 1024 * 1024; // 100MB

  /**
   * Validate all CLI options and return normalized values
   */
  static validateOptions(options: CLIValidationOptions): ValidatedCLIOptions {
    // Check for mutually exclusive options first
    this.checkMutuallyExclusiveOptions(options);

    return {
      preset: this.validatePreset(options.preset),
      level: this.validateLevel(options.level),
      budgetBytes: this.validateBudgetBytes(options.budgetBytes),
      riskProfile: this.validateRiskProfile(options.riskProfile),
      packages: this.validateGlobArray(options.packages, 'packages'),
      exclude: this.validateGlobArray(options.exclude, 'exclude'),
      out: this.validateOutputPath(options.out),
      format: this.validateFormat(options.format),
      strict: Boolean(options.strict),
      validateSchemas: options.validate !== false, // Default true
      validateOnly: Boolean(options.validateOnly),
      verbose: Boolean(options.verbose),
      deterministic: options.deterministic !== false, // Default true
      allowApiChange: Boolean(options.allowApiChange),
      language: this.validateLanguage(options.language)
    };
  }

  /**
   * Validate path argument
   */
  static validatePathArgument(path: string | undefined): string {
    if (!path || typeof path !== 'string' || path.trim() === '') {
      throw new InvalidPathArgumentError(path || 'undefined');
    }

    return path.trim();
  }

  /**
   * Check for mutually exclusive options
   */
  private static checkMutuallyExclusiveOptions(options: CLIValidationOptions): void {
    const conflicts: Array<[string, string]> = [
      ['validateOnly', 'out'],
      ['strict', 'allowApiChange']
    ];

    for (const [option1, option2] of conflicts) {
      if (options[option1 as keyof CLIValidationOptions] && 
          options[option2 as keyof CLIValidationOptions]) {
        throw new MutuallyExclusiveOptionsError(option1, option2);
      }
    }

    // Special case: validate-only with no-validate
    if (options.validateOnly && options.validate === false) {
      throw new ConflictingOptionsError('validate-only', 'no-validate');
    }
  }

  /**
   * Validate preset option
   */
  private static validatePreset(preset?: string): string {
    // For now, we accept any preset string
    // In the future, we might validate against a list of known presets
    return preset || 'ts-pnpm';
  }

  /**
   * Validate detail level
   */
  private static validateLevel(level?: string): ValidatedCLIOptions['level'] {
    if (!level) {
      return 'contracts';
    }

    if (!this.VALID_LEVELS.includes(level as any)) {
      throw new InvalidLevelError(level, [...this.VALID_LEVELS]);
    }

    return level as ValidatedCLIOptions['level'];
  }

  /**
   * Validate budget bytes
   */
  static validateBudgetBytes(budgetBytes?: string | number): number {
    let bytes: number;

    if (budgetBytes === undefined || budgetBytes === '') {
      // Use default based on level (will be calculated later)
      return 1500000; // 1.5MB default for contracts level
    }

    if (typeof budgetBytes === 'string') {
      bytes = this.parseBudgetString(budgetBytes);
      if (isNaN(bytes)) {
        throw new BudgetError(
          budgetBytes, 
          this.MIN_BUDGET_BYTES, 
          this.MAX_BUDGET_BYTES
        );
      }
    } else {
      bytes = budgetBytes;
    }

    if (bytes < this.MIN_BUDGET_BYTES || bytes > this.MAX_BUDGET_BYTES) {
      throw new BudgetError(
        budgetBytes, 
        this.MIN_BUDGET_BYTES, 
        this.MAX_BUDGET_BYTES
      );
    }

    return bytes;
  }

  /**
   * Public helper for CLI code paths that need to parse a budget override.
   */
  static parseBudgetBytes(input: string | number): number {
    if (typeof input === 'number') return input;
    return this.parseBudgetString(input);
  }

  /**
   * Parse budget string with units (e.g., "5KB", "50MB", "1.5GB")
   */
  private static parseBudgetString(budget: string): number {
    const trimmed = budget.trim().toUpperCase();
    
    // Match number with optional unit
    const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB)?$/);
    if (!match) {
      return NaN;
    }

    const [, numStr, unit = 'B'] = match;
    const num = parseFloat(numStr);
    
    if (isNaN(num)) {
      return NaN;
    }

    const multipliers = {
      'B': 1,
      'KB': 1024,
      'MB': 1024 * 1024,
      'GB': 1024 * 1024 * 1024
    };

    return Math.floor(num * multipliers[unit as keyof typeof multipliers]);
  }

  /**
   * Validate risk profile
   */
  private static validateRiskProfile(riskProfile?: string): ValidatedCLIOptions['riskProfile'] {
    if (!riskProfile) {
      return 'safe';
    }

    if (!this.VALID_RISK_PROFILES.includes(riskProfile as any)) {
      throw new InvalidRiskProfileError(riskProfile, [...this.VALID_RISK_PROFILES]);
    }

    return riskProfile as ValidatedCLIOptions['riskProfile'];
  }

  /**
   * Validate glob patterns array
   */
  private static validateGlobArray(value?: string, optionName?: string): string[] | undefined {
    if (!value) {
      return undefined;
    }

    const patterns = value.split(',').map(p => p.trim()).filter(p => p.length > 0);
    
    // Basic glob pattern validation
    for (const pattern of patterns) {
      this.validateGlobPattern(pattern, optionName);
    }

    return patterns.length > 0 ? patterns : undefined;
  }

  /**
   * Validate a single glob pattern
   */
  private static validateGlobPattern(pattern: string, optionName?: string): void {
    try {
      // Basic validation - check for obvious invalid patterns
      if (pattern.includes('***')) {
        throw new Error('Too many consecutive asterisks');
      }

      if (pattern.includes('//')) {
        throw new Error('Double slashes not allowed');
      }

      // Check for unmatched brackets
      let bracketCount = 0;
      for (const char of pattern) {
        if (char === '[') bracketCount++;
        if (char === ']') bracketCount--;
      }
      if (bracketCount !== 0) {
        throw new Error('Unmatched brackets');
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Invalid pattern';
      throw new InvalidGlobPatternError(pattern, errorMessage, { optionName });
    }
  }

  /**
   * Validate output path
   */
  private static validateOutputPath(out?: string): string {
    return out || './.contextpack';
  }

  /**
   * Validate output format
   */
  private static validateFormat(format?: string): ValidatedCLIOptions['format'] {
    if (!format) {
      return 'json';
    }

    if (!this.VALID_FORMATS.includes(format as any)) {
      throw new InvalidLevelError(format, [...this.VALID_FORMATS]);
    }

    return format as ValidatedCLIOptions['format'];
  }

  /**
   * Validate language option
   */
  private static validateLanguage(language?: string): ValidatedCLIOptions['language'] {
    if (!language) {
      return 'auto';
    }

    if (!this.VALID_LANGUAGES.includes(language as any)) {
      throw new InvalidLevelError(language, [...this.VALID_LANGUAGES]);
    }

    return language as ValidatedCLIOptions['language'];
  }
}

/**
 * Helper function to validate a complete CLI command
 */
export interface CLICommand {
  path?: string;
  options: CLIValidationOptions;
}

export function validateCLICommand(command: CLICommand): {
  path: string;
  options: ValidatedCLIOptions;
} {
  return {
    path: CLIValidator.validatePathArgument(command.path),
    options: CLIValidator.validateOptions(command.options)
  };
}
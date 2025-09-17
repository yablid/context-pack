/**
 * Centralized budget policy and token/byte conversion constants
 * Single source of truth for all budgeting across ranker and packager
 */

export interface BudgetConfig {
  targetBytes: number;
  targetTokens: number;
  tokensToBytes: number; // Conversion multiplier
}

export class BudgetPolicy {
  // Core budget defaults
  static readonly DEFAULT_BUDGET_BYTES = 1_500_000; // 1.5MB
  static readonly DEFAULT_SCOPE_TOKENS = 20_000;    // 20K tokens for scoped packs

  // Token-to-byte conversion heuristic
  // Used consistently across ranker (token estimation) and packager (budget tracking)
  static readonly TOKENS_TO_BYTES_MULTIPLIER = 4;

  /**
   * Get budget configuration for scoped packs
   */
  static getScopedBudget(globalBudgetBytes: number, scopeTokens: number): BudgetConfig {
    return {
      targetBytes: globalBudgetBytes,
      targetTokens: scopeTokens,
      tokensToBytes: this.TOKENS_TO_BYTES_MULTIPLIER
    };
  }

  /**
   * Estimate byte size from token count using standard multiplier
   */
  static tokensToBytes(tokens: number): number {
    return tokens * this.TOKENS_TO_BYTES_MULTIPLIER;
  }

  /**
   * Estimate token count from byte size using standard multiplier
   */
  static bytesToTokens(bytes: number): number {
    return Math.floor(bytes / this.TOKENS_TO_BYTES_MULTIPLIER);
  }

  /**
   * Get level-specific budget defaults
   */
  static getLevelBudget(level: string): number {
    switch (level) {
      case 'summary': return 500_000;    // 500KB
      case 'contracts': return 1_500_000; // 1.5MB (default)
      case 'full-api': return 2_000_000;  // 2MB
      case 'deep': return 5_000_000;      // 5MB
      default: return this.DEFAULT_BUDGET_BYTES;
    }
  }
}
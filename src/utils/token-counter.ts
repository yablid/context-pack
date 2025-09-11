/**
 * Token counting utility for context packs
 * 
 * Provides rough estimates for different AI model tokenizers
 * Based on common patterns: ~4 chars per token for English text, ~1 char per token for code
 */

export interface TokenEstimate {
  /** Characters in the content */
  characters: number;
  /** Estimated tokens using GPT-style tokenization (conservative estimate) */
  tokensConservative: number;
  /** Estimated tokens using Claude-style tokenization (optimistic estimate) */
  tokensOptimistic: number;
  /** Average of conservative and optimistic estimates */
  tokensAverage: number;
}

export class TokenCounter {
  /**
   * Count tokens in a single text string
   */
  static countText(text: string): TokenEstimate {
    const characters = text.length;
    
    // Conservative estimate: assume worst case of ~3 chars per token
    // This accounts for code, special characters, and dense text
    const tokensConservative = Math.ceil(characters / 3);
    
    // Optimistic estimate: assume best case of ~5 chars per token  
    // This works well for natural language and whitespace-heavy text
    const tokensOptimistic = Math.ceil(characters / 5);
    
    const tokensAverage = Math.round((tokensConservative + tokensOptimistic) / 2);
    
    return {
      characters,
      tokensConservative,
      tokensOptimistic,
      tokensAverage
    };
  }

  /**
   * Count tokens across multiple artifacts
   */
  static countArtifacts(artifacts: Array<{ text?: string; data?: any; kind: string }>): TokenEstimate {
    let totalText = '';
    
    for (const artifact of artifacts) {
      if (artifact.text) {
        totalText += artifact.text;
      } else if (artifact.data && artifact.kind === 'json') {
        // For JSON data, stringify it to estimate tokens
        totalText += JSON.stringify(artifact.data, null, 2);
      }
    }
    
    return this.countText(totalText);
  }

  /**
   * Format token estimate for display
   */
  static formatEstimate(estimate: TokenEstimate, verbose: boolean = false): string {
    if (verbose) {
      return `~${estimate.tokensAverage.toLocaleString()} tokens (range: ${estimate.tokensConservative.toLocaleString()}-${estimate.tokensOptimistic.toLocaleString()})`;
    } else {
      return `~${estimate.tokensAverage.toLocaleString()} tokens`;
    }
  }

  /**
   * Estimate tokens for context pack directory
   * Reads all artifacts and provides total token count
   */
  static async estimateContextPackTokens(packDir: string): Promise<TokenEstimate> {
    const { readFile, readdir, stat } = await import('node:fs/promises');
    const { join, extname } = await import('node:path');
    
    let totalText = '';
    
    // Recursively read all artifacts
    const walk = async (dir: string): Promise<void> => {
      const entries = await readdir(dir);
      for (const name of entries) {
        const full = join(dir, name);
        const st = await stat(full);
        if (st.isDirectory()) {
          await walk(full);
          continue;
        }
        
        // Only count text-based artifacts
        const ext = extname(name);
        if (ext === '.json' || ext === '.ndjson' || ext === '.d.ts' || ext === '.md') {
          const content = await readFile(full, 'utf-8');
          totalText += content;
        }
      }
    };
    
    await walk(packDir);
    return this.countText(totalText);
  }
}
/**
 * Minimal secret redaction for code body emission safety
 * High-signal regex patterns for common secrets
 */

export interface RedactionResult {
  hasSecrets: boolean;
  redactedContent?: string;
  secretTypes: string[];
}

export class SecretRedactor {
  // High-confidence patterns for obvious secrets
  private static readonly SECRET_PATTERNS = [
    // PEM headers/footers
    { pattern: /-----BEGIN [A-Z\s]+-----[\s\S]*?-----END [A-Z\s]+-----/gi, type: 'pem_key' },

    // AWS access keys
    { pattern: /AKIA[0-9A-Z]{16}/gi, type: 'aws_access_key' },
    { pattern: /(?:aws_secret_access_key|AWS_SECRET_ACCESS_KEY)\s*[:=]\s*[A-Za-z0-9+/]{40}/gi, type: 'aws_secret' },

    // Common API key patterns
    { pattern: /(?:api_key|API_KEY|apiKey)\s*[:=]\s*["']?[A-Za-z0-9-_]{20,}["']?/gi, type: 'api_key' },

    // JWT tokens (basic detection)
    { pattern: /eyJ[A-Za-z0-9-_]+\.eyJ[A-Za-z0-9-_]+\.[A-Za-z0-9-_.+/=]*/gi, type: 'jwt_token' },

    // Private key markers in code
    { pattern: /(?:private_key|privateKey|PRIVATE_KEY)\s*[:=]\s*["'][^"']*["']/gi, type: 'private_key_var' },

    // Database connection strings with passwords
    { pattern: /(?:mongodb|postgresql|mysql):\/\/[^:]*:[^@\s]*@[^\s]*/gi, type: 'db_connection' }
  ];

  /**
   * Scan content for potential secrets
   * Returns redaction result with detected secret types
   */
  static scanContent(content: string): RedactionResult {
    const secretTypes: string[] = [];
    let redactedContent = content;
    let hasSecrets = false;

    for (const { pattern, type } of this.SECRET_PATTERNS) {
      if (pattern.test(content)) {
        hasSecrets = true;
        secretTypes.push(type);

        // Redact the secret with placeholder
        redactedContent = redactedContent.replace(pattern, `[REDACTED_${type.toUpperCase()}]`);
      }
    }

    return {
      hasSecrets,
      redactedContent: hasSecrets ? redactedContent : undefined,
      secretTypes
    };
  }

  /**
   * Check if content contains secrets without redacting
   * Faster check for validation purposes
   */
  static containsSecrets(content: string): boolean {
    return this.SECRET_PATTERNS.some(({ pattern }) => pattern.test(content));
  }

  /**
   * Get human-readable description of detected secret types
   */
  static describeSecrets(secretTypes: string[]): string {
    const descriptions: Record<string, string> = {
      pem_key: 'PEM certificate/key',
      aws_access_key: 'AWS access key',
      aws_secret: 'AWS secret key',
      api_key: 'API key',
      jwt_token: 'JWT token',
      private_key_var: 'Private key variable',
      db_connection: 'Database connection string'
    };

    return secretTypes.map(type => descriptions[type] || type).join(', ');
  }
}
/**
 * Base formatter interface for all output formats
 */

export interface FormatterOptions {
  redactSecrets?: boolean;
  maxBytes?: number;
}

export interface Formatter {
  format(artifact: any): string | Buffer;
  getContentType(): string;
}
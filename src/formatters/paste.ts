/**
 * Paste formatter for human-readable text output
 * Uses stable separators for consistent parsing
 */

import type { Formatter } from './base.js';

export class PasteFormatter implements Formatter {
  private readonly SEPARATOR = '====';

  format(artifact: any): string {
    const lines: string[] = [];

    // Header section
    lines.push(`${this.SEPARATOR} SECTION: HEADER ${this.SEPARATOR}`);
    lines.push(`Generated: ${new Date().toISOString()}`);

    if (artifact.meta) {
      lines.push(`Files: ${artifact.meta.fileCount || 0}`);
      lines.push(`Preset: ${artifact.meta.detectedPreset || 'unknown'}`);
    }

    // Content sections
    if (artifact.artifacts) {
      lines.push('');
      lines.push(`${this.SEPARATOR} SECTION: ARTIFACTS ${this.SEPARATOR}`);

      for (const [key, value] of Object.entries(artifact.artifacts)) {
        lines.push('');
        lines.push(`${this.SEPARATOR} ARTIFACT: ${key} ${this.SEPARATOR}`);

        if (typeof value === 'string') {
          lines.push(value);
        } else {
          lines.push(JSON.stringify(value, null, 2));
        }
      }
    }

    // Footer
    lines.push('');
    lines.push(`${this.SEPARATOR} END ${this.SEPARATOR}`);

    return lines.join('\n');
  }

  getContentType(): string {
    return 'text/plain';
  }
}
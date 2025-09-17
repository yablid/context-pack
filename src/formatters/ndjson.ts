/**
 * NDJSON (newline-delimited JSON) formatter for streaming artifacts
 */

import type { Formatter } from './base.js';

export class NdjsonFormatter implements Formatter {
  format(artifacts: any[]): string {
    if (!Array.isArray(artifacts)) {
      artifacts = [artifacts];
    }
    return artifacts.map(a => JSON.stringify(a)).join('\n');
  }

  getContentType(): string {
    return 'application/x-ndjson';
  }
}
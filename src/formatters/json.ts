/**
 * JSON formatter for context pack artifacts
 */

import { CanonicalJSON } from '../core/io/canonical-json.js';
import type { Formatter } from './base.js';

export class JsonFormatter implements Formatter {
  format(artifact: any): string {
    return CanonicalJSON.stringify(artifact);
  }

  getContentType(): string {
    return 'application/json';
  }
}
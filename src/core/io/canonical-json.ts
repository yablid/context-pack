// Canonical JSON writer with deterministic output

export class CanonicalJSON {
  /**
   * Stringify object with sorted keys for deterministic output
   */
  static stringify(value: unknown, pretty = false): string {
    const sortedReplacer = (_key: string, val: unknown): unknown => {
      if (val && typeof val === 'object' && !Array.isArray(val) && val.constructor === Object) {
        const sorted: Record<string, unknown> = {};
        const keys = Object.keys(val as Record<string, unknown>).sort();
        for (const key of keys) {
          sorted[key] = (val as Record<string, unknown>)[key];
        }
        return sorted;
      }
      return val;
    };

    return JSON.stringify(value, sortedReplacer, pretty ? 2 : undefined);
  }

  /**
   * Write NDJSON (newline-delimited JSON) with canonical ordering
   * Always includes trailing newline for canonical format
   */
  static stringifyNDJSON(items: unknown[]): string {
    if (items.length === 0) {
      return ''; // Empty NDJSON has no content, no trailing newline
    }
    
    const lines = items.map(item => this.stringify(item));
    return lines.join('\n') + '\n'; // Always trailing newline for non-empty NDJSON
  }

  /**
   * Normalize path separators to POSIX style for deterministic output
   */
  static normalizePath(path: string): string {
    return path.split('\\').join('/');
  }

  /**
   * Create UTC timestamp with day precision for deterministic builds
   */
  static deterministicTimestamp(): string {
    const now = new Date();
    const utcDate = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(), 0, 0, 0, 0
    ));
    return utcDate.toISOString();
  }

  /**
   * Sort array of objects by a key for deterministic output
   */
  static sortByKey<T extends Record<string, unknown>>(items: T[], key: keyof T): T[] {
    return [...items].sort((a, b) => {
      const aVal = String(a[key] || '');
      const bVal = String(b[key] || '');
      return aVal.localeCompare(bVal);
    });
  }

  /**
   * Calculate accurate byte size of canonical JSON string
   */
  static byteSize(value: unknown): number {
    return Buffer.byteLength(this.stringify(value), 'utf-8');
  }

  /**
   * Calculate accurate byte size of canonical NDJSON string
   */
  static byteSizeNDJSON(items: unknown[]): number {
    return Buffer.byteLength(this.stringifyNDJSON(items), 'utf-8');
  }

  /**
   * Create artifact with accurate size hint for JSON data
   */
  static createJSONArtifact(data: unknown): { json: string; sizeHint: number } {
    const json = this.stringify(data);
    return {
      json,
      sizeHint: Buffer.byteLength(json, 'utf-8')
    };
  }

  /**
   * Create artifact with accurate size hint for NDJSON data  
   */
  static createNDJSONArtifact(items: unknown[]): { ndjson: string; sizeHint: number } {
    const ndjson = this.stringifyNDJSON(items);
    return {
      ndjson,
      sizeHint: Buffer.byteLength(ndjson, 'utf-8')
    };
  }
}
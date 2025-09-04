import type { Collector, CollectorContext, Artifact } from '../types.js';
import { CanonicalJSON } from '../engine/canonical-json.js';

export abstract class BaseCollector implements Collector {
  abstract readonly name: string;
  abstract readonly schemaIds: string[];

  abstract detect(rootPath: string): Promise<boolean | number>;
  abstract collect(context: CollectorContext): Promise<Artifact[]>;

  protected createArtifact(
    id: string,
    filename: string,
    schemaId: string,
    data?: unknown,
    text?: string
  ): Artifact {
    const content = data !== undefined
      ? CanonicalJSON.stringify(data)
      : (text || '');
    const sizeHint = Buffer.byteLength(content, 'utf-8');

    return {
      id,
      filename,
      kind: data !== undefined ? 'json' : 'text',
      schemaId,
      sizeHint,
      data,
      ...(text !== undefined && { text })
    };
  }

  protected log(message: string, context: CollectorContext): void {
    if (context.verbose) {
      console.log(`[${this.name}] ${message}`);
    }
  }
}
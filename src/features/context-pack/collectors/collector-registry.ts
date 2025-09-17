import type { Collector } from '../../../core/contracts/collector.js';
import { FilesManifestCollector } from './files-manifest-collector.js';
import { TopologyCollector } from './topology-collector.js';
import { ImportGraphCollector } from './typescript/import-graph-collector.js';
import { ExportsCollector } from './typescript/exports-collector.js';
import { TsConfigCollector } from './typescript/tsconfig-collector.js';
import { TypeMetricsCollector } from './typescript/type-metrics-collector.js';
import { SchemaIndexCollector } from './typescript/schema-index-collector.js';
import { DuplicationCollector } from './typescript/duplication-collector.js';

export class CollectorRegistry {
  private collectors: Map<string, Collector> = new Map();

  constructor() {
    this.registerDefaultCollectors();
  }

  private registerDefaultCollectors(): void {
    // Core collectors
    this.register(new FilesManifestCollector());
    this.register(new TopologyCollector());
    
    // TypeScript collectors
    this.register(new ImportGraphCollector());
    this.register(new ExportsCollector());
    this.register(new TsConfigCollector());
    this.register(new TypeMetricsCollector());
    this.register(new SchemaIndexCollector());
    
    // Language-agnostic collectors
    this.register(new DuplicationCollector());
  }

  register(collector: Collector): void {
    this.collectors.set(collector.name, collector);
  }

  getCollector(name: string): Collector | undefined {
    return this.collectors.get(name);
  }

  async getActiveCollectors(rootPath: string, preset: string): Promise<Collector[]> {
    const presetCollectors = this.getCollectorsForPreset(preset);
    const activeCollectors: Collector[] = [];

    for (const collectorName of presetCollectors) {
      const collector = this.collectors.get(collectorName);
      if (collector) {
        try {
          const canRun = await collector.detect(rootPath);
          if (canRun) activeCollectors.push(collector);
        } catch {
          // If detection throws, treat as "not active" but keep going.
          continue;
        }
      }
    }

    return activeCollectors;
  }

  private getCollectorsForPreset(preset: string): string[] {
    switch (preset) {
      case 'ts-pnpm':
      case 'ts-npm':
        return [
          'files-manifest',
          'topology',
          'import-graph',
          'ts-config',
          'exports',
          'schema-index',
          'type-metrics',
          'duplication'
        ];
      
      case 'ts-simple':
        return [
          'files-manifest',
          'topology',
          'exports',
          'type-metrics'
        ];
      
      case 'py-poetry':
        return [
          'files-manifest',
          'topology',
          'py-imports'
        ];
      
      case 'rust-cargo':
        return [
          'files-manifest',
          'topology',
          'rust-analyzer'
        ];
      
      default:
        return ['files-manifest'];
    }
  }

  getAllCollectors(): Collector[] {
    return Array.from(this.collectors.values());
  }

  getCollectorNames(): string[] {
    return Array.from(this.collectors.keys());
  }
}
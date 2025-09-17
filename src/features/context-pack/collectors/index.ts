/**
 * Static collector registration for context-pack feature
 * This file exports a list of collector descriptors that the engine can import
 * Collectors themselves do not import this registry, preventing cycles
 */

import type { Collector } from '../../../core/contracts/collector.js';
import { FilesManifestCollector } from './files-manifest-collector.js';
import { TopologyCollector } from './topology-collector.js';
import { ImportGraphCollector } from './typescript/import-graph-collector.js';
import { ExportsCollector } from './typescript/exports-collector.js';
import { TsConfigCollector } from './typescript/tsconfig-collector.js';
import { TypeMetricsCollector } from './typescript/type-metrics-collector.js';
import { SchemaIndexCollector } from './typescript/schema-index-collector.js';
import { DuplicationCollector } from './typescript/duplication-collector.js';

export interface CollectorDescriptor {
  name: string;
  instance: Collector;
  presets: string[];
}

/**
 * Static list of all available collectors
 * Engine imports this list, collectors never import the registry
 */
export const COLLECTOR_DESCRIPTORS: CollectorDescriptor[] = [
  // Core collectors
  {
    name: 'files-manifest',
    instance: new FilesManifestCollector(),
    presets: ['ts-pnpm', 'ts-npm', 'ts-simple', 'py-poetry', 'rust-cargo', 'default']
  },
  {
    name: 'topology',
    instance: new TopologyCollector(),
    presets: ['ts-pnpm', 'ts-npm', 'ts-simple', 'py-poetry', 'rust-cargo']
  },

  // TypeScript collectors
  {
    name: 'import-graph',
    instance: new ImportGraphCollector(),
    presets: ['ts-pnpm', 'ts-npm']
  },
  {
    name: 'exports',
    instance: new ExportsCollector(),
    presets: ['ts-pnpm', 'ts-npm', 'ts-simple']
  },
  {
    name: 'ts-config',
    instance: new TsConfigCollector(),
    presets: ['ts-pnpm', 'ts-npm']
  },
  {
    name: 'type-metrics',
    instance: new TypeMetricsCollector(),
    presets: ['ts-pnpm', 'ts-npm', 'ts-simple']
  },
  {
    name: 'schema-index',
    instance: new SchemaIndexCollector(),
    presets: ['ts-pnpm', 'ts-npm']
  },

  // Language-agnostic collectors
  {
    name: 'duplication',
    instance: new DuplicationCollector(),
    presets: ['ts-pnpm', 'ts-npm']
  }
];

/**
 * Get collectors for a specific preset
 */
export function getCollectorsForPreset(preset: string): Collector[] {
  return COLLECTOR_DESCRIPTORS
    .filter(desc => desc.presets.includes(preset))
    .map(desc => desc.instance);
}

/**
 * Get all collector instances
 */
export function getAllCollectors(): Collector[] {
  return COLLECTOR_DESCRIPTORS.map(desc => desc.instance);
}
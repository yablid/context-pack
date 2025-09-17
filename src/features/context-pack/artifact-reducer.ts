/**
 * Artifact reduction system for generating different pack sizes
 *
 * Takes full artifacts and creates filtered versions for short/minimal packs
 */

import type { Artifact } from '../../core/types.js';

export type PackType = 'full' | 'short' | 'minimal';

/**
 * Import graph data structure (based on existing schema)
 */
interface ImportGraphStats {
  roots: string[];
  leaves: string[];
  hasCycles: boolean;
  topExternalImports: Array<[string, number]>;
  totalNodes: number;
  totalEdges: number;
  externalEdges: number;
  internalEdges: number;
}

interface ImportGraphData {
  stats: ImportGraphStats;
  nodes: any[];
  edges: any[];
  externalDeps: Record<string, string[]>;
}

/**
 * TypeScript config data structure (based on existing schema)
 */
interface TsConfigData {
  configs: Array<{
    name: string;
    dir: string;
    configFile: string;
    resolved: {
      compilerOptions: Record<string, any>;
      include?: string[];
      exclude?: string[];
    };
    delta: Record<string, any>;
  }>;
  summary: {
    totalConfigs: number;
    strictCount: number;
    esmCount: number;
    declarationCount: number;
    moduleDistribution: Record<string, number>;
    targetDistribution: Record<string, number>;
  };
}

/**
 * Reduce import graph data based on pack type
 */
export function reduceImportGraph(data: ImportGraphData, packType: PackType): Partial<ImportGraphData> {
  switch (packType) {
    case 'full':
      return data;

    case 'short':
      // Include stats and external dependencies only
      return {
        stats: data.stats,
        externalDeps: data.externalDeps
      };

    case 'minimal':
      // Only essential stats
      return {
        stats: {
          roots: data.stats.roots,
          leaves: data.stats.leaves,
          hasCycles: data.stats.hasCycles,
          topExternalImports: data.stats.topExternalImports,
          totalNodes: data.stats.totalNodes,
          totalEdges: data.stats.totalEdges,
          externalEdges: data.stats.externalEdges,
          internalEdges: data.stats.internalEdges
        }
      };
  }
}

/**
 * Reduce TypeScript config data based on pack type
 */
export function reduceTsConfig(data: TsConfigData, packType: PackType): Partial<TsConfigData> {
  switch (packType) {
    case 'full':
      return data;

    case 'short':
      // Keep full summary but filter compiler options to key fields
      return {
        configs: data.configs.map(config => ({
          name: config.name,
          dir: config.dir,
          configFile: config.configFile,
          resolved: {
            compilerOptions: {
              module: config.resolved.compilerOptions.module,
              moduleResolution: config.resolved.compilerOptions.moduleResolution,
              target: config.resolved.compilerOptions.target,
              strict: config.resolved.compilerOptions.strict,
              esModuleInterop: config.resolved.compilerOptions.esModuleInterop,
              rootDir: config.resolved.compilerOptions.rootDir,
              outDir: config.resolved.compilerOptions.outDir
            }
          },
          delta: {
            module: config.delta.module,
            moduleResolution: config.delta.moduleResolution,
            target: config.delta.target,
            strict: config.delta.strict,
            esModuleInterop: config.delta.esModuleInterop
          }
        })),
        summary: data.summary
      };

    case 'minimal':
      // Only essential compiler options
      return {
        configs: data.configs.map(config => ({
          name: config.name,
          dir: config.dir,
          configFile: config.configFile,
          resolved: {
            compilerOptions: {
              module: config.resolved.compilerOptions.module,
              moduleResolution: config.resolved.compilerOptions.moduleResolution,
              target: config.resolved.compilerOptions.target,
              strict: config.resolved.compilerOptions.strict
            }
          },
          delta: {
            module: config.delta.module,
            moduleResolution: config.delta.moduleResolution,
            target: config.delta.target,
            strict: config.delta.strict
          }
        }))
      };
  }
}

/**
 * Generate artifact list for specific pack type
 */
export function generatePackArtifacts(fullArtifacts: Artifact[], packType: PackType): Artifact[] {
  switch (packType) {
    case 'full':
      return fullArtifacts;

    case 'short':
      return fullArtifacts
        .filter(artifact => {
          // Include: topology, manifest, import-graph, tsconfig, exports
          const filename = artifact.filename;
          return (
            filename === '10-repo-topology.json' ||
            filename === '20-files-manifest.ndjson' ||
            filename === '30-import-graph.json' ||
            filename === 'ts/50-tsconfigs.json' ||
            filename === 'ts/60-exports.json'
          );
        })
        .map(artifact => {
          if (artifact.filename === '30-import-graph.json') {
            return {
              ...artifact,
              data: reduceImportGraph(artifact.data as ImportGraphData, 'short')
            };
          }
          if (artifact.filename === 'ts/50-tsconfigs.json') {
            return {
              ...artifact,
              data: reduceTsConfig(artifact.data as TsConfigData, 'short')
            };
          }
          return artifact;
        });

    case 'minimal':
      return fullArtifacts
        .filter(artifact => {
          // Include: import-graph, tsconfig, exports only
          const filename = artifact.filename;
          return (
            filename === '30-import-graph.json' ||
            filename === 'ts/50-tsconfigs.json' ||
            filename === 'ts/60-exports.json'
          );
        })
        .map(artifact => {
          if (artifact.filename === '30-import-graph.json') {
            return {
              ...artifact,
              data: reduceImportGraph(artifact.data as ImportGraphData, 'minimal')
            };
          }
          if (artifact.filename === 'ts/50-tsconfigs.json') {
            return {
              ...artifact,
              data: reduceTsConfig(artifact.data as TsConfigData, 'minimal')
            };
          }
          return artifact;
        });
  }
}

/**
 * Flatten TypeScript artifacts for short/minimal packs
 * Removes ts/ prefix to put them in root directory
 */
export function flattenArtifactPaths(artifacts: Artifact[]): Artifact[] {
  return artifacts.map(artifact => ({
    ...artifact,
    filename: artifact.filename.replace(/^ts\//, '')
  }));
}
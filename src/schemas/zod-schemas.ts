import { z } from 'zod';
import { ScopedScopeSchema } from './scoped-scope.js';
import { ScopedSymbolGraphSchema } from './scoped-symbol-graph.js';
import { ScopedSlicesSchema } from './scoped-slices.js';
import { ScopedStubsSchema } from './scoped-stubs.js';
import { ScopedIndexSchema } from './scoped-index.js';

// Base schemas
export const PackMetadataSchema = z.object({
  specVersion: z.string(),
  generator: z.object({
    name: z.string(),
    version: z.string()
  }),
  createdAt: z.string().datetime(),
  preset: z.string(),
  riskProfile: z.enum(['safe', 'normal', 'extended', 'minimal'] as const),
  level: z.enum(['summary', 'contracts', 'full-api', 'deep'] as const),
  budgets: z.object({
    targetBytes: z.number().int().positive(),
    actualBytes: z.number().int().nonnegative()
  }),
  git: z.object({
    commit: z.string().optional(),
    branch: z.string().optional(),
    isDirty: z.boolean().optional()
  }).optional(),
  downsampling: z.array(z.object({
    artifactId: z.string(),
    reason: z.string(),
    originalCount: z.number().int().nonnegative(),
    finalCount: z.number().int().nonnegative(),
    strategy: z.string()
  })),
  meta: z.record(z.string(), z.unknown()).optional()
});

export const FileInfoSchema = z.object({
  path: z.string(),
  bytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/, 'Invalid SHA-256 hash format'),
  loc: z.number().int().nonnegative(),
  kind: z.enum(['code', 'config', 'test', 'asset', 'docs'] as const),
  bucket: z.enum(['public', 'internal', 'unknown'] as const),
  ignoreReason: z.string().optional()
});

export const RepoTopologySchema = z.object({
  packages: z.array(z.object({
    name: z.string(),
    dir: z.string(),
    private: z.boolean().optional(),
    type: z.enum(['module', 'commonjs'] as const).optional(),
    bin: z.record(z.string(), z.string()).optional(),
    exports: z.record(z.string(), z.unknown()).optional(),
    main: z.string().optional(),
    module: z.string().optional(),
    dependencies: z.object({
      internal: z.array(z.string()),
      external: z.array(z.string())
    })
  })),
  workspaces: z.array(z.object({
    root: z.string(),
    packages: z.array(z.string())
  })),
  lockfile: z.object({
    type: z.enum(['pnpm', 'yarn', 'npm', 'none'] as const),
    path: z.string().optional()
  })
});

export const ImportGraphSchema = z.object({
  nodes: z.array(z.object({
    path: z.string(),
    package: z.string().optional(),
    kind: z.enum(['source', 'declaration', 'package'] as const)
  })),
  edges: z.array(z.object({
    from: z.string(),
    to: z.string(),
    kind: z.enum(['import', 'export', 'reexport'] as const),
    specifier: z.string()
  })),
  stats: z.object({
    totalNodes: z.number().int().nonnegative(),
    totalEdges: z.number().int().nonnegative(),
    packages: z.number().int().nonnegative(),
    stronglyConnectedComponents: z.number().int().nonnegative().optional(), // Deprecated
    sccCount: z.number().int().nonnegative().optional(),
    degrees: z.record(z.string(), z.object({
      in: z.number().int().nonnegative(),
      out: z.number().int().nonnegative()
    })).optional(),
    roots: z.array(z.string()).optional(),
    leaves: z.array(z.string()).optional(),
    isolatedNodes: z.array(z.string()).optional(),
    internalEdges: z.number().int().nonnegative().optional(),
    externalEdges: z.number().int().nonnegative().optional(),
    hasCycles: z.boolean().optional(),
    topExternalImports: z.array(z.tuple([
      z.string(),
      z.number().int().positive()
    ])).optional(),
    reachability: z.object({
      seeds: z.array(z.string()),
      reachable: z.array(z.string()),
      reachabilityTruncated: z.boolean().optional()
    }).optional()
  }),
  externalDeps: z.record(z.string(), z.array(z.string()))
});

export const TsConfigSchema = z.object({
  configs: z.array(z.object({
    name: z.string(),
    dir: z.string(),
    resolved: z.object({
      compilerOptions: z.record(z.string(), z.unknown()).optional(),
      include: z.array(z.string()).optional(),
      exclude: z.array(z.string()).optional(),
      files: z.array(z.string()).optional(),
      extends: z.string().optional()
    }),
    delta: z.object({
      strict: z.boolean().optional(),
      target: z.string().optional(),
      module: z.string().optional(),
      moduleResolution: z.string().optional(),
      verbatimModuleSyntax: z.boolean().optional(),
      declaration: z.boolean().optional(),
      declarationMap: z.boolean().optional(),
      sourceMap: z.boolean().optional(),
      esModuleInterop: z.boolean().optional(),
      allowSyntheticDefaultImports: z.boolean().optional(),
      noUncheckedIndexedAccess: z.boolean().optional(),
      exactOptionalPropertyTypes: z.boolean().optional()
    }).optional()
  })),
  summary: z.object({
    totalConfigs: z.number().int().nonnegative(),
    strictCount: z.number().int().nonnegative(),
    esmCount: z.number().int().nonnegative(),
    declarationCount: z.number().int().nonnegative(),
    targetDistribution: z.record(z.string(), z.number().int().nonnegative()),
    moduleDistribution: z.record(z.string(), z.number().int().nonnegative())
  })
});

export const ExportsSchema = z.object({
  files: z.array(z.object({
    path: z.string(),
    exports: z.array(z.object({
      name: z.string(),
      kind: z.enum(['function', 'class', 'type', 'interface', 'enum', 'var', 'default', 'reexport'] as const),
      target: z.string().optional()
    }))
  }))
});

export const SchemaIndexSchema = z.object({
  schemas: z.array(z.object({
    path: z.string(),
    framework: z.enum(['zod', 'yup', 'joi', 'ajv', 'custom'] as const).optional(),
    exports: z.array(z.string())
  }))
});

export const TypeMetricsSchema = z.object({
  summary: z.object({
    totalFiles: z.number().int().nonnegative(),
    anyCount: z.number().int().nonnegative(),
    unknownCount: z.number().int().nonnegative(),
    neverCount: z.number().int().nonnegative(),
    satisfiesCount: z.number().int().nonnegative(),
    asConstCount: z.number().int().nonnegative(),
    verbatimModuleSyntax: z.number().int().nonnegative()
  }),
  byFile: z.array(z.object({
    path: z.string(),
    anyCount: z.number().int().nonnegative(),
    unknownCount: z.number().int().nonnegative(),
    neverCount: z.number().int().nonnegative(),
    satisfiesCount: z.number().int().nonnegative(),
    asConstCount: z.number().int().nonnegative()
  }))
});

export const DuplicationReportSchema = z.object({
  clusters: z.array(z.object({
    id: z.string(),
    size: z.number().int().positive(),
    totalBytes: z.number().int().positive(),
    similarity: z.number().min(0).max(1),
    representative: z.string(),
    files: z.array(z.string())
  })),
  summary: z.object({
    totalFiles: z.number().int().nonnegative(),
    duplicatedFiles: z.number().int().nonnegative(),
    duplicatedBytes: z.number().int().nonnegative(),
    compressionRatio: z.number().min(0).max(1)
  })
});

// Schema registry mapping schemaId to zod schema
// Simple schema for text-based artifacts like .d.ts files
export const TextArtifactSchema = z.string();

export const SCHEMA_REGISTRY = {
  '00-pack': PackMetadataSchema,
  '10-repo-topology': RepoTopologySchema,
  '20-files-manifest': FileInfoSchema,
  '30-import-graph': ImportGraphSchema,
  '40-duplication-report': DuplicationReportSchema,
  'ts/50-tsconfigs': TsConfigSchema,
  'ts/60-exports': ExportsSchema,
  'ts/70-public-api': TextArtifactSchema,
  'ts/80-schema-index': SchemaIndexSchema,
  'ts/90-type-metrics': TypeMetricsSchema,
  // Scoped pack schemas
  'scoped/00-scope': ScopedScopeSchema,
  'scoped/10-symbol-graph': ScopedSymbolGraphSchema,
  'scoped/20-slices': ScopedSlicesSchema,
  'scoped/30-stubs': ScopedStubsSchema,
  'scoped/40-index': ScopedIndexSchema
} as const;

export type SchemaId = keyof typeof SCHEMA_REGISTRY;
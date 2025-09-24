# Context-Pack Suite

**Production-Ready** unified codebase analysis and context extraction for LLM agents. Four coordinated features provide comprehensive understanding from metadata-only analysis to symbol-level code extraction.

## Four Integrated Features

- 🏗️ **Context Packs**: Metadata-only codebase analysis (safe for sharing)
- 🎯 **Scoped Packs**: Symbol-level code extraction with dependency graphs
- 📊 **Refactor Reports**: Architectural analysis and improvement suggestions
- 📋 **Paste Packs**: Single-file code consolidation for sharing

## Key Principles

- **Safe by design**: No source code bodies by default, explicit opt-in for code, automatic secret redaction
- **Rich analysis**: Import graphs, TypeScript exports, architectural metrics, dependency ranking
- **Deterministic output**: Same inputs → identical outputs across runs and platforms
- **High performance**: Shared TypeScript program analysis with concurrent processing
- **Smart file handling**: Peek-based binary detection, budget enforcement, full .gitignore support
- **Schema validated**: All artifacts validated against zod schemas with detailed error reporting
- **Agent optimized**: LLM-friendly formats with stable separators and clear boundaries

## Quick Start

```bash
# Install globally (after building)
pnpm link --global

# Basic context pack (metadata only)
context-pack .    # or: ctxp .

# Symbol-level code extraction
ctxp . --scope src/types.ts#BuildConfig --scope-allow-code

# Architectural analysis
ctxp . --refactor-report

# Single-file code sharing
ctxp ./src --paste --paste-allow-code

# Selective paste packs
ctxp . --paste --only "*.json" > config-files.txt
ctxp . --paste --ex node_modules,dist,tests > clean-code.txt

# All features combined
ctxp . \
  --scope src/api.ts#handleRequest --scope-allow-code \
  --refactor-report \
  --paste-pack

# Generate with different detail levels
ctxp . --level summary     # ≤ 500KB
ctxp . --level contracts   # ≤ 1.5MB (default)
ctxp . --level full-api    # ≤ 2MB

# Validate with strict checking
ctxp . --validate-only --strict --verbose

# Performance and optimization options
ctxp . --concurrency 5           # Max 5 concurrent collectors
ctxp . --no-hash-files           # Skip SHA-256 hashing for speed
ctxp . --max-hash-file-size 5    # Hash files up to 5MB only

# Generate with validation (strict mode fails after pack creation)
ctxp . --strict
```

## Output Structure

Context packs are generated in three different sizes to optimize for different LLM context windows:

```
.contextpack/
  TOKEN_COUNTS.txt          # Token estimates for all pack sizes
  full/                     # Complete analysis (~18K tokens)
    00-pack.json            # Pack metadata and generation info
    10-repo-topology.json   # Workspace structure and dependencies
    20-files-manifest.ndjson # File inventory with hashes, LOC, and byte metrics
    30-import-graph.json    # Import/dependency graph with full node/edge details
    40-duplication-report.json # Code duplication metrics
    ts/                     # TypeScript-specific artifacts
      50-tsconfigs.json     # TypeScript configuration analysis
      60-exports.json       # Package exports mapping
      80-schema-index.json  # Schema definitions catalog
      90-type-metrics.json  # TypeScript usage metrics
  short/                    # Essential structure (~11K tokens)
    00-pack.json            # Pack metadata
    10-repo-topology.json   # Workspace structure (full)
    20-files-manifest.ndjson # File inventory (full)
    30-import-graph.json    # Import stats + external deps only
    50-tsconfigs.json       # Key compiler options + summary
    60-exports.json         # Package exports (full)
  minimal/                  # Quick context (~7K tokens)
    00-pack.json            # Pack metadata
    30-import-graph.json    # Essential graph stats only
    50-tsconfigs.json       # Core compiler settings only
    60-exports.json         # Package exports (full)
  scoped/                   # Symbol-level context (when --scope used)
    <hash>/                 # Deterministic hash-based directory
      00-scope.json         # Scoped pack metadata and configuration
      10-symbol-graph.json  # Dependency graph around target symbol
      20-slices.ndjson      # Code slices with context lines
      30-stubs.d.ts         # TypeScript declarations for external types
      40-index.ndjson       # Symbol → slice mapping
```

## Artifact Reference: What Each File Contains

Each artifact is designed to give LLM agents specific insights into codebase structure, quality, and patterns without exposing source code.

### Core Artifacts

**`00-pack.json`** - Pack metadata and generation summary
- **Contents**: Creation timestamp, git state, budgets used/available, collector health status, validation results
- **Agent value**: Establishes context trust (git commit, generation time), identifies any collection failures that might affect completeness, shows which language ecosystems were detected

**`10-repo-topology.json`** - Workspace and package structure
- **Contents**: Package.json analysis, workspace relationships, lockfile type (pnpm/npm/yarn), dependency lists
- **Agent value**: Understand monorepo structure, package boundaries, build system in use—critical for suggesting changes that respect workspace architecture

**`20-files-manifest.ndjson`** - Complete file inventory with metadata
- **Contents**: Every file's path, size, line count, hash, categorization (source/config/asset/test), risk bucket
- **Agent value**: Understand codebase size/scope, locate configuration files, identify test patterns, assess which files to prioritize for analysis based on size and type

**`30-import-graph.json`** - Module dependency relationships and analysis
- **Contents**: Import/export edges between files, external dependencies usage, graph statistics (roots, leaves, cycles), reachability analysis, strongly connected components
- **Agent value**: Critical for understanding code architecture—identify entry points, shared utilities, circular dependencies, and the impact radius of proposed changes

**`40-duplication-report.json`** - Code similarity analysis
- **Contents**: Detected duplicate code clusters, file similarity metrics, compression ratios
- **Agent value**: Identify refactoring opportunities, understand code patterns that are repeated (good candidates for abstraction), assess codebase maintenance quality

### TypeScript-Specific Artifacts

**`ts/50-tsconfigs.json`** - TypeScript configuration analysis
- **Contents**: Parsed tsconfig.json files, compiler options, include/exclude patterns, resolved settings, strictness analysis
- **Agent value**: Understand type checking rigor, compilation targets, module system—essential for suggesting TypeScript code changes that respect project configuration

**`ts/60-exports.json`** - Package API surface analysis
- **Contents**: All exported functions, types, and interfaces from each module, organized by file with full type signatures
- **Agent value**: Understand public APIs without reading source, identify breaking changes, find available utilities, understand module boundaries and contracts

**`ts/80-schema-index.json`** - Schema and validation definitions
- **Contents**: Zod schemas, JSON Schema definitions, validation patterns found in codebase
- **Agent value**: Understand data validation patterns, API contracts, and type safety approaches—helps suggest consistent validation patterns

**`ts/90-type-metrics.json`** - TypeScript usage patterns
- **Contents**: Usage of `any`, `unknown`, `never`, type assertions, `satisfies` operator, verbatim module syntax adoption
- **Agent value**: Assess TypeScript maturity level, identify type safety gaps or patterns, suggest improvements aligned with current codebase practices

## Why This Structure Benefits LLM Agents

1. **No hallucination risk**: All data is extracted, not inferred—agents can trust structural information
2. **Change impact analysis**: Import graphs + exports let agents predict what breaks when files change
3. **Pattern recognition**: Duplication reports + type metrics reveal codebase conventions to follow
4. **Scope awareness**: File manifests prevent agents from assuming files that don't exist
5. **Architecture respect**: Topology + tsconfig help agents suggest changes that fit existing patterns
6. **Quality context**: Validation status + health metrics indicate codebase reliability and maintenance state

Each artifact answers specific questions agents commonly need: "What depends on this?", "Where are the tests?", "What's the module boundary?", "How strict is the typing?", "What external libraries are used?"—all without exposing proprietary code content.

## Choosing the Right Pack Size

- **`full/`** - Use when you need complete architectural analysis, refactoring guidance, or comprehensive code review
- **`short/`** - Use for focused tasks like adding features, understanding structure, or debugging specific issues
- **`minimal/`** - Use for quick questions about exports, dependencies, or configuration—fits in any model's context window

All three packs contain the same core insight (what functions/types are available, how modules connect, project configuration) but with different levels of detail to match your context budget.

## Documentation

- **[Context Packs Guide](docs/context-pack.md)** - Comprehensive guide to generating and using context packs
- **[Scoped Packs Guide](docs/scoped.md)** - Symbol-level context extraction for coding agents
- **[CLI Reference](docs/cli.md)** - Complete command-line interface documentation

## Performance & Configuration

### Concurrency Control
Context pack uses bounded concurrency to process collectors in parallel while preventing resource exhaustion:

```bash
# Default: 3 concurrent collectors (balanced performance/memory)
ctxp .

# High-performance systems: increase concurrency
ctxp . --concurrency 8

# Resource-constrained: sequential processing
ctxp . --concurrency 1
```

### File Processing Optimizations
Large codebases benefit from these optimization flags:

```bash
# Skip hashing for faster processing (useful during development)
ctxp . --no-hash-files

# Hash only smaller files (default: 10MB limit)
ctxp . --max-hash-file-size 5

# Combine optimizations for maximum speed
ctxp . --no-hash-files --concurrency 6
```

**Performance characteristics**:
- **Peek-based binary detection**: Only reads first 8KB to classify files
- **Intelligent .gitignore parsing**: Respects your project's ignore rules using the `ignore` package
- **SVG text processing**: Treats SVG files as text (valuable for UI codebases)
- **Memory-bounded**: Each collector limited to 500MB with 30-second timeouts

### Validation & Quality Control

```bash
# Development: fast with retry logic
ctxp . --verbose

# CI/Production: strict validation, no retries
ctxp . --strict --validate-only

# Debugging: see all validation warnings
ctxp . --verbose --no-validate
```

The `--strict` flag enables stricter validation but allows pack generation to complete before failing, so you can inspect the artifacts even when validation errors occur.

## Development

This project uses pnpm for package management.

```bash
pnpm install
pnpm build
pnpm dev     # Watch mode
```

## Production Status

✅ **Complete & Production-Ready**:
- **Core Engine**: File walking, budget management, canonical JSON output, bounded concurrency
- **Detector System**: Ecosystem detection (pnpm, npm, TypeScript)
- **Collectors**: Files manifest, topology, import graph, exports, type metrics, duplication, schema index, TSConfig
- **CLI Interface**: Simplified argument parsing, optimized for performance and maintainability
- **File Processing**: Peek-based binary detection, optional hashing, .gitignore support, SVG text handling
- **Performance**: Concurrent collectors (default: 3), configurable memory limits and timeouts
- **Validation**: Comprehensive zod schema validation with inline failure reporting
- **Error Handling**: Structured error system with exit codes and recovery
- **Security**: Path validation, traversal protection, no code body exposure, hash size limits

🔧 **Recent Changes**:
- Removed `commander.js` dependency for simpler CLI parsing
- Added bounded concurrency (3x faster on multi-collector workloads)
- Added .gitignore support using the `ignore` package
- Optimized file reading with peek-based binary detection
- Added configurable hashing controls (`--no-hash-files`, `--max-hash-file-size`)

⏳ **Future**: Language support for Python, Rust, Go

## Architecture

- **Engine**: Filesystem traversal, budget enforcement, canonical output, concurrent processing
- **Detectors**: Ecosystem identification and preset selection
- **Collectors**: Language-specific metadata extraction with bounded concurrency
- **Artifacts**: JSON/text outputs with JSON Schema validation
- **CLI**: Simple argument parsing without external dependencies for minimal overhead

Built with strict TypeScript, ESM-only, following deterministic and testable patterns. Dependencies kept minimal: only `ignore`, `picomatch`, `zod`, and `vitest` for core functionality.
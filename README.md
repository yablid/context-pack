# Context Pack CLI

**Production-Ready** deterministic CLI for creating language-aware context packs of codebases—safe to share publicly, rich enough for architectural reviews, refactors, and API surface audits.

## Features

- **Safe by design**: No source code bodies, no secrets, only metadata (hashes, counts, names, and schema information)
- **Deterministic output**: Same inputs → identical outputs across runs
- **Schema validated**: All artifacts validated against zod schemas with detailed error reporting and inline failure details
- **Language-aware**: TypeScript/ESM support with comprehensive collectors
- **Budget-conscious**: Configurable size limits with intelligent downsampling
- **Monorepo-friendly**: Detects pnpm, npm, yarn workspaces automatically

## Quick Start

```bash
# Install globally (after building)
pnpm link --global

# Generate a context pack for current directory
context-pack .

# Detect ecosystem and available collectors
context-pack detect .

# Generate with different detail levels
context-pack . --level summary     # ≤ 500KB
context-pack . --level contracts   # ≤ 1.5MB (default)
context-pack . --level full-api    # ≤ 2MB

# View available JSON schemas
context-pack schema

# Validate existing context pack
context-pack validate ./.contextpack --verbose

# Generate with validation (strict mode fails after pack creation)
context-pack . --strict
```

## Output Structure

```
.contextpack/
  00-pack.json              # Pack metadata and generation info
  10-repo-topology.json     # Workspace structure and dependencies
  20-files-manifest.ndjson  # File inventory with hashes, LOC, and byte metrics
  30-import-graph.json      # Import/dependency graph with degrees, reachability, SCC analysis
  40-duplication-report.json # Code duplication metrics
  ts/                       # TypeScript-specific artifacts
    50-tsconfigs.json       # TypeScript configuration analysis
    60-exports.json         # Package exports mapping
    80-schema-index.json    # Schema definitions catalog
    90-type-metrics.json    # TypeScript usage metrics
```

## Development

This project uses pnpm for package management.

```bash
pnpm install
pnpm build
pnpm dev     # Watch mode
```

## Production Status

✅ **Complete & Production-Ready**:
- **Core Engine**: File walking, budget management, canonical JSON output
- **Detector System**: Ecosystem detection (pnpm, npm, TypeScript)
- **Collectors**: Files manifest, topology, import graph, exports, type metrics, duplication, schema index, TSConfig
- **CLI Interface**: Complete with main, detect, validate, schema, summarize commands
- **Validation**: Comprehensive zod schema validation with inline failure reporting
- **Error Handling**: Structured error system with exit codes and recovery
- **Security**: Path validation, traversal protection, no code body exposure

⏳ **Future**: Language support for Python, Rust, Go

## Architecture

- **Engine**: Filesystem traversal, budget enforcement, canonical output
- **Detectors**: Ecosystem identification and preset selection
- **Collectors**: Language-specific metadata extraction (plugin architecture)
- **Artifacts**: JSON/text outputs with JSON Schema validation

Built with strict TypeScript, ESM-only, following deterministic and testable patterns.
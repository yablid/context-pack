# Context Packs Guide

Context packs provide comprehensive, metadata-only analysis of codebases suitable for LLM agents and architectural review. They contain rich structural information without exposing source code bodies.

## Overview

A context pack is a deterministic snapshot of your codebase's architecture, dependencies, configuration, and quality metrics. It answers key questions agents need:

- What files exist and how are they organized?
- How do modules depend on each other?
- What functions and types are exported?
- What external dependencies are used?
- What's the TypeScript configuration?
- Where is code duplicated?

## Generation

### Basic Usage

```bash
# Generate a context pack for the current directory
context-pack .

# Specify a different directory
context-pack /path/to/project

# Generate with verbose output
context-pack . --verbose
```

### Detail Levels

Context packs are generated in three sizes to match different context windows:

```bash
# Summary level - essential info only (~7K tokens)
context-pack . --level summary

# Contracts level - balanced detail (default, ~11K tokens)
context-pack . --level contracts

# Full API level - comprehensive analysis (~18K tokens)
context-pack . --level full-api

# Deep level - maximum detail (~25K tokens)
context-pack . --level deep
```

### Output Formats

```bash
# JSON format (default)
context-pack . --format json

# NDJSON format for streaming
context-pack . --format ndjson
```

## Pack Structure

Context packs are organized into size-variant directories:

```
.contextpack/
├── TOKEN_COUNTS.txt          # Token estimates for all variants
├── full/                     # Complete analysis
│   ├── 00-pack.json         # Pack metadata
│   ├── 10-repo-topology.json # Repository structure
│   ├── 20-files-manifest.ndjson # File inventory
│   ├── 30-import-graph.json # Dependency graph
│   ├── 40-duplication-report.json # Code similarity
│   └── ts/                  # TypeScript artifacts
│       ├── 50-tsconfigs.json
│       ├── 60-exports.json
│       ├── 80-schema-index.json
│       └── 90-type-metrics.json
├── short/                   # Essential structure
├── minimal/                 # Quick reference
└── scoped/                  # Symbol-level context (with --scope)
```

## Artifacts Reference

### Core Artifacts

#### `00-pack.json` - Pack Metadata
Contains generation info, git state, budgets, and validation status.

**Key fields:**
- `timestamp`: When the pack was generated
- `commit`: Git commit hash and branch info
- `budgets`: Size limits and actual usage
- `collectors`: Which collectors ran and their health status
- `validation`: Schema validation results

**Agent value:** Establish trust and completeness of the analysis.

#### `10-repo-topology.json` - Repository Structure
Workspace analysis, package.json parsing, and dependency relationships.

**Key fields:**
- `packages`: Detected packages and their metadata
- `workspaces`: Monorepo workspace configuration
- `lockfiles`: Package manager detection (pnpm/npm/yarn)
- `dependencies`: External dependency lists

**Agent value:** Understand project boundaries and build system architecture.

#### `20-files-manifest.ndjson` - File Inventory
Complete file listing with metadata (one JSON object per line).

**Key fields per file:**
- `path`: Relative file path
- `sizeBytes`: File size in bytes
- `lineCount`: Number of lines (for text files)
- `hash`: SHA-256 hash (if enabled)
- `category`: source/config/asset/test/etc
- `riskBucket`: safe/normal/extended based on content

**Agent value:** Understand codebase scope, locate configuration, identify test patterns.

#### `30-import-graph.json` - Dependency Graph
Module relationships and architectural analysis.

**Key fields:**
- `nodes`: All files with import/export information
- `edges`: Import relationships between files
- `externalDependencies`: Third-party package usage
- `stats`: Graph metrics (roots, leaves, cycles)
- `stronglyConnectedComponents`: Circular dependency analysis

**Agent value:** Critical for understanding architecture and change impact.

#### `40-duplication-report.json` - Code Quality
Code similarity analysis and refactoring opportunities.

**Key fields:**
- `clusters`: Groups of similar code
- `similarity`: File-to-file similarity metrics
- `compression`: How much the codebase could be compressed

**Agent value:** Identify refactoring opportunities and code patterns.

### TypeScript Artifacts

#### `ts/50-tsconfigs.json` - TypeScript Configuration
Parsed TypeScript configuration with resolved settings.

**Key fields:**
- `configs`: All tsconfig.json files found
- `compilerOptions`: Resolved TypeScript compiler settings
- `includes`/`excludes`: File patterns
- `strictness`: Analysis of type safety settings

**Agent value:** Understand project's TypeScript setup for suggesting compatible changes.

#### `ts/60-exports.json` - API Surface
All exported functions, types, and interfaces organized by file.

**Key fields:**
- `files`: Per-file export listings
- `exports`: Function signatures, type definitions, interface shapes
- `reexports`: Re-exported symbols and their origins

**Agent value:** Understand public APIs without reading source code.

#### `ts/80-schema-index.json` - Schema Definitions
Validation patterns and data contracts found in the codebase.

**Key fields:**
- `schemas`: Zod schemas, JSON Schema definitions
- `validators`: Validation function patterns
- `types`: Type definitions used for validation

**Agent value:** Understand data validation approaches for consistency.

#### `ts/90-type-metrics.json` - TypeScript Usage
Analysis of TypeScript adoption and type safety patterns.

**Key fields:**
- `usage`: Counts of `any`, `unknown`, type assertions
- `features`: Modern TypeScript feature adoption
- `strictness`: Type safety indicators

**Agent value:** Assess TypeScript maturity and suggest improvements.

## Configuration

### Budget Control

```bash
# Set maximum output size (default: 1.5MB)
context-pack . --budget-bytes 2000000

# Use preset budgets
context-pack . --level summary    # 500KB
context-pack . --level contracts  # 1.5MB
context-pack . --level full-api   # 2MB
```

### File Processing

```bash
# Skip file hashing for speed
context-pack . --no-hash-files

# Limit hashing to smaller files
context-pack . --max-hash-file-size 5

# Control concurrency
context-pack . --concurrency 6
```

### Validation

```bash
# Strict validation (fails on warnings)
context-pack . --strict

# Skip validation for speed
context-pack . --no-validate

# Validate existing pack
context-pack validate ./.contextpack
```

## Best Practices

### For LLM Agents

1. **Start with `minimal/`** for quick questions
2. **Use `short/`** for most development tasks
3. **Use `full/`** for architectural analysis
4. **Check `00-pack.json`** first to understand generation context

### For Development

1. **Use `--verbose`** during development for debugging
2. **Use `--no-hash-files`** for faster iteration
3. **Use `--strict`** in CI for validation
4. **Version control the pack** for reproducibility

### Performance Tips

1. **Increase `--concurrency`** on powerful machines
2. **Use `--no-hash-files`** for large codebases during development
3. **Set `--max-hash-file-size`** to skip hashing large files
4. **Use `.gitignore`** to exclude unnecessary files

## Troubleshooting

### Common Issues

**"Budget exceeded" warnings:**
- Increase budget with `--budget-bytes`
- Use lower detail level (`--level summary`)
- Exclude files with better `.gitignore` patterns

**"Validation failed" errors:**
- Check specific validation errors with `--verbose`
- Use `--no-validate` to skip validation temporarily
- File issues for unexpected validation failures

**Slow generation:**
- Use `--no-hash-files` to skip hashing
- Increase `--concurrency` if you have CPU cores
- Exclude large directories in `.gitignore`

### Performance Benchmarks

Typical performance on a modern laptop:

- **Small project** (< 100 files): 1-2 seconds
- **Medium project** (< 1000 files): 3-5 seconds
- **Large project** (< 10000 files): 10-30 seconds

Generation time scales primarily with file count, not file size, due to peek-based binary detection.

## Integration

### CI/CD Pipelines

```bash
# Generate pack and validate in CI
context-pack . --strict --verbose

# Generate minimal pack for fast feedback
context-pack . --level summary --no-hash-files
```

### IDE Integration

Context packs work well with IDE extensions that can consume structured codebase information. The JSON artifacts provide a standardized format for tools to understand project structure.

### API Usage

While primarily a CLI tool, the core engine can be imported for programmatic use:

```typescript
import { ContextPackEngine } from 'context-pack';

const engine = new ContextPackEngine(config);
const artifacts = await engine.generate(path);
```

## Security Considerations

Context packs are designed to be safe for sharing:

- **No source code bodies** included by default
- **Hash-based file identification** instead of content
- **Path validation** to prevent traversal attacks
- **Secret detection** in file paths and names
- **Size limits** to prevent resource exhaustion

However, some metadata could still be sensitive:

- File and directory names
- Import/export names
- Configuration values
- Package dependencies

Review the generated pack before sharing publicly.
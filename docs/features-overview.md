# Context-Pack Suite Documentation

The Context-Pack Suite provides four coordinated features for LLM-friendly codebase analysis and context extraction.

## Features Overview

### 🏗️ [Context Packs](./context-pack.md)
**Metadata-only codebase analysis**
- Comprehensive architectural overview
- Import graphs and dependency analysis
- TypeScript exports and type metrics
- Repository topology and file manifests
- Safe for sharing (no code bodies)

### 🎯 [Scoped Packs](./scoped.md)
**Symbol-level code extraction**
- Focused code slices around specific functions/classes
- Dependency graphs with ranking algorithms
- TypeScript stubs for external dependencies
- Requires explicit permission for code bodies

### 📊 [Refactor Reports](./refactor-report.md)
**Architectural analysis and suggestions**
- Circular dependency detection
- Fan-in/fan-out analysis
- Re-export hub identification
- Risk assessment and suggested improvements
- Works from existing context pack artifacts

### 📋 [Paste Packs](./paste-pack.md)
**Single-file code sharing**
- Multi-file consolidation with clear separators
- Budget enforcement (files, LOC, bytes)
- Secret detection and redaction
- Signatures-only or full-code modes

## Quick Start

```bash
# Install
npm install -g context-pack

# Basic context pack
context-pack .

# All features combined
context-pack . \
  --scope src/types.ts#Config --scope-allow-code \
  --refactor-report \
  --paste-pack
```

## Documentation Index

- **[CLI Reference](./cli.md)** - Complete command-line documentation
- **[Context Packs](./context-pack.md)** - Metadata-only codebase analysis
- **[Scoped Packs](./scoped.md)** - Symbol-level code extraction
- **[Refactor Reports](./refactor-report.md)** - Architectural analysis
- **[Paste Packs](./paste-pack.md)** - Single-file code sharing
- **[Subagent Guide](./subagent.md)** - Integration with agentic workflows

## Architecture

The suite uses clean architecture with shared core services:

```
core/          # Shared services (file walking, TypeScript analysis, etc.)
├── walker/    # File system traversal with ignore rules
├── ts-program/ # TypeScript compilation and symbol resolution
├── graph/     # Import/export graph analysis
├── tokens/    # Budget management and token counting
├── security/  # Path validation and secret redaction
└── validation/ # Schema validation with Zod

features/      # Four main features
├── context-pack/   # Metadata-only analysis
├── scoped-pack/    # Symbol-level code extraction
├── refactor-report/ # Architectural analysis
└── paste-pack/     # Single-file code sharing

formatters/    # Output formats (JSON, NDJSON, paste text)
└── CLI        # Thin command-line interface
```

## Common Workflows

### Development
```bash
# Quick architecture overview
context-pack . --level summary

# Focus on specific component
context-pack . --scope src/auth.ts#validateUser --scope-allow-code

# Check for architectural issues
context-pack . --refactor-report --refactor-format paste
```

### Code Review
```bash
# Share feature context
context-pack ./src/new-feature --paste --paste-allow-code --paste-max-files 15

# Generate comprehensive analysis
context-pack . --level contracts --refactor-report
```

### CI/CD
```bash
# Validate architecture
context-pack . --refactor-report
context-pack . --validate-only --strict

# Generate documentation context
context-pack . --level contracts --paste-pack
```

## Security Model

- **Safe by default**: Context packs and refactor reports contain no code bodies
- **Explicit opt-in**: Scoped and paste packs require `--allow-code` flags
- **Automatic redaction**: Secret detection in all code-emitting features
- **Budget enforcement**: Size limits prevent resource exhaustion
- **Path validation**: Protection against directory traversal

## Support

- **CLI Help**: `context-pack --help`
- **Issues**: [GitHub Issues](https://github.com/your-org/context-pack/issues)
- **Examples**: See individual feature documentation for detailed examples
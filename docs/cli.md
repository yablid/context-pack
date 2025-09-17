# CLI Reference

Complete command-line interface reference for the Context Pack CLI.

## Basic Commands

### `context-pack [path]`

Generate a context pack for the specified directory.

```bash
context-pack .                    # Current directory
context-pack /path/to/project     # Specific directory
context-pack                      # Current directory (implicit)
```

### `context-pack detect [path]`

Analyze directory and show detected ecosystems and available collectors.

```bash
context-pack detect .
context-pack detect /path/to/project
```

### `context-pack schema [name]`

Display JSON schemas for artifacts.

```bash
context-pack schema               # List all available schemas
context-pack schema pack          # Show pack metadata schema
context-pack schema exports       # Show exports schema
```

### `context-pack validate <pack-path>`

Validate an existing context pack against schemas.

```bash
context-pack validate ./.contextpack
context-pack validate /path/to/pack --strict
```

## Generation Options

### Detail Levels

Control the amount of detail and output size:

```bash
--level summary     # ≤ 500KB, essential info only
--level contracts   # ≤ 1.5MB, balanced detail (default)
--level full-api    # ≤ 2MB, comprehensive analysis
--level deep        # ≤ 5MB, maximum detail
```

### Output Format

```bash
--format json       # JSON format (default)
--format ndjson     # Newline-delimited JSON for streaming
```

### Budget Control

```bash
--budget-bytes <number>         # Maximum output size in bytes
--deterministic                 # Force deterministic output (default: true)
```

### File Processing

```bash
--hash-files                    # Enable SHA-256 file hashing (default)
--no-hash-files                 # Skip file hashing for speed
--max-hash-file-size <mb>       # Only hash files up to N MB (default: 10)
```

### Performance

```bash
--concurrency <number>          # Max concurrent collectors (default: 3)
--verbose                       # Detailed output and timing information
```

### Validation

```bash
--validate-schemas              # Validate against JSON schemas (default)
--no-validate                   # Skip schema validation
--strict                        # Strict validation mode (warnings become errors)
```

### Output Directory

```bash
--out <directory>               # Output directory (default: .contextpack)
```

## Scoped Pack Options

### Basic Scoped Generation

```bash
--scope <FQN>                   # Generate scoped pack for symbol
--scope-allow-code              # Required: allow code body emission
```

### Scoped Configuration

```bash
--scope-budget <tokens>         # Token budget for code slices (default: 20000)
--scope-mode static             # Analysis mode: static or hybrid (default: static)
--scope-include <list>          # Include tests,docs in analysis
```

### FQN (Fully Qualified Name) Formats

```bash
# Named exports
--scope src/types.ts#BuildConfig
--scope src/utils.ts#validateConfig

# Class members
--scope src/auth.ts#UserService.authenticate
--scope src/api.ts#Router.handleRequest

# Default exports
--scope src/server.ts#default

# Line/column positions
--scope src/complex.ts#line:42:15
```

## Examples

### Basic Context Packs

```bash
# Quick analysis
context-pack . --level summary

# Default analysis with verbose output
context-pack . --verbose

# Large project with performance tuning
context-pack . --level contracts --concurrency 6 --no-hash-files

# CI/production with strict validation
context-pack . --strict --no-hash-files --concurrency 1
```

### Scoped Packs

```bash
# Interface analysis
context-pack . --scope src/types.ts#BuildConfig --scope-allow-code

# Class with increased budget
context-pack . --scope src/engine.ts#Parser --scope-budget 30000 --scope-allow-code

# Include tests and docs
context-pack . --scope src/auth.ts#validate --scope-include tests,docs --scope-allow-code

# Method-specific analysis
context-pack . --scope src/utils.ts#Formatter.render --scope-allow-code
```

### Advanced Usage

```bash
# Custom output location
context-pack . --out ./analysis --level deep

# Maximum performance
context-pack . --concurrency 8 --no-hash-files --no-validate

# Development workflow
context-pack . --verbose --format ndjson --level summary

# Validation only
context-pack validate ./.contextpack --strict --verbose
```

## Global Flags

These flags work with all commands:

```bash
--help              # Show help information
--version           # Show version number
--verbose           # Enable detailed output
--quiet             # Suppress non-error output
```

## Exit Codes

The CLI uses standard exit codes:

- `0`: Success
- `1`: General error (file not found, permission denied)
- `2`: Invalid arguments or configuration
- `3`: Validation failed (with --strict)
- `4`: Budget exceeded (hard limit)
- `5`: Collector failure (unrecoverable)

## Environment Variables

### Configuration

```bash
export CONTEXT_PACK_BUDGET=2000000      # Default budget in bytes
export CONTEXT_PACK_CONCURRENCY=4       # Default concurrency
export CONTEXT_PACK_LEVEL=contracts     # Default detail level
```

### Performance

```bash
export CONTEXT_PACK_HASH_FILES=false    # Skip hashing by default
export CONTEXT_PACK_MAX_HASH_SIZE=5     # Hash file size limit (MB)
```

### Development

```bash
export CONTEXT_PACK_VERBOSE=true        # Enable verbose output
export CONTEXT_PACK_VALIDATE=false      # Skip validation
```

## Configuration Files

### `.contextpackrc`

JSON configuration file in project root:

```json
{
  "level": "contracts",
  "budgetBytes": 1500000,
  "hashFiles": true,
  "maxHashFileSizeMB": 10,
  "concurrency": 3,
  "format": "json",
  "validateSchemas": true,
  "out": ".contextpack"
}
```

### Package.json Integration

Add configuration to `package.json`:

```json
{
  "contextpack": {
    "level": "summary",
    "excludes": ["dist", "coverage"],
    "hashFiles": false
  }
}
```

## Preset Configurations

### Development Preset

Fast generation for development use:

```bash
context-pack . --level summary --no-hash-files --concurrency 6 --no-validate
```

### CI Preset

Reliable generation for continuous integration:

```bash
context-pack . --level contracts --strict --concurrency 1 --max-hash-file-size 5
```

### Production Preset

Comprehensive analysis for production review:

```bash
context-pack . --level deep --strict --deterministic --verbose
```

## Debugging Options

### Verbose Output

```bash
--verbose           # Show detailed progress and timing
-v                  # Short form of --verbose
```

Sample verbose output:
```
Context Pack CLI v0.1.0
=== Context Pack Generation ===
Analyzing: .
Preset: ts-simple
Level: contracts
Budget: 1,500,000 bytes

[files-manifest] Processing 72 files
[files-manifest] Generated manifest (12,485 bytes)
[topology] Analyzing repository topology
[import-graph] Building dependency graph (25,361 bytes)

Validating artifacts against schemas...
Valid artifacts: 8/8
Context pack generated: ./.contextpack
Total size: 58,060 bytes
Completed in 4.2s
```

### Schema Validation Details

```bash
--validate-schemas --verbose    # Show validation details
--strict --verbose             # Show all warnings as errors
```

### Performance Profiling

```bash
--verbose                      # Shows timing for each collector
```

## Common Workflows

### Daily Development

```bash
# Quick check of current state
context-pack . --level summary --no-hash-files

# Focus on specific symbol
context-pack . --scope src/api.ts#handleRequest --scope-allow-code
```

### Code Review Preparation

```bash
# Comprehensive analysis
context-pack . --level deep --strict

# Include scoped analysis of key changes
context-pack . --scope src/changes.ts#newFeature --scope-allow-code --scope-include tests
```

### CI/CD Integration

```bash
# Fast validation
context-pack . --validate-only --strict --no-hash-files

# Archive generation
context-pack . --level contracts --out ./artifacts --deterministic
```

### Performance Debugging

```bash
# Profile generation time
time context-pack . --verbose --level deep

# Test concurrency impact
context-pack . --concurrency 1 --verbose
context-pack . --concurrency 8 --verbose
```

## Error Messages

### Common Errors and Solutions

**"Path does not exist":**
- Check the directory path is correct
- Ensure you have read permissions

**"Budget exceeded":**
- Use `--level summary` for smaller output
- Increase budget with `--budget-bytes`
- Use `--no-hash-files` to reduce size

**"Validation failed":**
- Check specific errors with `--verbose`
- Use `--no-validate` to skip validation
- File bug report if validation seems incorrect

**"Could not resolve symbol"** (scoped packs):
- Verify FQN format: `path#symbolName`
- Check symbol is exported
- Use line:column format as fallback

**"Permission denied":**
- Check directory permissions
- Ensure output directory is writable

### Debug Commands

```bash
# Test directory access
context-pack detect . --verbose

# Validate existing pack
context-pack validate ./.contextpack --verbose

# Check schema definitions
context-pack schema --verbose
```

## Integration Examples

### GitHub Actions

```yaml
- name: Generate Context Pack
  run: |
    npm install -g context-pack
    context-pack . --level contracts --strict --out ./pack

- name: Upload Pack
  uses: actions/upload-artifact@v3
  with:
    name: context-pack
    path: ./pack
```

### Pre-commit Hook

```bash
#!/bin/sh
# .git/hooks/pre-commit
context-pack . --validate-only --strict --quiet
```

### VS Code Task

```json
{
  "label": "Generate Context Pack",
  "type": "shell",
  "command": "context-pack",
  "args": [".", "--verbose"],
  "group": "build"
}
```

## Determinism and Reliability

Context packs provide enterprise-grade determinism guarantees:

### Cross-Platform Consistency
- **Line ending normalization**: CRLF automatically converted to LF on all platforms
- **Path normalization**: All paths use forward slashes regardless of OS
- **Encoding consistency**: UTF-8 handling standardized across file operations

### Reproducible Output
- **Stable artifacts**: Same inputs produce identical byte-for-byte output
- **No volatile timestamps**: Generated files contain no changing timestamps
- **Deterministic ordering**: Arrays and objects sorted consistently
- **Budget reproducibility**: Identical budget allocations for identical configurations

### Validation Support
- **SHA256 comparisons**: Reliable hash validation for CI/CD pipelines
- **Cache-friendly**: Deterministic output enables effective build caching
- **Version control safe**: Generated artifacts can be committed reliably

These guarantees enable reliable validation, caching, and comparison workflows in production environments.
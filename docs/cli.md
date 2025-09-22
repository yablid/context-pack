# CLI Reference

Complete command-line interface reference for the Context Pack CLI.

## Three Core Commands

### `context-pack [path]` or `ctxp [path]`

Generate a context pack for the specified directory (default mode).

```bash
ctxp                              # Current directory
ctxp .                            # Current directory (explicit)
ctxp /path/to/project             # Specific directory
# Or use the full command:
context-pack .                    # Same as ctxp .
```

### `ctxp [path] --scope <symbol>`

Generate scoped pack for a specific function or symbol.

```bash
ctxp . --scope src/api.ts#handleUser
ctxp . --scope src/utils.ts#line:42:10
ctxp . --scope src/types.ts#Config
```

### `ctxp [path] --paste`

Generate single-file paste pack for code sharing (outputs to stdout).

```bash
ctxp . --paste                         # Current directory to stdout
ctxp src/ --paste                      # Specific directory to stdout
ctxp . --paste --paste-allow-code      # Include full code bodies
ctxp . --paste > output.txt            # Redirect to file
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
                               # Note: paste mode outputs to stdout, not --out
```

## Feature-Specific Options

### Scoped Pack Options

```bash
--scope <FQN>                   # Generate scoped pack for symbol
--scope-allow-code              # Required: allow code body emission
--scope-budget <tokens>         # Token budget for code slices (default: 20000)
--scope-mode static             # Analysis mode: static or hybrid (default: static)
--scope-include <list>          # Include tests,docs in analysis
```

### Refactor Report Options

```bash
--refactor-report               # Generate refactor analysis report
--refactor-format json          # Output format: json or paste (default: json)
--refactor-import-graph <path>  # Custom import graph artifact path
--refactor-exports <path>       # Custom exports artifact path
```

### Paste Pack Options

```bash
--paste-pack                    # Generate single-file paste pack
--paste-allow-code              # Include full code bodies (default: signatures only)
--paste-include <patterns>      # Include file patterns (e.g., "*.ts,*.js")
--paste-exclude <patterns>      # Exclude file patterns
--paste-max-files <number>      # Maximum files to include (default: 100)
--paste-max-loc <number>        # Maximum lines of code (default: 50000)
--paste-max-bytes <number>      # Maximum bytes (default: 2MB)
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
ctxp . --level summary

# Default analysis with verbose output
ctxp . --verbose

# Large project with performance tuning
ctxp . --level contracts --concurrency 6 --no-hash-files

# CI/production with strict validation
ctxp . --strict --no-hash-files --concurrency 1
```

### Scoped Packs

```bash
# Interface analysis
ctxp . --scope src/types.ts#BuildConfig --scope-allow-code

# Class with increased budget
ctxp . --scope src/engine.ts#Parser --scope-budget 30000 --scope-allow-code

# Include tests and docs
ctxp . --scope src/auth.ts#validate --scope-include tests,docs --scope-allow-code

# Method-specific analysis
ctxp . --scope src/utils.ts#Formatter.render --scope-allow-code
```

### Refactor Analysis

```bash
# Basic refactor report
ctxp . --refactor-report

# Paste format for easy reading
ctxp . --refactor-report --refactor-format paste

# Alternative command format
ctxp . --refactor-report

# Custom artifact paths
ctxp . --refactor-report --refactor-import-graph ./custom/import-graph.json
```

### Paste Packs

```bash
# Signatures only (safe for sharing) - outputs to stdout
ctxp ./src --paste

# Full code bodies (careful with secrets) - outputs to stdout
ctxp ./src --paste --paste-allow-code

# Redirect to file
ctxp ./src --paste > paste-output.txt

# Filtered by file type
ctxp . --paste --paste-include "*.ts,*.js" --paste-exclude "*.test.ts"

# With budget limits
ctxp . --paste --paste-max-files 50 --paste-max-loc 10000
```

### Advanced Usage

```bash
# Custom output location
ctxp . --out ./analysis --level deep

# Maximum performance
ctxp . --concurrency 8 --no-hash-files --no-validate

# Development workflow
ctxp . --verbose --format ndjson --level summary

# All features combined
ctxp . --scope src/types.ts#Config --scope-allow-code --refactor-report --paste-pack

# Multiple features combined
ctxp . --scope src/api.ts#handler --refactor-report --verbose
```

## Global Flags

These flags work with all commands:

```bash
--help              # Show help information
--version           # Show version number
--verbose           # Enable detailed output
```

## Exit Codes

The CLI uses standard exit codes:

- `0`: Success
- `1`: General error (file not found, permission denied)
- `2`: Invalid arguments or configuration
- `3`: Validation failed (with --strict)
- `4`: Budget exceeded (hard limit)
- `5`: Collector failure (unrecoverable)

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
ctxp . --level summary --no-hash-files --concurrency 6 --no-validate
```

### CI Preset

Reliable generation for continuous integration:

```bash
ctxp . --level contracts --strict --concurrency 1 --max-hash-file-size 5
```

### Production Preset

Comprehensive analysis for production review:

```bash
ctxp . --level deep --strict --deterministic --verbose
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
ctxp . --level summary --no-hash-files

# Focus on specific symbol
ctxp . --scope src/api.ts#handleRequest --scope-allow-code
```

### Code Review Preparation

```bash
# Comprehensive analysis
ctxp . --level deep --strict

# Include scoped analysis of key changes
ctxp . --scope src/changes.ts#newFeature --scope-allow-code --scope-include tests
```

### CI/CD Integration

```bash
# Fast validation
ctxp . --validate-only --strict --no-hash-files

# Archive generation
ctxp . --level contracts --out ./artifacts --deterministic
```

### Performance Debugging

```bash
# Profile generation time
time ctxp . --verbose --level deep

# Test concurrency impact
ctxp . --concurrency 1 --verbose
ctxp . --concurrency 8 --verbose
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
# Test basic functionality
ctxp . --verbose --level summary

# Test scoped analysis
ctxp . --scope src/main.ts#main --scope-plan-only --verbose

# Test paste generation
ctxp . --paste --verbose --paste-max-files 5
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
context-pack . --validate-only --strict
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
# Paste Packs Guide

Paste packs provide single-file directory dumps with redaction and budgets, optimized for copying code to LLMs or sharing context in text format. They consolidate multiple files into one labeled text file with stable separators.

## Overview

Paste packs solve the "I need to share this code" problem by creating copy-friendly text files that:

- Combine multiple files into a single text document
- Include clear file boundaries and metadata
- Respect budget limits (files, lines of code, bytes)
- Automatically detect and redact secrets
- Support both signatures-only and full-code modes
- Use stable separators that LLMs understand

They're perfect for code sharing, documentation, and feeding context to language models.

## Basic Usage

### Generating Paste Packs

```bash
# Generate paste pack for current directory (signatures only)
context-pack . --paste

# Generate for specific directory
context-pack ./src --paste

# Include full code bodies (be careful with secrets)
context-pack . --paste --paste-allow-code

# Use integrated mode with other features
context-pack . --paste-pack
```

**Security Note:** By default, paste packs only include type signatures and exports. Use `--paste-allow-code` to include implementation bodies.

### Output Location

Paste packs are written to `.contextpack/paste-pack.txt` by default.

## Configuration Options

### Content Control

```bash
# Include full code bodies (default: signatures only)
--paste-allow-code

# Include only specific file extensions
--paste-include "*.ts,*.js,*.md"

# Exclude specific patterns
--paste-exclude "*.test.ts,*.spec.js"

# Exclude entire directories
--paste-exclude "tests/,coverage/"
```

### Budget Limits

```bash
# Maximum number of files (default: 100)
--paste-max-files 100

# Maximum lines of code (default: 50,000)
--paste-max-loc 25000

# Maximum total bytes (default: 2MB)
--paste-max-bytes 1500000
```

When budgets are exceeded, files are excluded in discovery order with clear reasons in the output.

## Output Structure

### Paste Format

Paste packs use stable, LLM-friendly separators:

```
==== SECTION: HEADER ====
Generated: 2024-01-15T10:30:00Z
Root: /path/to/project
Allow Code Bodies: false

==== INDEX ====
Included Files:
  src/types.ts (45 LOC, 1250 bytes)
  src/utils.ts (78 LOC, 2100 bytes)

Excluded Files:
  tests/setup.ts - excluded directory
  dist/bundle.js - excluded directory

==== FILE: src/types.ts (LOC 45) ====
export interface BuildConfig {
  level: 'summary' | 'contracts';
  budgetBytes: number;
  // ... more content
}

==== FILE: src/utils.ts (LOC 78) ====
import type { BuildConfig } from './types.js';

export function validateConfig(config: BuildConfig): boolean {
  // ... implementation
}

==== SUMMARY ====
Total: 2 files, 123 LOC, 3350 bytes
Excluded: 15 files

==== END ====
```

### Section Types

- **HEADER**: Generation metadata and configuration
- **INDEX**: File listing with inclusion/exclusion reasons
- **FILE**: Individual file contents with path and line count
- **SUMMARY**: Aggregate statistics
- **END**: Clear termination marker

## Content Modes

### Signatures Only (Default)

Safe for sharing, includes only:
- Type definitions and interfaces
- Function signatures (no implementations)
- Class definitions (no method bodies)
- Import/export statements
- Comments and documentation
- Public API surface

```typescript
// Example signatures-only output
export interface Config {
  mode: string;
  verbose: boolean;
}

export class Parser {
  constructor(config: Config);
  parse(input: string): Result;
  // Implementation body omitted
}
```

### Full Code Bodies

Includes complete implementations when `--paste-allow-code` is used:
- All source code content
- Function and method implementations
- Private members and internal logic
- **Automatic secret detection and redaction**

## Secret Detection

When full code bodies are enabled, paste packs automatically detect and redact common secrets:

### Detected Secret Types

- **PEM Certificates/Keys**: `-----BEGIN/END-----` blocks
- **AWS Access Keys**: `AKIA*` patterns and secret key variables
- **API Keys**: `api_key`/`API_KEY` variables with long values
- **JWT Tokens**: Basic JWT structure detection
- **Database URLs**: Connection strings with embedded passwords
- **Private Keys**: `private_key`/`privateKey` assignments

### Redaction Behavior

```typescript
// Original code
const apiKey = "sk-1234567890abcdef";
const dbUrl = "postgres://user:secret@host/db";

// Redacted output
const apiKey = "[REDACTED_API_KEY]";
const dbUrl = "[REDACTED_DATABASE_URL]";
```

**Warning Logs:**
```
Warning: Detected secrets in src/config.ts: API key, database URL
```

Redaction preserves code structure while protecting sensitive data.

## File Filtering

### Include Patterns

```bash
# Include only TypeScript files
--paste-include "*.ts"

# Include multiple extensions
--paste-include "*.ts,*.js,*.md"

# Include specific paths
--paste-include "src/**,docs/**"
```

### Exclude Patterns

```bash
# Exclude test files
--paste-exclude "*.test.ts,*.spec.js"

# Exclude directories
--paste-exclude "tests/,coverage/,dist/"

# Complex exclusions
--paste-exclude "**/*.test.ts,**/node_modules/**,**/.git/**"
```

### Default Exclusions

Always excluded by default:
- `.git/` directories
- `node_modules/` directories
- `dist/` and `build/` directories
- `.contextpack/` directories
- `*.log` files

## Budget Management

### File Limits

```bash
# Limit to 50 files maximum
--paste-max-files 50
```

When file limit is reached, remaining files are excluded with reason: "budget exceeded"

### Line of Code Limits

```bash
# Limit to 25,000 lines of code
--paste-max-loc 25000
```

Files are processed in order until LOC budget is exhausted.

### Byte Limits

```bash
# Limit to 1.5MB total
--paste-max-bytes 1500000
```

Total output size includes all content, headers, and separators.

### Budget Enforcement Order

1. **File count**: Stop when file limit reached
2. **LOC budget**: Skip files that would exceed line limit
3. **Byte budget**: Stop when total size approaches limit

Budget exceeded files are listed in the EXCLUDED section with clear reasons.

## Use Cases

### For LLM Context

**Code Review Preparation:**
```bash
# Generate signatures for architecture review
context-pack ./src --paste --paste-include "*.ts"

# Full implementation for debugging
context-pack ./src/bug-area --paste --paste-allow-code --paste-max-files 10
```

**Documentation Generation:**
```bash
# API documentation context
context-pack ./api --paste --paste-include "*.ts" --paste-exclude "*.test.ts"
```

### For Code Sharing

**Stack Overflow Questions:**
```bash
# Share minimal repro
context-pack ./repro --paste --paste-allow-code --paste-max-files 5
```

**Code Review:**
```bash
# Share feature branch changes
context-pack ./src/new-feature --paste --paste-allow-code
```

### For Team Collaboration

**Architecture Discussions:**
```bash
# Share module structure
context-pack ./core --paste --paste-include "*.ts" --paste-exclude "*.test.ts"
```

**Onboarding Context:**
```bash
# New team member overview
context-pack . --paste --paste-max-files 20 --paste-exclude "tests/,docs/"
```

## Best Practices

### Security

1. **Default to signatures**: Only use `--paste-allow-code` when necessary
2. **Review output**: Check generated files before sharing publicly
3. **Trust redaction**: Secret detection is comprehensive but not perfect
4. **Limit scope**: Use specific directories rather than entire projects

### Performance

1. **Use budgets**: Set reasonable limits to prevent massive outputs
2. **Filter early**: Use include/exclude patterns to reduce processing
3. **Target scope**: Paste specific directories rather than entire projects

### Quality

1. **Clean separators**: The `====` format is LLM-optimized
2. **Include index**: Recipients can see what's included/excluded
3. **Preserve structure**: File paths and LOC counts provide context
4. **Clear boundaries**: Each file section is clearly marked

## Example Workflows

### Feature Development Context

```bash
# Share feature implementation with team
context-pack ./src/features/new-auth --paste \
  --paste-allow-code \
  --paste-exclude "*.test.ts" \
  --paste-max-files 15
```

### Bug Report Context

```bash
# Create minimal reproduction for bug report
context-pack ./repro --paste \
  --paste-allow-code \
  --paste-max-files 5 \
  --paste-max-loc 500
```

### Architecture Review

```bash
# Share module signatures for architecture review
context-pack ./src/core --paste \
  --paste-include "*.ts" \
  --paste-exclude "*.test.ts,*.spec.ts"
```

### Documentation Context

```bash
# Generate context for documentation writing
context-pack ./src/public-api --paste \
  --paste-include "*.ts,*.md" \
  --paste-exclude "**/*.test.*"
```

## Integration with Other Features

### Combined Generation

```bash
# Generate context pack, scoped analysis, and paste pack together
context-pack . \
  --scope src/types.ts#Config --scope-allow-code \
  --paste-pack --paste-allow-code \
  --refactor-report
```

### With Context Packs

```bash
# Full analysis including paste pack
context-pack . --level contracts --paste-pack
```

### CI/CD Integration

```yaml
# GitHub Actions example
- name: Generate Paste Pack
  run: |
    context-pack ./src --paste \
      --paste-include "*.ts" \
      --paste-exclude "*.test.ts" \
      --paste-max-files 50

- name: Upload Paste Pack
  uses: actions/upload-artifact@v3
  with:
    name: code-context
    path: .contextpack/paste-pack.txt
```

## Advanced Usage

### Custom Budgets

```bash
# Large project with strict limits
context-pack . --paste \
  --paste-max-files 100 \
  --paste-max-loc 30000 \
  --paste-max-bytes 1000000
```

### Selective Inclusion

```bash
# Only specific modules
context-pack ./src --paste \
  --paste-include "*/types.ts,*/interfaces.ts,*/api.ts" \
  --paste-allow-code
```

### Documentation Focus

```bash
# Include docs and public APIs
context-pack . --paste \
  --paste-include "*.md,src/public/**/*.ts" \
  --paste-exclude "**/*.test.*,**/*.spec.*"
```

## Troubleshooting

### Common Issues

**"No files included":**
- Check include/exclude patterns
- Verify files exist in specified directory
- Review budget limits

**"Budget exceeded immediately":**
- Files are too large for specified budgets
- Increase limits or reduce scope
- Check for unexpectedly large files

**"Secret detection false positives":**
- Review redacted content carefully
- Consider if redaction is actually appropriate
- File issue if legitimate code is over-redacted

### Debug Information

```bash
# Verbose output shows file processing
context-pack . --paste --verbose

# Check what files would be included
ls -la src/ | head -20

# Test pattern matching
echo "src/types.ts" | grep -E "*.ts"
```

### Output Validation

```bash
# Check generated paste pack
wc -l .contextpack/paste-pack.txt
grep "====" .contextpack/paste-pack.txt

# Verify file count
grep "==== FILE:" .contextpack/paste-pack.txt | wc -l
```

## Limitations

### Current Limitations

1. **Pattern Matching**: Simple glob patterns only (no advanced regex)
2. **Content Detection**: Basic secret detection patterns
3. **Language Support**: Optimized for TypeScript/JavaScript
4. **Encoding**: UTF-8 text files only

### Planned Extensions

1. **Advanced Patterns**: Support for more sophisticated file matching
2. **Content Analysis**: Better detection of sensitive data
3. **Multi-Language**: Language-specific signature extraction
4. **Binary Support**: Handling of images, PDFs, etc.

## Security Considerations

### Safe by Default

- **Signatures only**: Default mode excludes implementation details
- **Automatic redaction**: Secret detection runs on all code bodies
- **Clear warnings**: Logs when secrets are detected and redacted
- **Size limits**: Budgets prevent accidental large outputs

### When Using Full Code

- **Review output**: Always check generated files before sharing
- **Understand risk**: Full code mode can expose sensitive information
- **Trust but verify**: Secret detection is good but not perfect
- **Scope carefully**: Use specific directories and file patterns

### Best Practices

1. **Start signatures-only**: Only enable full code when necessary
2. **Use version control**: Check paste packs before committing
3. **Limit scope**: Paste specific areas, not entire projects
4. **Review regularly**: Check that secret detection patterns are current

Paste packs provide a safe, convenient way to share code context while maintaining security and respecting practical size constraints.
# Scoped Packs Guide

Scoped packs provide symbol-level context extraction for coding agents, generating focused code slices and dependency graphs around specific functions, classes, or interfaces.

**Note:** Scoped packs are one of four integrated features in the Context-Pack Suite. See also: [Context Packs](./context-pack.md), [Refactor Reports](./refactor-report.md), and [Paste Packs](./paste-pack.md).

## Overview

While regular context packs provide metadata-only analysis, scoped packs extract **actual code slices** with proper dependency graphs for precise agent tasks. They answer focused questions:

- What code is needed to understand this specific function?
- What dependencies does this class rely on?
- What's the minimal context for modifying this interface?

Scoped packs are **opt-in** and **risk-gated** - they require explicit permission to emit code bodies.

## Basic Usage

### Generating Scoped Packs

```bash
# Extract context around a specific interface
context-pack . --scope src/types.ts#BuildConfig --scope-allow-code

# Extract context around a class
context-pack . --scope src/engine/canonical-json.ts#CanonicalJSON --scope-allow-code

# Extract context around a class method
context-pack . --scope src/engine/canonical-json.ts#CanonicalJSON.stringify --scope-allow-code
```

**Important:** The `--scope-allow-code` flag is **required** to emit code bodies. Without it, scoped pack generation will fail with a security error.

### FQN (Fully Qualified Name) Formats

Scoped packs use FQN strings to identify symbols:

```bash
# Named exports
--scope path/to/file.ts#exportName
--scope src/utils.ts#validateConfig

# Class members
--scope path/to/file.ts#ClassName.methodName
--scope src/auth.ts#UserService.authenticate

# Default exports
--scope path/to/file.ts#default

# Line/column fallback (when symbol name is unclear)
--scope path/to/file.ts#line:42:15
```

## Configuration

### Budget Control

```bash
# Set token budget for code slices (default: 20,000)
context-pack . --scope src/types.ts#Config --scope-budget 15000 --scope-allow-code

# Let the system use default budgets
context-pack . --scope src/types.ts#Config --scope-allow-code
```

### Mode Selection

```bash
# Static analysis only (default)
context-pack . --scope src/api.ts#handler --scope-mode static --scope-allow-code

# Hybrid mode (reserved for future dynamic analysis)
context-pack . --scope src/api.ts#handler --scope-mode hybrid --scope-allow-code
```

## Output Structure

Scoped packs are written to deterministic hash-based directories:

```
.contextpack/scoped/<hash>/
├── 00-scope.json         # Scoped pack metadata and configuration
├── 10-symbol-graph.json  # Dependency graph around target symbol
├── 20-slices.ndjson      # Code slices with context lines
├── 30-stubs.d.ts         # TypeScript declarations for external types
└── 40-index.ndjson       # Symbol → slice mapping
```

The `<hash>` is deterministic based on seed symbol, configuration, and codebase state.

## Artifacts Reference

### `00-scope.json` - Scoped Pack Metadata

Contains configuration, budgets, and generation results.

**Key fields:**
- `seed`: The FQN that was analyzed
- `mode`: Analysis mode (static/hybrid)
- `budgets`: Token and byte limits
- `policy`: Security settings (allowCodeBodies, includeTests, etc.)
- `results`: How many symbols were included, stubbed, etc.
- `determinism`: Versioning info for reproducibility

**Example:**
```json
{
  "seed": "src/types.ts#BuildConfig",
  "mode": "static",
  "budgets": { "bytes": 1500000, "tokens": 20000 },
  "policy": { "allowCodeBodies": true, "includeDocs": false },
  "results": { "includedSymbols": 12, "totalFiles": 8, "stubbed": 3 }
}
```

### `10-symbol-graph.json` - Dependency Graph

The dependency graph around the target symbol, with weighted edges and ranking information.

**Key fields:**
- `nodes`: All symbols in the analysis (included and stubbed)
- `edges`: Dependency relationships with types (imports, calls, typeRef, etc.)
- `ranking`: Algorithm details and stop conditions
- `stats`: Graph statistics (files touched, cycles detected, etc.)

**Node types:**
- `class`, `function`, `interface`, `type`, `variable`, `import`

**Edge types:**
- `imports`: Module imports
- `calls`: Function/method calls
- `typeRef`: Type references
- `extends`: Class/interface inheritance
- `implements`: Interface implementation

**Example node:**
```json
{
  "id": "src/types.ts#BuildConfig",
  "name": "BuildConfig",
  "path": "src/types.ts",
  "kind": "interface",
  "included": true,
  "reason": ["seed"]
}
```

### `20-slices.ndjson` - Code Slices

Actual code ranges extracted from files, one slice per line in NDJSON format.

**Key fields per slice:**
- `symbolId`: FQN of the symbol this slice represents
- `path`: File path
- `startLine`, `endLine`: Line range (1-indexed)
- `startChar`, `endChar`: Character range
- `body`: The actual code content
- `context`: How many before/after lines included
- `reasons`: Why this slice was included
- `tokens`: Token count estimates

**Example slice:**
```json
{
  "symbolId": "src/types.ts#BuildConfig",
  "path": "src/types.ts",
  "startLine": 102,
  "endLine": 120,
  "body": "export interface BuildConfig {\n  level: 'summary' | 'contracts';\n  budgetBytes: number;\n  // ...\n}",
  "context": {"before": 3, "after": 3},
  "reasons": ["seed"],
  "tokens": {"optimistic": 154, "average": 205, "conservative": 256}
}
```

### `30-stubs.d.ts` - TypeScript Stubs

TypeScript declaration stubs for external dependencies and types that exceeded the budget.

**Content:**
- Ambient module declarations
- Interface and type definitions
- Function signatures without implementations
- Re-exports from external packages

**Example:**
```typescript
// External package stubs
declare module "zod" {
  export interface ZodSchema<T = any> { /* ... */ }
  export function z(): ZodSchema;
}

// Internal stubs (over budget)
export interface ConfigOptions {
  mode: string;
  verbose: boolean;
}
```

### `40-index.ndjson` - Symbol Index

Mapping from symbols to their locations in slices, one entry per line.

**Key fields per entry:**
- `symbolId`: FQN of the symbol
- `sliceIndex`: Which slice in `20-slices.ndjson` contains this symbol
- `type`: Symbol type (class/function/interface/etc.)
- `exported`: Whether this symbol is exported from its module

## Ranking and Budget Algorithm

Scoped packs use **weighted BFS (breadth-first search)** to expand from the seed symbol:

### Edge Weights (lower = higher priority)
- **calls**: 3 (function/method calls)
- **typeRef**: 2.5 (type references)
- **extends**: 2 (class/interface inheritance)
- **implements**: 2 (interface implementation)
- **imports**: 1.5 (module imports)
- **sameFileSibling**: 1.2 (symbols in same file)
- **testCovers**: 1 (test coverage relationships)
- **docMentions**: 0.3 (documentation references)

### Budget Enforcement
1. **Token budget**: Stop when code slices would exceed token limit
2. **File budget**: Limit number of files touched
3. **Depth budget**: Maximum graph traversal depth (default: 5)

When budget is exceeded, remaining symbols become **stubs** in the `.d.ts` file.

## Security and Safety

### Risk Gates

Scoped packs emit actual code, so they have strict safety controls:

1. **Explicit opt-in**: `--scope-allow-code` flag required
2. **Automatic secret detection**: Common secrets are detected and redacted automatically
3. **Risk profile**: Internally sets `riskProfile: 'extended'`
4. **No accidental inclusion**: Scoped collector not in default registry
5. **Path validation**: Prevents directory traversal
6. **Size limits**: Enforces token and byte budgets

### Secret Detection and Redaction

Scoped packs include automatic secret detection that identifies and redacts:

- **PEM certificates/keys** - `-----BEGIN/END-----` blocks
- **AWS access keys** - `AKIA*` patterns and secret key variables
- **API keys** - `api_key`/`API_KEY` variables with long values
- **JWT tokens** - Basic JWT structure detection
- **Database connection strings** - URLs with embedded passwords
- **Private key variables** - `private_key`/`privateKey` assignments

When secrets are detected:
- A warning is logged: `Warning: Detected secrets in src/config.ts: AWS access key, API key`
- Secrets are replaced with `[REDACTED_SECRET_TYPE]` placeholders
- Code structure is preserved while removing sensitive data
- Generation continues normally (non-breaking)

### What's Included vs Excluded

**Included by default:**
- Function/class/interface definitions
- Type annotations and signatures
- JSDoc comments and inline documentation
- Import/export statements
- Essential context lines around code

**Excluded by default:**
- Test files (unless `--scope-include tests`)
- Documentation files (unless `--scope-include docs`)
- Implementation details beyond the analysis scope
- Secrets, keys, or sensitive configuration

## Advanced Usage

### Including Tests and Documentation

```bash
# Include test files in analysis
context-pack . --scope src/auth.ts#login --scope-include tests --scope-allow-code

# Include documentation files
context-pack . --scope src/api.ts#handler --scope-include docs --scope-allow-code

# Include both
context-pack . --scope src/utils.ts#validate --scope-include tests,docs --scope-allow-code
```

### Larger Budgets

```bash
# Increase token budget for complex symbols
context-pack . --scope src/engine.ts#ComplexClass --scope-budget 50000 --scope-allow-code

# The system will still enforce byte budgets and file limits
```

### Complex Symbol References

```bash
# Generic function overloads
context-pack . --scope src/utils.ts#transform --scope-allow-code

# Namespace exports
context-pack . --scope src/types.ts#API.Request --scope-allow-code

# Re-exported symbols
context-pack . --scope src/index.ts#configParser --scope-allow-code
```

## Use Cases

### For Coding Agents

1. **Function modification**: Get all dependencies needed to understand and modify a function
2. **Class extension**: Understand class hierarchy and interface contracts
3. **Refactoring**: Identify all code that needs to change together
4. **API integration**: Extract interface definitions and usage patterns
5. **Bug fixing**: Get focused context around problematic code

### Example Workflows

**Modifying a function:**
```bash
# Get context around the target function
context-pack . --scope src/auth/validate.ts#validateUser --scope-allow-code

# Agent now has:
# - The function definition
# - All types it uses
# - Functions it calls
# - Related interfaces
```

**Understanding a class:**
```bash
# Get full class context
context-pack . --scope src/services/UserService.ts#UserService --scope-allow-code

# Agent now has:
# - Class definition with all methods
# - Interfaces it implements
# - Types it uses
# - Dependencies it imports
```

**Refactoring an interface:**
```bash
# Find all usage of an interface
context-pack . --scope src/types.ts#ApiResponse --scope-allow-code

# Agent gets:
# - Interface definition
# - All classes/functions that use it
# - Related type definitions
```

## Best Practices

### Symbol Selection

1. **Start specific**: Begin with the exact function/class you need
2. **Use meaningful names**: Prefer named exports over line numbers
3. **Check exports first**: Use `context-pack . --level contracts` to see available symbols

### Budget Management

1. **Start small**: Begin with default 20K tokens, increase if needed
2. **Monitor output**: Check the `results` in `00-scope.json` for budget usage
3. **Use stubs**: Let the system stub out large dependencies automatically

### Integration Tips

1. **Combine with context packs**: Use regular context pack for architecture, scoped pack for implementation
2. **Version control**: The hash-based directories are deterministic and safe to commit
3. **Validate compilation**: The generated `.d.ts` stubs should compile without errors

## Troubleshooting

### Common Issues

**"Could not resolve seed symbol":**
- Check the FQN format: `path#symbolName`
- Verify the symbol is exported from the file
- Try line:column format: `path#line:42:15`

**"Budget exceeded immediately":**
- The target symbol or its immediate dependencies are very large
- Increase token budget: `--scope-budget 40000`
- Check for circular dependencies in the graph

**"Security error: code bodies not allowed":**
- Add the `--scope-allow-code` flag
- This is intentional security - scoped packs emit actual code

**Empty or minimal output:**
- Check that the symbol exists and is exported
- Verify TypeScript compilation works on the target file
- Look for dependency resolution issues in verbose output

### Debug Information

```bash
# Get detailed debugging output
context-pack . --scope src/types.ts#Config --scope-allow-code --verbose

# Check what symbols were found
cat .contextpack/scoped/<hash>/10-symbol-graph.json | jq '.nodes[].name'

# Verify code extraction
cat .contextpack/scoped/<hash>/20-slices.ndjson | jq '.symbolName'
```

## Limitations

### Current Limitations

1. **TypeScript only**: No support for JavaScript, Python, etc. (yet)
2. **Static analysis**: No runtime call graph or coverage data
3. **Single symbol seeds**: Can't specify multiple starting points
4. **Local dependencies**: Doesn't follow external package implementations

### Future Extensions

1. **Multi-language support**: Python, Rust, Go via LSP integration
2. **Dynamic analysis**: Runtime coverage and call graphs
3. **Multi-seed support**: Analyze multiple related symbols together
4. **IDE integration**: "Generate scoped pack" from cursor position

## API Reference

While scoped packs are primarily used via CLI, the core types are available for programmatic use:

```typescript
// FQN parsing
interface FQN {
  path: string;
  symbol: string;
  type: 'export' | 'member' | 'position';
  line?: number;
  column?: number;
}

// Scoped configuration
interface ScopeConfig {
  seed: string;
  budgetTokens: number;
  mode: 'static' | 'hybrid';
  allowCodeBodies: boolean;
  include?: {
    tests?: boolean;
    docs?: boolean;
  };
}
```

The scoped collector can be invoked programmatically through the context pack engine when the appropriate configuration is provided.
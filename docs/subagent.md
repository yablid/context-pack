# Scoped Context Packs for Claude Subagents

Context-pack's scoped functionality provides precise, targeted context extraction for Claude subagents. Instead of processing entire codebases, scoped packs focus on specific symbols (functions, classes, types) and their immediate dependencies.

## Core Functionality

### Single Command
```bash
context-pack . --scope <symbol> [options]
```

### Key Options
- `--scope <path#symbol>` - Target symbol (e.g., `src/types.ts#BuildConfig`)
- `--scope-budget <tokens>` - Token limit (default: 20,000)
- `--scope-allow-code` - Include actual code bodies (default: false, uses `.d.ts` stubs)
- `--scope-mode <mode>` - Analysis mode: `static|hybrid` (default: static)
- `--scope-include <list>` - Include `tests,docs` (default: excludes both)

### Output Format
Creates 5 artifacts in `{output}/scoped/{hash}/`:
1. `00-scope.json` - Metadata and configuration
2. `10-symbol-graph.json` - Dependency graph with relationships
3. `20-slices.ndjson` - Extracted code contexts with line ranges
4. `30-stubs.d.ts` - TypeScript declarations for excluded symbols
5. `40-index.ndjson` - File metadata index

### Token Generation Patterns
- **Small scope** (single interface): ~1,868 bytes, minimal context
- **Medium scope** (class with dependencies): ~11,058 bytes
- **Budget controls expansion**: 5K vs 15K vs 20K tokens shows significant scaling
- **Generation time**: ~5 seconds for complex symbols

## Subagent Usage Guide

### Output Behavior
**IMPORTANT**: The tool generates files in the specified output directory (default: `./.contextpack/scoped/{hash}/`). It does NOT print context directly to stdout. Subagents must read the generated files to access the context.

### Basic Usage Pattern
```bash
# Generate scoped pack
context-pack . --scope src/engine/engine.ts#createEngine --out ./temp-context

# Then read the generated files:
# - ./temp-context/scoped/{hash}/20-slices.ndjson (code contexts)
# - ./temp-context/scoped/{hash}/10-symbol-graph.json (dependencies)
```

### Scenario-Specific Commands

#### Analyzing a Function
```bash
# For understanding/modifying a specific function
context-pack . --scope src/utils/parser.ts#parseConfig --scope-budget 10000
```
**Use when**: User highlights a function, wants to understand its context or modify it.
**Budget**: 10K tokens for focused analysis.

#### Understanding a Class
```bash
# For class analysis with full context
context-pack . --scope src/engine/processor.ts#DataProcessor --scope-budget 15000 --scope-include tests
```
**Use when**: User wants to understand class architecture, add methods, or refactor.
**Budget**: 15K tokens, include tests for comprehensive understanding.

#### API Surface Analysis
```bash
# For public API analysis (types only)
context-pack . --scope src/types.ts#PublicAPI --scope-budget 8000
```
**Use when**: User needs to understand interfaces, type definitions, or API contracts.
**Budget**: 8K tokens sufficient for type-heavy analysis.

#### Debugging/Code Bodies
```bash
# When actual implementation is needed (SECURITY RISK)
context-pack . --scope src/handlers/auth.ts#authenticate --scope-allow-code --scope-budget 12000
```
**Use when**: User needs to debug, understand implementation details, or fix bugs.
**WARNING**: Only use `--scope-allow-code` when necessary - exposes source code.

#### Large Refactoring Context
```bash
# Maximum context for complex changes
context-pack . --scope src/core/system.ts#SystemManager --scope-budget 20000 --scope-include tests,docs
```
**Use when**: User planning large refactors, architectural changes, or complex feature additions.
**Budget**: Full 20K tokens with comprehensive context.

### Reading Generated Context

After generation, read these files in order:
1. **`00-scope.json`** - Check `results.includedSymbols` to verify completeness
2. **`20-slices.ndjson`** - Primary code contexts (one JSON object per line)
3. **`10-symbol-graph.json`** - Understand dependencies and relationships
4. **`30-stubs.d.ts`** - Type information for excluded symbols

### Error Handling

**Budget exceeded**: Reduce `--scope-budget` or use `--scope-mode static`
**Symbol not found**: Verify symbol exists and path format: `file.ts#SymbolName`
**Empty results**: Symbol may be unexported or path incorrect

### Performance Guidelines

- **Small changes**: 5K-8K token budget
- **Medium analysis**: 10K-15K token budget
- **Large refactoring**: 15K-20K token budget
- **Generation time**: ~5 seconds regardless of budget
- **File output**: Always writes to disk, never stdout

### Security Notes

- Default mode excludes code bodies (uses `.d.ts` stubs)
- Only use `--scope-allow-code` when implementation details are required
- Generated context is safe to analyze but review before sharing
- Temporary output directories can be cleaned up after use

## Optimal Claude → Context-Guy → Claude Workflow

For maximum effectiveness when Claude uses a context-guy subagent to extract targeted context from large codebases.

### Effectiveness (High Signal)

**Budget Sizing for Context Windows**
- **Small refactor**: 8K-10K tokens (leaves ~90K+ for Claude's analysis)
- **Medium changes**: 12K-15K tokens
- **Complex refactor**: 18K-20K tokens max
- **Never exceed 20K** - preserves Claude's reasoning space

**Default to Type-Only Mode**
- Use default mode (no `--scope-allow-code`) for most cases
- Only add `--scope-allow-code` when Claude specifically needs implementation details
- Stubs + signatures usually sufficient for refactoring decisions

**Smart Context Selection**
```bash
# For refactoring - include tests to understand expected behavior
context-pack . --scope src/parser.ts#parseConfig --scope-budget 12000 --scope-include tests

# For type changes - minimal context
context-pack . --scope src/types.ts#ConfigSchema --scope-budget 8000
```

### Speed Optimization

**Pre-built Output Directory**
```bash
# Use predictable temp location for easy cleanup
context-pack . --scope <symbol> --out /tmp/context-$(date +%s) --scope-budget 12000
```

**Minimal File Reading Priority**
Context-guy should read files in this order:
1. **`20-slices.ndjson`** (the actual context) - ALWAYS READ THIS
2. **`00-scope.json`** (verify completeness) - READ FOR VALIDATION
3. **`10-symbol-graph.json`** (dependencies) - READ IF CLAUDE NEEDS ARCHITECTURE
4. Skip others unless Claude asks for more detail

**Streamlined Response Format**
```
Found symbol: src/parser.ts#parseConfig
Context: 1,200 tokens, budget satisfied
Dependencies: 3 internal symbols, 2 external packages

[paste relevant slices content]

Excluded symbols available in stubs if needed.
```

### Context-Guy Process

**Optimal subagent workflow:**
1. **Generate** scoped pack (~5 seconds)
2. **Validate** success via `00-scope.json`
3. **Extract** primary context from `20-slices.ndjson`
4. **Format** focused response for Claude
5. **Cleanup** temp directory

**Key Insight**: Tool already optimized for this exact workflow - extracts minimal sufficient context with deterministic output. 5-second generation time is acceptable bottleneck for interactive use.

### Integration Tips

1. **Use unique output directories** to avoid conflicts between parallel subagent calls
2. **Clean up temp directories** after processing context
3. **Check `00-scope.json` results** to verify context completeness
4. **Start with smaller budgets** and increase if more context is needed
5. **Prefer type-only analysis** unless debugging or implementing
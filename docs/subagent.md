# Contextualizer Subagent Guide

Context-pack is designed for Claude Code subagent workflows. This guide shows how to build an effective "contextualizer" subagent that extracts bounded, focused context from large codebases without overwhelming the main conversation.

## The Contextualizer Pattern

### Core Concept

You (Claude Code) delegate context extraction to a specialized subagent:

```
User: "Ask our contextualizer to get context for src/auth.ts#validateUser, then rewrite it to support async validation"

Claude Code: [launches contextualizer subagent]

Contextualizer: [generates bounded context, returns clean summary]

Claude Code: [uses focused context to implement the requested changes]
```

### Why This Works

- **Bounded context**: Never overloads your conversation window
- **Tool expertise**: Contextualizer knows optimal commands and budgets
- **Fresh scope**: Each request gets clean, targeted extraction
- **Cleanup management**: Handles temporary files automatically

## Subagent Implementation

### Required Tools

The contextualizer needs these tools:
- `Bash` - Run context-pack commands
- `Read` - Read generated context files
- `Glob` - Find output directories (scoped packs use random hashes)

### Core Command Pattern

```bash
# Standard contextualizer command
context-pack . --scope <symbol> --scope-allow-code --scope-budget <tokens> --out /tmp/ctx-$(date +%s)
```

### Budget Guidelines

**Critical for context window management:**

- **Quick lookup**: 5K-8K tokens
  ```bash
  context-pack . --scope src/types.ts#Config --scope-budget 6000
  ```

- **Function analysis**: 8K-12K tokens
  ```bash
  context-pack . --scope src/parser.ts#parseConfig --scope-budget 10000
  ```

- **Class refactoring**: 12K-15K tokens
  ```bash
  context-pack . --scope src/engine.ts#DataProcessor --scope-budget 14000 --scope-include tests
  ```

- **Complex changes**: 15K-18K tokens max
  ```bash
  context-pack . --scope src/core.ts#SystemManager --scope-budget 18000 --scope-include tests,docs
  ```

**Never exceed 20K tokens** - preserves Claude Code's reasoning space.

## Contextualizer Workflow

### 1. Generate Context

```bash
# Create unique temp directory to avoid conflicts
TEMP_DIR="/tmp/ctx-$(date +%s)"
context-pack . --scope "$SYMBOL" --scope-allow-code --scope-budget "$BUDGET" --out "$TEMP_DIR"
```

### 2. Validate Success

```bash
# Check if generation succeeded
ls "$TEMP_DIR"/scoped/*/00-scope.json
```

### 3. Extract Primary Context

```bash
# Read the actual code context (main output)
cat "$TEMP_DIR"/scoped/*/20-slices.ndjson
```

### 4. Read Metadata (Optional)

```bash
# Validation info and symbol completeness
cat "$TEMP_DIR"/scoped/*/00-scope.json

# Dependency graph (if Claude Code needs architecture info)
cat "$TEMP_DIR"/scoped/*/10-symbol-graph.json
```

### 5. Cleanup

```bash
# Remove temp directory after processing
rm -rf "$TEMP_DIR"
```

## Response Format

The contextualizer should return structured, bounded context:

```
CONTEXT FOR: src/auth/validator.ts#validateUserToken
Budget: 8,247 tokens used of 10,000 requested
Scope: Function + 3 dependencies
Generation: Successful

=== TARGET FUNCTION ===
export function validateUserToken(token: string): Promise<boolean> {
  if (!token || token.length < 10) {
    return Promise.resolve(false);
  }

  return verifyTokenSignature(token)
    .then(isValid => isValid && !isTokenExpired(token));
}

=== DEPENDENCIES ===
// src/crypto/signature.ts
function verifyTokenSignature(token: string): Promise<boolean>

// src/utils/time.ts
function isTokenExpired(token: string): boolean

// src/types/auth.ts
interface TokenValidation {
  isValid: boolean;
  reason?: string;
}

=== EXCLUDED SYMBOLS ===
4 additional symbols available in stubs if needed:
- TokenManager class
- JWT parsing utilities
- Error types
- Test fixtures

Context ready for analysis/modification.
```

## Common Usage Patterns

### Code Analysis
```
User: "Have the contextualizer analyze src/parser.ts#parseConfigFile, then explain how error handling works"

Contextualizer budget: 8K tokens
Focus: Function + error paths + related types
```

### Refactoring Prep
```
User: "Get context for src/engine.ts#DataProcessor, then split it into smaller classes"

Contextualizer budget: 15K tokens
Include: tests (to understand expected behavior)
Focus: Class definition + methods + test coverage
```

### Debugging
```
User: "Contextualizer: get full context for src/api.ts#handleRequest, then help me fix the memory leak"

Contextualizer budget: 12K tokens
Include: Full code bodies (--scope-allow-code)
Focus: Implementation details + resource management
```

### Type Changes
```
User: "Get context for src/types.ts#APIResponse, then update it to support pagination"

Contextualizer budget: 6K tokens
Focus: Type definitions + usages (signatures sufficient)
```

## Advanced Features

### Including Tests and Docs

```bash
# For comprehensive understanding
--scope-include tests,docs
```

Use when:
- Planning large refactors
- Understanding expected behavior
- Need examples of usage

### Type-Only Mode (Default)

```bash
# Signatures and types only (no --scope-allow-code)
context-pack . --scope src/api.ts#Router --scope-budget 8000
```

Use when:
- Understanding interfaces
- Planning API changes
- Architecture analysis
- Security-conscious analysis

### Full Code Mode

```bash
# Include implementation bodies (security risk)
--scope-allow-code
```

Use when:
- Debugging implementation
- Understanding algorithms
- Performance optimization
- Bug fixes requiring logic analysis

## Error Handling

### Common Issues

**"Symbol not found":**
```bash
# Verify symbol exists and is exported
grep -n "export.*functionName" src/file.ts

# Try line-based targeting
context-pack . --scope src/file.ts#line:42:10
```

**"Budget exceeded":**
```bash
# Reduce budget or use static mode
--scope-budget 8000 --scope-mode static
```

**"Empty context":**
```bash
# Check symbol format: file.ts#SymbolName (not file.ts#Symbol.method)
# Verify file path relative to working directory
```

### Validation

Always check `00-scope.json` for:
```json
{
  "results": {
    "includedSymbols": ["target", "dependency1", "dependency2"],
    "excludedSymbols": ["large_class", "test_utilities"],
    "totalTokens": 8247,
    "budgetExceeded": false
  }
}
```

## Performance Optimization

### Parallel Requests

```bash
# Use unique output directories for concurrent requests
context-pack . --scope symbol1 --out /tmp/ctx1-$$ &
context-pack . --scope symbol2 --out /tmp/ctx2-$$ &
wait
```

### Reusing Context

If Claude Code needs multiple related symbols:
```bash
# Single request with higher budget often more efficient
context-pack . --scope src/core.ts#MainClass --scope-budget 15000 --scope-include tests
```

### Minimal File Reading

Priority order:
1. `20-slices.ndjson` - Always read (the actual context)
2. `00-scope.json` - Read for validation
3. `10-symbol-graph.json` - Only if Claude Code needs architecture info
4. Skip `30-stubs.d.ts` and `40-index.ndjson` unless requested

## Integration Examples

### Basic Function Analysis

```bash
# User asks about a specific function
SYMBOL="src/utils/parser.ts#parseConfigFile"
BUDGET=8000

context-pack . --scope "$SYMBOL" --scope-budget "$BUDGET" --out /tmp/ctx-$$
cat /tmp/ctx-$$/scoped/*/20-slices.ndjson
rm -rf /tmp/ctx-$$
```

### Class Refactoring

```bash
# User wants to refactor a class
SYMBOL="src/engine/processor.ts#DataProcessor"
BUDGET=14000

context-pack . --scope "$SYMBOL" --scope-budget "$BUDGET" --scope-include tests --out /tmp/ctx-$$
# Process context files...
rm -rf /tmp/ctx-$$
```

### API Surface Analysis

```bash
# User needs to understand public interfaces
SYMBOL="src/types/api.ts#PublicAPI"
BUDGET=6000

# Type-only mode (default, no --scope-allow-code)
context-pack . --scope "$SYMBOL" --scope-budget "$BUDGET" --out /tmp/ctx-$$
```

## Security Considerations

### Safe by Default

- Default mode excludes implementation bodies
- Only includes TypeScript signatures and types
- Safe to analyze and share context
- Automatic secret detection if `--scope-allow-code` used

### When to Use Full Code

Only use `--scope-allow-code` when Claude Code specifically needs:
- Implementation details for debugging
- Algorithm understanding for optimization
- Bug fixes requiring logic analysis
- Performance profiling

### Context Boundaries

- Each scoped pack is self-contained
- Temporary directories isolate requests
- Clean up prevents context pollution
- Budget limits prevent unbounded expansion

## Troubleshooting

### Generation Issues

```bash
# Test basic generation
context-pack . --scope src/main.ts#main --scope-budget 5000 --verbose

# Check working directory
pwd  # Should be project root

# Verify symbol exists
grep -n "export.*main" src/main.ts
```

### Context Quality

```bash
# Check what was included
jq '.results.includedSymbols' /tmp/ctx-$$/scoped/*/00-scope.json

# Increase budget if context seems incomplete
context-pack . --scope "$SYMBOL" --scope-budget 15000
```

### File Access

```bash
# Verify output directory permissions
ls -la /tmp/ctx-$$

# Check for hash subdirectory
ls /tmp/ctx-$$/scoped/
```

The contextualizer pattern transforms large codebase navigation into focused, bounded context extraction that enhances rather than overwhelms Claude Code's analytical capabilities.
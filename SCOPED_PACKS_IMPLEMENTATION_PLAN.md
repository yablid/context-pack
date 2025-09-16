# Scoped Packs Implementation Plan - Final Version

## Executive Summary
Add symbol-level context extraction to context-pack CLI for coding agents. Agents can run `context-pack . --scope src/file.ts#symbol` to get focused code slices + dependency graph around specific functions/classes.

## Core Architecture Decisions (Senior Review Applied)

### 1. **Special Collector Pattern**
- Implement as collector (extends BaseCollector) for infrastructure reuse
- **NOT registered** in default collector registry
- Engine invokes directly only when `--scope` flag present
- Preserves safe-by-default behavior - no accidental inclusion

### 2. **Single Risk Gate - No Dual Controls**
- `--scope-allow-code` flag internally sets `riskProfile: 'extended'`
- No code bodies emitted without explicit permission
- Single source of truth prevents conflicting states

### 3. **Minimal CLI Surface**
```bash
context-pack . --scope <fqn> [--scope-allow-code] [--scope-budget 20000]
```

## FQN Resolution Specification (Critical Implementation Detail)

### Supported Seed Forms
```
path#exportName           // Named export: export function foo()
path#Class.method          // Class member: class X { method() {} }
path#localConstFn          // const fn = () => {}
path#line:10:5            // Fallback: line 10, column 5
path#fn(<sigHash>)        // Overload: function foo(x: string); function foo(x: number)
```

### Must Handle
- Default exports: `export default class X`
- Re-exports: `export { foo } from './other'`
- Namespace exports: `export * as ns from './mod'`
- Aliased imports: `import { foo as bar } from './mod'`
- TypeScript path mapping: `@/utils/helper`
- Walk to defining node through re-export chains

### Overloads & Generics
- Function overloads: pick implementation signature node
- Generic constraints: add typeRef edges from constraints and defaults
- Method overloads in classes: same disambiguation as functions

## Implementation Phases

### Phase 1: Foundation Infrastructure
1. **TsProgramService** (`src/engine/ts-program-service.ts`)
   - Single shared TypeScript Program + LanguageService per run
   - Proper config resolution: baseUrl, paths, typeRoots
   - Cache by commit hash for repeated runs
   - FQN resolver with full specification support
   - Utilities: `resolveFqnToNode`, `findReferences`, `getTypeRefs`, `getCallGraphEdges`

2. **Schema Definitions** (`src/schemas/scoped-*.ts`)
   - `scoped/00-scope.json` - Scope metadata + reproducibility
   - `scoped/10-symbol-graph.json` - Nodes/edges dependency graph
   - `scoped/20-slices.ndjson` - Code ranges (with optional bodies)
   - `scoped/30-stubs.d.ts` - Ambient declarations (text file)
   - `scoped/40-index.ndjson` - Symbol→slice mapping + rationale
   - Register in existing schema system

### Phase 2: Core Scoped Pipeline
1. **ScopedCollector** (`src/collectors/scoped-collector.ts`)
   - Extends BaseCollector for infrastructure reuse
   - NOT registered in collector registry
   - Orchestrates: graph building → ranking → slicing → stub generation

2. **Graph Builder** (`src/scoped/graph-builder.ts`)
   - Build symbol dependency graph from seed using TypeScript APIs
   - Edge types: `calls`, `typeRef`, `extends`, `implements`, `imports`, `sameFileSibling`, `testCovers`, `docMentions`
   - Reuse import analysis patterns from existing ImportGraphCollector
   - Handle `import()` and `require()` calls as import edges (literal only)

3. **Ranker** (`src/scoped/ranker.ts`)
   - Weighted BFS with configurable edge weights
   - Default weights: calls=3.0, typeRef=2.5, extends/implements=2.0, imports=1.5, etc.
   - Token budget enforcement using existing TokenCounter
   - Stop conditions: maxDepth, maxFiles, budgetTokens, global bytes
   - Preference: keep types/interfaces, emit stubs for implementations

4. **Slicer** (`src/scoped/slicer.ts`)
   - Extract minimal line ranges: JSDoc + symbol body + 3 context lines
   - Merge overlapping ranges, stable ordering by (path, start)
   - Avoid license header contamination unless part of symbol's JSDoc
   - **Risk gate**: when code disallowed, emit doc + range metadata only (no body field)
   - Canonicalize line endings to \n before emission

5. **Stub Generator** (`src/scoped/stubber.ts`)
   - Structural .d.ts for pruned internal symbols (not `any`)
   - Ambient declare module for externals with only referenced types
   - Preserve path aliases from user perspective (not resolved paths)
   - Must pass `tsc --noEmit` compilation test

### Phase 3: Integration & Security
1. **CLI Integration** (`src/cli.ts`)
   - Add flags: `--scope <fqn>`, `--scope-allow-code`, `--scope-budget <n>`
   - Keep minimal surface - no extra knobs until proven needed
   - Clear help text + examples

2. **Engine Integration** (`src/engine/context-pack-engine.ts`)
   - Parse BuildConfig for optional scope block
   - After normal pack generation, conditionally invoke ScopedCollector
   - Never invoke unless --scope explicitly provided

3. **Security Implementation**
   - Scan slices for obvious secrets (private keys, AWS keys, .pem headers)
   - Redact or fail with clear actionable message
   - Code bodies only when riskProfile: 'extended'

## Critical Implementation Requirements

### Determinism Guarantees
- Canonicalize line endings to \n
- Stable NDJSON ordering: path asc, start asc
- Version edge weight profile in 00-scope.json (`edgeWeights: "v1"`)
- Freeze to current git commit; include `git.isDirty` flag
- Single Program/LanguageService instance with consistent filtering
- CanonicalJSON for all structured output

### Budget Semantics & Failure Modes
- Token budget hit mid-BFS: emit stubs for unvisited symbols, record `reason: "budget"`
- Clear status in 00-scope.json if seed couldn't be sliced
- Return appropriate exit codes
- Global byte budget still enforced

### Manifest Transparency
- Every slice carries `reasons: string[]` (seed, typeRef:ProbeOutcome, calls:fn, budget)
- Record edge weights version in 00-scope.json
- Include all FQN resolution steps and disambiguation choices

### TypeScript Config Resolution
- Respect baseUrl, paths, typeRoots from project tsconfig
- Handle composite projects and project references
- Must go through single shared Program/LanguageService
- Cache program by commit for performance

### Path Aliasing in Output
- When project uses TS paths mapping, emit stubs with aliased specifiers
- Users see imports they wrote, not resolved deep paths
- Keep deterministic - same alias resolution every run

### Link Back to Main Pack
- In top-level 00-pack.json, add pointer: `{ scoped: [{ seed, path, hash }] }`
- Enables agent discovery of scoped packs

## File Structure Impact

### New Files (~11 core modules)
```
src/engine/ts-program-service.ts      # Shared TS infrastructure
src/collectors/scoped-collector.ts    # Main collector (not registered)
src/scoped/graph-builder.ts           # Dependency graph construction
src/scoped/ranker.ts                  # Weighted BFS ranking
src/scoped/slicer.ts                  # Code range extraction
src/scoped/stubber.ts                 # .d.ts stub generation
src/schemas/scoped-scope.ts           # 00-scope.json schema
src/schemas/scoped-symbol-graph.ts    # 10-symbol-graph.json schema
src/schemas/scoped-slices.ts          # 20-slices.ndjson schema
src/schemas/scoped-stubs.ts           # 30-stubs.d.ts schema (text)
src/schemas/scoped-index.ts           # 40-index.ndjson schema
```

### Modified Files (minimal changes)
```
src/cli.ts                            # Add 3 new flags
src/types.ts                          # Extend BuildConfig interface
src/engine/context-pack-engine.ts     # Conditional scoped collector invocation
src/schemas/zod-schemas.ts             # Register new schemas
```

### Output Structure
```
.contextpack/scoped/<commit-seed-hash>/
  00-scope.json          # Metadata + reproducibility
  10-symbol-graph.json   # Nodes/edges dependency graph
  20-slices.ndjson       # Code ranges + reasons
  30-stubs.d.ts          # Ambient declarations
  40-index.ndjson        # Symbol→slice mapping
  TOKEN_COUNTS.txt       # Token estimates
```

## Testing Strategy

### Unit Tests
- TsProgramService FQN resolution (all forms)
- Graph builder edge detection
- Ranker budget enforcement
- Slicer range merging + context lines
- Stub generator compilation validity

### Golden Tests
- Default export resolution
- Re-export chain following
- Function overload disambiguation
- TypeScript path alias handling
- Class method + property extraction
- Generic constraint following

### System Tests
- **Determinism test**: Double run, compare SHA256 of all artifacts
- **Compilation test**: Generated stubs must pass `tsc --noEmit`
- **Budget exhaustion**: Verify stubs generated when budget hit
- **Security test**: Code bodies gated by risk profile
- **Integration test**: Works with existing collectors unchanged

### Test Fixtures
- Small TypeScript project with common patterns
- Overloaded functions, class hierarchies, re-exports
- External dependencies requiring stubs
- Various tsconfig configurations (paths, baseUrl)

## Rollout Strategy

### Step 1: Foundation (Week 1)
- TsProgramService with FQN resolver
- Schema definitions + registration
- Basic CLI flag parsing (no-op implementation)

### Step 2: Core Pipeline (Week 2)
- ScopedCollector skeleton
- Graph builder + ranker implementation
- Slicer with deterministic output
- Stub generator with compilation tests

### Step 3: Integration (Week 3)
- Engine integration with conditional invocation
- Security gates + risk profile enforcement
- Full CLI flag support
- Link back to main pack

### Step 4: Validation (Week 4)
- All test suites implemented
- Golden tests with fixtures
- Documentation + examples
- Performance validation

## Risk Mitigation

### Backwards Compatibility
- Zero changes to existing behavior when --scope not used
- All existing tests continue to pass
- No modification to default collector registry

### Security
- Code bodies require explicit --scope-allow-code flag
- Secret scanning before emission
- Clear error messages for forbidden operations
- Risk profile single source of truth

### Performance
- Shared TypeScript program (don't recreate per collector)
- Token budget prevents runaway graph expansion
- Byte budgets still enforced globally
- Optional program caching by commit

### Maintainability
- Reuse existing infrastructure (BaseCollector, schemas, validation)
- Follow established patterns from ImportGraphCollector
- Clear separation of concerns (graph → rank → slice → stub)
- Comprehensive test coverage

## Future Extensions (Not in Scope)

### Multi-Language Support
- LSP integration (pyright, gopls, rust-analyzer)
- Uniform node/edge ontology across languages
- Language-specific graph builders

### IDE Integration
- Quick action: "Generate scoped pack for symbol under cursor"
- VSCode extension with context pack viewer
- Cursor mode: `--scope-locator path:line:col`

### Performance Optimizations
- Incremental graph caching across runs
- Program/LS persistence between invocations
- Parallel graph traversal for large codebases

### Enhanced Tooling
- `context-pack show --scope <hash>` viewer
- Graph visualization
- Interactive scope exploration

## Acceptance Criteria

- [ ] No change to default pack artifacts when --scope absent
- [ ] --scope produces deterministic scoped/ directory
- [ ] Code bodies only emitted with explicit --scope-allow-code
- [ ] Token & byte budgets enforced, stubs on overflow
- [ ] All schemas validate, CI green on golden tests
- [ ] FQN resolver handles all specified forms correctly
- [ ] Generated stubs pass TypeScript compilation
- [ ] Determinism test passes (SHA256 comparison)
- [ ] Security gates prevent unauthorized code emission
- [ ] Clear documentation with examples
- [ ] Performance within acceptable bounds

## Definition of Done

- All acceptance criteria met
- Full test suite passing (unit + integration + golden)
- Documentation complete with examples
- Performance benchmarks acceptable
- Security review passed
- Backwards compatibility verified
- Ready for production deployment

---

This plan addresses all senior review feedback and provides a complete roadmap for implementing scoped packs as a clean, secure, deterministic extension to the existing context-pack system.
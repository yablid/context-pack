# changes.md — Minimal Structural Refactor Plan

Generated: 2025-09-17T08:51:26Z

## Why these changes
The current import graph flags cycles, two fat orchestrators, and a large re‑export hub. This plan removes cycles, isolates kernels, and splits orchestrators while aligning folders to your proposed core/features format.

## Refactor Map (ordered)

1. Break cycles
   - Cut edges via patterns (ban + replace):
     - errors barrel: errors/* → errors/index.ts
     - collector registry: collectors/** → collectors/collector-registry.ts
     - cross‑feature: scoped/** → engine/context-pack-engine.ts, features/** → scoped/packager.ts
     - util↔errors: utils/** → errors/index.ts
   - Replace barrel imports with direct file imports.
   - DoD: scc count drops; tsc clean; golden outputs stable.

2. Isolate kernels into core/
   - Moves:
     - src/types.ts → src/core/types.ts
     - src/engine/canonical-json.ts → src/core/io/canonical-json.ts
     - src/engine/schema-validator.ts → src/core/validation/schema-validator.ts
     - src/schemas/zod-schemas.ts → src/core/validation/zod-schemas.ts
     - src/utils/token-counter.ts → src/core/tokens/token-counter.ts
     - src/engine/budget-manager.ts → src/core/tokens/budget-manager.ts
     - src/utils/path-validator.ts → src/core/security/path-validator.ts
     - src/utils/secret-redaction.ts → src/core/security/secret-redaction.ts
   - DoD: kernels have ~0 fan‑out; API unchanged.

3. Split orchestrators
   - Context Pack: split engine into plan/run/emit under features/context-pack.
   - Scoped Pack: split packager into plan/slice/emit under features/scoped-pack.
   - DoD: fan‑out reduced by >30%; unit tests cover seams.

4. Gate & trim re‑exports
   - Replace errors/index.ts with errors/public.ts (limited symbols).
   - Update imports; forbid submodules importing the public hub.
   - DoD: re‑exports reduced ≥50%; no barrel cycles.

5. Folder alignment
   - Moves:
     - engine/file-walker → core/file-walker
     - engine/ts-program-service → core/ts-program/service
     - engine/pack-generator → features/context-pack/pack-generator
     - collectors/** → features/context-pack/collectors/**
     - detectors/** → features/context-pack/detectors/**
     - scoped/{graph-builder,ranker,slicer,stubber} → features/scoped-pack/**
   - DoD: programmatic API + CLI unchanged; golden outputs match.

## Edge Cuts — Explicit List (initial sweep)
- src/errors/error-formatter.ts → src/errors/index.ts (replace with ./error-codes and ./specific-errors)
- src/errors/specific-errors.ts → src/errors/index.ts (replace with ./error-codes)
- src/errors/error-codes.ts → src/errors/index.ts (should be one‑way only; remove if present)
- src/collectors/files-manifest-collector.ts → src/collectors/collector-registry.ts
- src/collectors/typescript/exports-collector.ts → src/collectors/collector-registry.ts
- src/collectors/typescript/import-graph-collector.ts → src/collectors/collector-registry.ts
- src/collectors/typescript/schema-index-collector.ts → src/collectors/collector-registry.ts
- src/collectors/typescript/tsconfig-collector.ts → src/collectors/collector-registry.ts
- src/collectors/typescript/type-metrics-collector.ts → src/collectors/collector-registry.ts
- src/scoped/packager.ts → src/engine/context-pack-engine.ts
- src/scoped/graph-builder.ts → src/engine/context-pack-engine.ts
- src/utils/path-validator.ts → src/errors/index.ts

Treat these as banned; if an edge doesn’t exist, the step is a no‑op.

## Rename & Public Surface
- Introduce errors/public.ts with a minimal, stable export surface.
- Introduce core/index.ts exporting only core services (no barrels for subtrees).

## Tests / DoD per step
- Graph invariants:
  - No edges matching banned patterns.
  - Decrease in SCC count; orchestrator fan‑out reduced.
- Golden text artifacts byte‑exact.
- CLI exit codes preserved (0/2/3/4/5).
- Unit tests for new plan/run/emit seams.

## Risk & Mitigation
- Import churn: use codemods to rewrite paths.
- Hidden test utilities crossing layers: audit tests; add eslint import rules.
- Temporary duplication during moves: commit in small, compiling steps.

## 99‑prompt seed (for later chats)
Paste the contents of 99-prompt.txt from this directory to kick off a sprint on any hotspot.

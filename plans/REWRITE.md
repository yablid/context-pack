# REWRITE.md — Context‑Pack Suite Refactor Plan

## Why this rewrite
Some modules have grown bloated and overlapping. This rewrite consolidates shared logic into a small “core” and re-exposes features via thin, deterministic surfaces. Goals:
- One execution path, multiple outputs (packs/formatters), no forked logic.
- Zero duplication across context analysis, scoped extraction, refactor reporting, and bulk directory bundling.
- Copy‑friendly outputs by default (plain text, few files, consistent separators).
- Predictable budgets, structured exit codes, schema‑validated artifacts.

We do not need backwards compatability - just check into version control now and again, this will be totally republished.

## Target features (v2 suite)
1) Context Pack (existing)
   - Metadata‑only, deterministic snapshot of architecture, deps, exports, TS config, duplication, etc.
   - Continues to produce size‑variant packs; stays the “map of the territory”.

2) Scoped Pack (existing + formatter upgrade)
   - Symbol‑seeded extraction that can emit actual code (explicitly gated).
   - New single‑file “Paste Formatter” optimized for agent consumption (see “Formatters”).

3) Refactor Report (new)
   - Programmatic, high‑signal heuristics from existing artifacts: cycles (SCCs), fan‑in/out hotspots, re‑export concentrators, external‑dep reach, boundary violations.
   - Ships as a compact JSON + optional plain‑text summary for immediate LLM use.

4) Paste Pack (new, “whole‑dir writer”)
   - Mechanical bundler that emits a single, labeled .txt for an entire directory or selection.
   - Uses the same labeling/separators as Scoped’s Paste Formatter to keep the reading model in lockstep.
   - No links, no icons, no rich UI—just clean sections with LOC and paths.
   - include at top total token count and breakdown of token count by file.

## Non‑negotiables
- Determinism: same inputs → same outputs.
- Budgets everywhere (bytes/tokens/files/depth).
- Security gates for any code body emission (opt‑in only).
- Schema validation for all machine‑readable outputs.
- Copy‑friendly: one file beats many; plain text beats decoration.

## Architecture (proposed shape)
packages/context-pack/
  src/core/        ← the only place with shared logic
    file-walker/            (globs, ignore rules, content peeking)
    graph/                  (import graph, SCCs, reachability, fan-in/out)
    ts-program/             (Program service, symbol index, type queries)
    reducers/               (artifact reducers, downsampling, budgets)
    validation/             (zod schemas, validator, error shaping)
    security/               (path validator, secret redaction)
    tokens/                 (token counter, estimates)
    io/                     (canonical JSON, NDJSON, stream writers)
  src/features/
    context-pack/           (orchestrates collectors → context artifacts)
    scoped-pack/            (seed parse → rank → slice → stubs → package)
    refactor-report/        (signals computed from core.graph & exports)
    paste-pack/             (bulk directory → labeled single-file dump)
  src/formatters/           (shared formatters)
    json/
    ndjson/
    paste/                  (single-file, copy-first text)
  src/cli/                  (thin wrapper; programmatic API is first-class)
  src/types.ts              (unified contracts for configs & artifacts)
  tests/                    (golden outputs + invariants)

Notes
- “Scoped” and “Paste Pack” do not implement their own graph/TS logic; they call core.ts-program and core.graph.
- “Refactor Report” is a pure consumer of existing context artifacts and core.graph; no new crawling.

## Formatters
We standardize outputs via a formatter interface; all features can target any formatter.

Formatter interface (conceptual)
- name: string
- supports: { text?: true, json?: true }
- write(artifact | stream): Promise<void>

Paste Formatter (single-file, plain text)
- Purpose: minimum cognitive load for agents and easy pasting.
- Separators (exact, stable):
  ==== SECTION: HEADER ====
  ==== FILE: <relative path> (LOC <n>) ====
  ==== EXCERPT: <path> L<start>–L<end> ====
  ==== INDEX ====
  ==== END ====
- Conventions:
  • One file beats many; keep everything in one .txt where possible.
  • No links, no icons, no code fences. Just raw text.
  • Include an INDEX first: relative path, LOC, and one-line purpose.
  • Then “Focus excerpts” (hot path + direct neighbors) in full.
  • Then “Supporting types/interfaces” (only what hot path references).
  • Then “Stubs/Summaries” (exports, signatures, invariants) for the rest.
  • Optional: attach the full bundle as a single .txt only if size is still sane.

JSON Formatter
- Machine‑readable; mirrors today’s artifacts with additional fields where helpful (e.g., refactor signals).

NDJSON Formatter
- Stream friendly for large runs; mirrors JSON shapes per line.

## Feature designs

### 1) Context Pack (carry forward)
- Keep existing collectors: files-manifest, topology, import-graph, duplication, tsconfig, exports, schemas, type-metrics.
- Move all collector plumbing into src/core and expose a simple feature wrapper.
- Outputs: same as today, plus stable “flattened index” for cross-feature reuse.

### 2) Scoped Pack (with Paste Formatter)
Inputs
- seed: FQN (“path#Symbol” or “path#Class.method” or “path#line:col”). 
- policy: allowCodeBodies (required), includeTests/docs (optional). 
- budgets: tokens, bytes, files, depth.

Pipeline
- Parse seed → resolve symbol via core.ts-program.
- Ranked expansion (weighted BFS): calls(3), typeRef(2.5), extends(2), implements(2), imports(1.5), sameFileSibling(1.2), testCovers(1), docMentions(0.3).
- Slice code with context lines; generate stubs when over budget.
- Package result with either JSON/NDJSON or Paste Formatter (single .txt).

Paste output layout (scoped)
  ==== SECTION: HEADER ====
  Seed: <path#symbol>
  Files: <count> | Tokens: <est> | Mode: static
  Policy: allowCodeBodies=<true|false>; includeTests=<T>; includeDocs=<T>
  ==== INDEX ====
  <relative path> | LOC <n> | <one-line purpose>
  ... (one per file)
  ==== EXCERPT: <path> L<start>–L<end> ====
  <code body>
  ==== FILE: <path> (LOC <n>) ====
  <supporting types & interfaces used by hot path>
  ==== FILE: <path> (stubs) ====
  <signatures / invariants only>
  ==== END ====

### 3) Refactor Report (new)
Purpose
- Deterministic, high‑signal cues that unlock maintainability without reading bodies.

Signals (MVP)
- Cycles / tangle: SCCs, membership size, candidate edge cuts.
- Fan‑in hotspots (“kernels”): files with the highest in‑degree.
- Fan‑out orchestrators: files with the highest out‑degree.
- Re‑export concentrators: files with unusually high re‑exports.
- External dep reach: packages imported by most files; boundary adapter candidates.
- Isolation: files that are completely isolated or roots/leaves by graph role.

JSON schema (sketch)
{
  "generatedAt": "ISO",
  "graph": { "sccCount": number, "hasCycles": boolean },
  "cycles": [{ "sccSize": number, "members": [path], "suggestedCuts": [[from, to]] }],
  "fanIn": [{ "path": string, "in": number }],
  "fanOut": [{ "path": string, "out": number }],
  "reexports": [{ "path": string, "count": number }],
  "externalReach": [{ "pkg": string, "files": number }],
  "roles": { "roots": [path], "leaves": [path], "isolated": [path] }
}

Plain‑text summary (Paste Formatter)
  ==== SECTION: HEADER ====
  Refactor Report
  ==== INDEX ====
  Top fan‑in …
  Top fan‑out …
  Cycles …
  ==== END ====

### 4) Paste Pack (whole‑dir writer)
Inputs
- root: directory or explicit globs.
- include/exclude: globs and safety filters.
- budgets: max bytes, max files, per-file LOC guardrails.
- policy: allowCodeBodies (required).

Behavior
- Produce a single .txt with labeled, deterministic sections:
  ==== SECTION: HEADER ====
  Root: <dir> | Files included: <n> | Max LOC per file: <n> | Total LOC: <n>
  ==== INDEX ====
  <relative path> | LOC <n> | <one‑line purpose or first comment>
  ==== FILE: <path> (LOC <n>) ====
  <entire file or truncated with clear note>
  ... repeated ...
  ==== END ====
- Secret redaction applied (PEM, AWS keys, JWTs, DSNs, private keys).
- Path validation prevents traversal and leaves .gitignored content out by default.
- Deterministic file ordering (path, then stable hash as tiebreaker).

## CLI surface (unified)
Programmatic API is primary. CLI remains a thin layer.

Examples
# Context pack (unchanged)
context-pack . --level contracts --print-json

# Scoped pack + single-file paste output
context-pack . --scope src/types.ts#BuildConfig --scope-allow-code --format paste --out scoped.txt

# Refactor report only
context-pack refactor . --format json --out refactor.json
context-pack refactor . --format paste --out refactor.txt

# Paste entire directory (bulk bundling)
context-pack paste ./src --allow-code-bodies --out bundle.txt

# Stream artifacts
context-pack . --print index        # prints flattened index
context-pack . --print graph        # prints reduced graph (stats only)
context-pack . --emit-prompt        # prints 99-prompt.txt

Exit codes
- 0 success; 2 validation warnings; 3 validation errors; 4 budget exceeded (hard); 5 config/arg errors.

## Shared logic (dedupe plan)
Move and reuse in core:
- File discovery + ignore rules.
- Import graph + SCCs + fan‑in/out + reachability.
- TS Program + symbol resolution/index (single instantiation per run).
- Budget manager + token estimates.
- Validators + schema registry.
- Path validator + secret redaction.
- Canonical JSON writer + NDJSON streams + Paste Formatter.

No feature implements its own crawling, graph, or TS program.

## Determinism, security, performance
- Determinism: canonical sorting; canonical JSON; stable seeds & budgets; hash‑based scoped dirs.
- Security: explicit allowCodeBodies; secret redaction; risk profile enforcement; byte/token caps.
- Performance: single TS Program instance; lazy symbol materialization; NDJSON streams for large outputs; plan‑only mode to skip slicing in scoped.

## Milestones
M1 Core extraction + formatter interface + CLI surfacing (carry forward context pack) — week 1
M2 Scoped Paste Formatter + plan‑only mode — week 2
M3 Refactor Report (cycles, fan‑in/out, re‑exports, external reach) — week 3
M4 Paste Pack (whole‑dir writer) — week 4
M5 Harden: golden tests, fixtures, schema contracts, docs & examples — week 5

## Example signals from current repo (for sanity)
- Cycles present; SCC count = 1 (entire graph tangled).
- Graph root: src/engine/context-pack-engine.ts; isolated node: src/cli.ts.
- Fan‑in “kernel”: src/types.ts (22), src/engine/canonical-json.ts (11).
- Fan‑out orchestrators: src/engine/context-pack-engine.ts (15), src/scoped/packager.ts (15).
- Re‑export concentrator: src/errors/index.ts (~27 re‑exports).
- Top external deps by reach: node:fs (11), node:path (10), zod (7).

These justify prioritizing: stabilize kernels (types, canonical json), slice responsibilities out of the engine root, and gate re‑export surfaces.

## Definition of Done
- All four features compile against the same core APIs.
- No duplicate graph/TS logic in any feature.
- Paste Formatter available for Scoped, Refactor Report, and Paste Pack.
- Structured exit codes honored by all commands.
- Golden tests: reproduce exact text output (including separators).
- Docs updated: user‑facing guides for each feature; architecture doc for maintainers.


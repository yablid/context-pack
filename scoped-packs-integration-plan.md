# Scoped Packs (Symbol-Level Context) — Integration Plan for **Context Pack CLI**

> Goal: Add an optional, **deterministic** “scoped pack” pipeline that builds **high‑signal, symbol‑focused context** (code slices + type stubs + manifest) from a seed like `src/runtime/engine-bridge/index.ts#getProbe`, while keeping your existing **metadata‑only** packs unchanged by default.

## 0) Principles & Non‑Goals

**Principles**
- **Opt‑in** and **risk‑gated**: default behavior stays “safe by design” (no code bodies). Scoped packs require either a specific flag or a higher risk profile.
- **Deterministic & reproducible**: same repo+commit+seed+budget ⇒ identical output (ordering, hashing, manifests).
- **Static‑first**, dynamic optional: rely on TypeScript graph first; allow optional runtime augmentation later (coverage/call edges).
- **Slices not files**: only the minimal code ranges for the work at hand, plus doc comments and a few context lines.
- **Explainability**: every included slice/edge has a recorded reason in the manifest.

**Non‑Goals**
- Not a full program slicer or whole‑app bundler.
- Not language‑agnostic in v1 (TypeScript first).

---

## 1) User Experience (CLI/API) — Minimal Surface

### A. One new flag (preferred for simplicity)
```
context-pack <path> --scope <FQN> [--scope-budget 20000] [--scope-mode static|hybrid] [--scope-include tests,docs]
# Example:
context-pack . --scope src/runtime/engine-bridge/index.ts#getProbe --scope-budget 20000 --scope-mode static
```
- **`--scope`**: seed FQN in the form `path#symbol` (for classes: `path#Class.method`; for functions: `path#fn`).
- **`--scope-budget`**: token budget for slices+stubs (default 20k). Bytes are still enforced globally.
- **`--scope-mode`**: `static` (default) or `hybrid` (includes optional dynamic edges when provided later).
- **`--scope-include`**: comma list (`tests`, `docs`) – off by default.

Output is placed under:  
```
.contextpack/scoped/<hash>/
  00-scope.json
  10-symbol-graph.json
  20-slices.ndjson
  30-stubs.d.ts
  40-index.ndjson       # map symbol -> slice(s) & reasons
  TOKEN_COUNTS.txt      # for scoped outputs
```

### B. Programmatic API
```ts
import { buildScopedPack } from "context-pack";
await buildScopedPack({
  root: repoRoot,
  seed: "src/…/index.ts#getProbe",
  mode: "static",
  budgetTokens: 20000,
  include: { tests: false, docs: false },
  riskProfile: "extended" // required to emit code bodies
});
```

> **Safety gate:** Emitting **code bodies** is allowed only when `riskProfile: "extended"` (or an explicit `--allow-code` flag). Otherwise, the scoped pipeline produces **type stubs only**, with slice metadata but no bodies.

---

## 2) New Artifacts & Schemas

Introduce **new schema IDs** (namespaced under `scoped/`):

1. **`scoped/00-scope`** — Scope metadata & reproducibility
   ```jsonc
   {
     "specVersion": "1",
     "seed": "src/file.ts#symbol",
     "commit": "abcdef12",
     "mode": "static|hybrid",
     "budgets": { "tokens": 20000, "bytes": 1500000 },
     "policy": { "includeTests": false, "includeDocs": false, "preferTypes": true },
     "determinism": { "edgeWeights": "v1", "sort": "stable" }
   }
   ```

2. **`scoped/10-symbol-graph`** — Nodes/edges for the scoped dependency graph
   ```jsonc
   {
     "nodes": [{ "id": "sym:getProbe", "kind": "function", "path": "src/…/index.ts" }],
     "edges": [
       { "from": "sym:getProbe", "to": "sym:ProbeOutcome", "type": "typeRef", "weight": 2.5, "reason": "return-type" },
       { "from": "sym:getProbe", "to": "sym:probeHost.run", "type": "calls", "weight": 3.0, "reason": "direct-call" }
     ],
     "ranking": { "algorithm": "weighted-bfs", "maxDepth": 5 }
   }
   ```

3. **`scoped/20-slices`** (NDJSON) — Minimal code ranges (optionally with bodies)
   ```jsonl
   {"path":"src/…/index.ts","range":[360,460],"reasons":["seed"],"doc":"JSDoc…","body":"(only if allowed)"}
   {"path":"src/probes/types.ts","range":[1,120],"reasons":["typeRef:ProbeOutcome"],"doc":"…","body":"…"}
   ```

4. **`scoped/30-stubs.d.ts`** — Ambient declarations for external or pruned deps (text)
   ```ts
   declare module "playwright" { export interface Page {}; export interface BrowserContext {}; }
   export interface ProbeOutcome { /* fields… */ }
   ```

5. **`scoped/40-index`** (NDJSON) — Symbol→slice index & rationale
   ```jsonl
   {"symbol":"sym:getProbe","slices":[{"path":"src/…/index.ts","start":360,"end":460}],"why":["seed"]}
   {"symbol":"sym:ProbeOutcome","slices":[{"path":"src/probes/types.ts","start":1,"end":120}],"why":["typeRef"]}
   ```

Add corresponding **Zod** schemas under `src/schemas/` and register them (`SCHEMA_REGISTRY`).

---

## 3) Architecture Changes (small, additive)

### 3.1 Shared TypeScript Program Service
Create `src/engine/ts-program-service.ts`:
- Owns a single `ts.Program` + `LanguageService` for the repo (built from root tsconfig).
- Reused by: existing TS collectors and the new scoped pipeline.
- Deterministic configuration; exposes utilities:
  - `resolveFqnToNode(seedFqn)`
  - `findReferences(node)`
  - `getTypeRefs(node)`
  - `getCallGraphEdges(node)` (best‑effort for direct calls)
  - `getJsDoc(node)`

> Follow your current import‑graph heuristics for filtering `node_modules`, `dist`, `.d.ts` inputs.

### 3.2 Scoped Graph Builder
`src/scoped/graph-builder.ts`:
- Build nodes/edges from the **seed** using:
  - **Edge types**: `calls`, `isCalledBy` (optional), `typeRef`, `extends`, `implements`, `imports`, `sameFileSibling`, `testCovers`, `docMentions`.
- Persist deterministic string IDs: `sym:<FQN or signature-hash>`.

### 3.3 Ranker (Weighted BFS)
`src/scoped/ranker.ts`:
- Default weights: `calls=3.0`, `typeRef=2.5`, `extends|implements=2.0`, `imports-internal=1.5`, `sameFileSibling=1.2`, `testCovers=1.0`, `docMentions=0.3`.
- Stop conditions: `maxDepth`, `maxFiles`, `budgetTokens` (estimated via `TokenCounter`), and global bytes/budget.
- Preference rule when tight: **keep types/interfaces**, emit **stubs** for implementations.

### 3.4 Slicer
`src/scoped/slicer.ts`:
- Turns ranked nodes into **merged line ranges**: doc comment + symbol body + N context lines (configurable; default 3).
- Reads text once per file; merges overlapping ranges; stable ordering by `(path, start)`.
- **Risk gate**: if not allowed to emit bodies, write `doc` and range metadata only (no `body`).

### 3.5 Stub Generator
`src/scoped/stubber.ts`:
- Produces minimal `d.ts` stubs for:
  - External packages touched by the scope (or used by included types).
  - Internal symbols beyond budget (referenced but pruned).
- Stable, pretty‑printed ambient module declarations.

### 3.6 Packager
`src/scoped/packager.ts`:
- Writes `scoped/00-scope.json`, `10-symbol-graph.json`, `20-slices.ndjson`, `30-stubs.d.ts`, `40-index.ndjson`.
- Uses **CanonicalJSON** and your existing byte budgeting.
- Adds a scoped **TOKEN_COUNTS.txt** via `TokenCounter`.

---

## 4) Engine & CLI Wiring (minimal diff)

- **`src/engine/context-pack-engine.ts`**:
  - Parse `BuildConfig` for `scope?: { seed: string; budgetTokens?: number; mode?: "static"|"hybrid"; include?: { tests?: boolean; docs?: boolean }; allowCode?: boolean }`.
  - After normal pack generation, **optionally** run the scoped pipeline.
  - Reuse `SchemaValidator` for new artifacts.

- **`src/cli.ts`**:
  - Add flags:
    - `--scope <path#symbol>` (string)
    - `--scope-budget <n>` (number; tokens)
    - `--scope-mode <static|hybrid>`
    - `--scope-include <csv>`
    - `--allow-code` **or** map to `riskProfile: "extended"` (choose exactly one source of truth)
  - Keep help text short; reference `context-pack schema` for new IDs.

- **Config plumb**:
  - Extend `BuildConfig` to include an optional `scope` block (above).
  - Defaults: `mode="static"`, `budgetTokens=20000`, `allowCode=false`.

---

## 5) Validation, Determinism, and Budgets

- **Validation**: new Zod schemas + registration; integrate with existing `SchemaValidator`.
- **Determinism**:
  - Stable sorts for nodes/edges, slices, and NDJSON emission.
  - Fixed edge weights versioned in `00-scope.json` (`edgeWeights: "v1"`).
  - Single Program/LS instance; consistent filtering.
- **Budgets**:
  - Byte budget is enforced globally (existing).
  - Add a scoped **token budget** for slices; `TokenCounter` drives admission during BFS.
  - When the next edge would breach budget: emit **stub** and record `reason: "budget"`.

---

## 6) Testing & Goldens

Create a `tests/scoped/` suite:
- **Unit**: `graph-builder`, `ranker`, `slicer`, `stubber`.
- **Golden**: seed→expected `scoped/` artifacts with a small fixture repo.
- **Determinism test**: run twice on the same commit; compare SHA256 of all scoped artifacts.
- **Budget test**: vary `--scope-budget` and assert predictable inclusion/stubbing.
- **Safety test**: with/without `--allow-code` to assert bodies are gated.

---

## 7) Optional Dynamic Augmentation (later)

- `--scope-mode hybrid` triggers a hook:
  - Accept a `run` command (or attach to an existing test) to gather coverage (V8/c8).
  - Merge **`execTouches`** edges and **boost** ranks for executed nodes (+1.0).
  - Persist augmentation details in `00-scope.json`.

---

## 8) Integration with Existing Collectors (TS)

- Refactor TS collectors to optionally use the shared **Program Service** (perf & determinism).
- Keep the rest of the pipeline **unchanged**; scoped output is additive and isolated under `scoped/`.

---

## 9) File/Module Additions (summary)

- `src/engine/ts-program-service.ts`
- `src/scoped/graph-builder.ts`
- `src/scoped/ranker.ts`
- `src/scoped/slicer.ts`
- `src/scoped/stubber.ts`
- `src/scoped/packager.ts`
- `src/schemas/scoped-scope.ts` (00)
- `src/schemas/scoped-symbol-graph.ts` (10)
- `src/schemas/scoped-slices.ts` (20)
- `src/schemas/scoped-stubs.ts` (30; text)
- `src/schemas/scoped-index.ts` (40)

Tiny diffs:
- `src/cli.ts` (flags)
- `src/types.ts` (`BuildConfig.scope?`)
- `src/engine/context-pack-engine.ts` (invoke scoped pack when set)
- `src/engine/schema-validator.ts` (register schemas)

---

## 10) Rollout Plan

1. **Schemas + stubbed packager** (writes empty `scoped/00-scope.json` with seed only).
2. **Program Service** + **Graph Builder** (no slices yet).
3. **Ranker** + **Slicer** (metadata‑only mode by default).
4. **Risk gate** + **allow-code** + **stubber**.
5. **CLI flags** and **Engine wiring**.
6. **Golden tests** and **docs**.

---

## 11) Docs (concise)

- Add `docs/scoped-packs.md` describing:
  - What is a seed FQN; how to find it (e.g., via exports or editor hover).
  - Risk profiles & why bodies are gated.
  - How to read `scoped/10-symbol-graph.json` & `20-slices.ndjson`.
  - How to adjust ranking weights (advanced).

---

## 12) Future

- Multi‑language via LSP (pyright, gopls, rust‑analyzer) with a uniform node/edge ontology.
- IDE integration: quick‑action “Generate scoped pack for symbol under cursor”.
- Incremental graph caching across runs (unchanged commits).

---

## 13) Acceptance Checklist

- [ ] No change to default pack artifacts or sizes when `--scope` is absent.
- [ ] `--scope` produces a deterministic `scoped/` directory keyed by repo+commit+seed.
- [ ] With `riskProfile !== "extended"`, no code bodies are emitted.
- [ ] Token & byte budgets enforced; stubs produced on overflow.
- [ ] Schemas validate; CI green on goldens.
- [ ] Docs published; CLI help concise.

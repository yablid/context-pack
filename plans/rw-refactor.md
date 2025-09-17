# Ensure the markdown file exists for download.
content = """# rw-refactor.md — Refactor Report (v2 suite) — Specification

## Purpose
Provide deterministic, high-signal refactor cues without reading code bodies. The Refactor Report consumes existing context-pack artifacts and the shared `core.graph` API to surface hotspots and chokepoints that most improve maintainability when addressed.

This is intentionally small for v2-MVP and future-proofed for expansion. It avoids new crawling, type-checking, or CLI sprawl: one execution path, multiple formatters.

## Scope (MVP)
Signals computed purely from graph and export metadata:
- Cycles / tangle: SCCs, their sizes, and suggested edge cuts.
- Fan-in hotspots: files most depended upon (afferent coupling).
- Fan-out orchestrators: files depending on many others (efferent coupling).
- Re-export concentrators: modules that primarily re-export symbols.
- External dependency reach: external packages touched by many files.
- Graph roles: roots, leaves, isolated nodes after normalizing the graph.

Out of scope for MVP (but planned): abstractness/instability metrics, dominators/betweenness, temporal coupling (git), near-duplicate clusters, and formal layer-rule policing.

## Inputs
- 30-import-graph.json (or core.graph service): nodes, edges, module kinds.
- 60-exports.json: per-file export inventory including re-exports.
- Optional config: thresholds, ignores, and layer rules (disabled by default).

## Outputs
Two parallel outputs share the same data model:
- Machine-readable JSON artifact for automation.
- Plain-text “Paste” summary via the Paste Formatter for quick human/LLM use.

Both are deterministic: stable ordering, canonical JSON writing, and explicit units.

## Data Model (JSON)
Top-level fields:
- generatedAt: ISO string.
- graph: sccCount, hasCycles (boolean), nodeCount, edgeCount.
- cycles: list of cycle groups with sccSize, members, suggestedCuts.
- fanIn: ranked list of { path, in }.
- fanOut: ranked list of { path, out }.
- reexports: ranked list of { path, count }.
- externalReach: ranked list of { pkg, files }.
- roles: { roots: [path], leaves: [path], isolated: [path] }.
- meta: { rulesetVersion, thresholds, ignoredPaths, notes }.

JSON Schema (informal)
- cycles[].members: sorted, unique relative paths.
- cycles[].suggestedCuts: list of [from, to] edges within the SCC that, if removed, reduce tangle; may be empty if heuristic declines.
- fanIn/fanOut lists are ranked descending; ties broken by path.
- externalReach counts unique files importing that package name (bare specifiers collapsed to top-level package).

## Algorithms (MVP, deterministic)

Graph definitions
- Build a directed graph where nodes are files (after resolving symlinks) and edges represent static imports.
- Normalize paths to a stable relative form and coalesce type-only edges if configured (default: include all edges).

1) SCC detection (cycles / tangle)
- Use Tarjan or Kosaraju to compute strongly connected components.
- Any SCC with size > 1 is a cycle group.
- suggestedCuts heuristic:
  a) Collapse SCC to its subgraph.
  b) Rank edges by weight w(from→to) = 1 / (outdeg(from) + indeg(to) + 1).
  c) Iteratively remove the lowest-weight edge and recompute SCCs until all are size 1 or the removal budget is hit.
- Emit the minimal set of removals found by this greedy pass. Determinism is ensured by stable tie-breakers (path lexicographic).

2) Fan-in / fan-out
- fan-in(node) = in-degree; fan-out(node) = out-degree on the normalized graph.
- Rank descending; include counts. These identify “kernels” (high fan-in, protect and slim) and “orchestrators” (high fan-out, split or interface).

3) Re-export concentrators
- For each file, count the number of exports that reference other modules (export * from, export { x } from “…”, barrel patterns).
- Rank descending and surface outliers beyond the threshold.

4) External dependency reach
- For each bare specifier, map to top-level package (e.g., “lodash/fp” → “lodash”).
- Count unique files importing each package.
- Rank descending; large reach suggests boundary adapters or anti-corruption layers.

5) Roles (roots, leaves, isolated)
- roots: nodes with in-degree = 0 (excluding declared entrypoints/tests if configured).
- leaves: nodes with out-degree = 0.
- isolated: nodes with both degrees = 0 (not entrypoints).
- These often indicate weak integration (orphans) or brittle entry surfaces.

## Scoring and Ranking
To avoid noisy lists, produce a single, ordered “signals” stream with severity and rationale. Each item:
- id: stable identifier.
- kind: cycle_member | fanin | fanout | reexport_concentrator | external_reach | role_root | role_leaf | role_isolated.
- path or pkg: subject of the finding.
- metric: numeric value (e.g., in, out, count, files, sccSize).
- severity: low | medium | high.
- centrality: optional tie-breaker (e.g., in/(in+out)).
- note: concise guidance (“extract interface around X”, “split orchestrator”, “reduce barrel surface”, “adapter for pkg Y”).

Default severity thresholds (tunable)
- SCC: sccSize ≥ 5 → high; 3-4 → medium; 2 → low.
- Fan-in: top 5% → high; next 10% → medium.
- Fan-out: same percentiles as fan-in.
- Re-exports: z-score ≥ 2 vs repo mean → high; ≥ 1 → medium.
- External reach: top 3 packages → high; next 5 → medium.
- Roles: isolated (non-entry) → medium; root/leaf tagged as info unless combined with high fan-in/out.

## Configuration (optional, minimal)
Shape
- ignores: array of globs (paths to drop before analysis).
- entrypoints: array of globs (roots whitelist).
- thresholds: fanInTopPct, fanOutTopPct, reexportZHigh, reexportZMed, sccHighMin, sccMedMin.
- layerRules: disabled by default; see Future Extensions.

Example (YAML)
ignores: [**/*.test.ts, **/docs/**]
entrypoints: [src/cli.ts, src/index.ts]
thresholds:
  fanInTopPct: 5
  fanOutTopPct: 5
  reexportZHigh: 2.0
  reexportZMed: 1.0
  sccHighMin: 5
  sccMedMin: 3

## Formatter: Paste (plain-text)
The Paste Formatter renders a compact, copy-first summary with stable separators.

Header
==== SECTION: HEADER ====
Refactor Report
Generated: <ISO>
Files: <N> | Edges: <M> | SCCs: <count>

Index (top items)
==== INDEX ====
Top fan-in: <path> (in <n>), …
Top fan-out: <path> (out <n>), …
Cycles: <count> groups; largest size <k>
Re-export concentrators: <path> (count <n>), …
External reach: <pkg> (<files> files), …
Roles: roots <n>, leaves <n>, isolated <n>

Details
==== CYCLES ====
SCC size <k>: <path1>, <path2>, …
Suggested cuts: <from> → <to>, …
…

==== FAN-IN ====
<path> in <n>
…

==== FAN-OUT ====
<path> out <n>
…

==== RE-EXPORTS ====
<path> reexports <count>
…

==== EXTERNAL REACH ====
<pkg> in <files> files
…

==== ROLES ====
Roots: <path…>
Leaves: <path…>
Isolated: <path…>

==== END ====

## Programmatic API (stable surface)
TypeScript signatures (conceptual; resides under src/features/refactor-report)

export type RefactorConfig = {
  ignores?: string[]
  entrypoints?: string[]
  thresholds?: {
    fanInTopPct?: number
    fanOutTopPct?: number
    reexportZHigh?: number
    reexportZMed?: number
    sccHighMin?: number
    sccMedMin?: number
  }
}

export type RefactorReport = {
  generatedAt: string
  graph: { sccCount: number; hasCycles: boolean; nodeCount: number; edgeCount: number }
  cycles: { sccSize: number; members: string[]; suggestedCuts: [string, string][] }[]
  fanIn: { path: string; in: number }[]
  fanOut: { path: string; out: number }[]
  reexports: { path: string; count: number }[]
  externalReach: { pkg: string; files: number }[]
  roles: { roots: string[]; leaves: string[]; isolated: string[] }
  meta: { rulesetVersion: string; thresholds: Record<string, number>; ignoredPaths: string[]; notes?: string }
}

export async function generateRefactorReport(core: CoreServices, cfg?: RefactorConfig): Promise<RefactorReport>

export function renderRefactorPaste(report: RefactorReport): string

## CLI (thin, optional)
Examples
context-pack refactor . --format json --out refactor.json
context-pack refactor . --format paste --out refactor.txt
context-pack . --print graph       # reduced stats only

Flags
--ignore <glob> (repeatable)
--entrypoint <glob> (repeatable)
--thresholds <k=v,k=v,…>
--print-json (write JSON to stdout)

## Determinism and Performance
- O(V+E) passes for degrees and SCCs; suggested-cuts heuristic runs only inside SCC subgraphs with stable tie-breakers.
- Canonical sorting and stable path normalization ensure consistent output.
- No code bodies are read; no type-checking or AST traversal required for MVP.
- Single graph instance shared from core; zero duplication of crawling.

## Security and Privacy
- Metadata only. No code bodies or secret content in the report.
- Respect global ignore rules and path validation from core.security.
- Paste Formatter avoids links, icons, and rich UI—pure text with stable separators.

## Testing and Definition of Done
- Golden tests for JSON artifact and Paste output (exact bytes).
- Property tests: recomputing on permuted input order yields identical output.
- Invariant checks: sums, counts, and degree distributions match graph stats.
- Threshold tests: severity bucketing behaves as configured.
- Example fixtures: tiny DAGs with known SCCs and known cuts.

## Future Extensions (non-breaking)
- Abstractness/Instability/Distance metrics derived from export kinds.
- Dominators and betweenness centrality on the SCC-condensed DAG.
- Layer-rule policing via a small allow-matrix.
- Temporal coupling from git to catch co-change clusters.
- Near-duplicate cluster import to surface redundant implementations.
- “Action hints” per finding: e.g., “introduce adapter for pkg X”, “extract interface Y”, “split module by feature boundaries”.

## Summary
Refactor Report stays narrow but useful: a single, deterministic artifact and paste-summary derived from the import graph and exports. It highlights tangle, kernels, orchestrators, barrels, external chokepoints, and structural roles—enough to prioritize high-leverage cuts now, while leaving a clean path to richer heuristics later.
"""
path = "/mnt/data/rw-refactor.md"
with open(path, "w", encoding="utf-8") as f:
    f.write(content)

path

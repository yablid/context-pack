Context‑Pack Suite — Unified v2 Plan (Single File, High‑Signal)

Purpose
Gather trustworthy, copy-friendly context for LLMs through four coordinated features that share one execution path and core services:
- context-pack: metadata map of the whole repo to understand architecture and APIs. Existing implementation is strong; carry forward.
- scoped: targeted context around a symbol/file for surgical edits. Existing implementation is strong; add standardized paste output.
- refactor: graph-driven, metadata-only signals to prioritize structural fixes (no new crawling).
- paste-pack (print util): one clean, labeled text file for a dir or selection when pasting code is necessary.

All packages are globally pnpm-linked and callable by a “context” subagent in the agentic workflow.

Non‑negotiables
- Deterministic outputs; single execution path; schema-validated artifacts
- Explicit budgets and stable seeds
- Security gates for any code bodies; secret redaction
- Copy-first plain text; minimal formatting; stable separators; no links/icons
- Programmatic API is first-class; thin CLI

Architecture (share everything that’s sharable)
core/  (single source of truth)
- file-walker: globs, ignore rules, safe pathing
- ts-program: single TypeScript Program per run; symbol index
- graph: imports/exports, SCCs, fan-in/out, re-export hubs
- tokens: counter/estimates; byte/LOC/file budgets
- reducers: artifact reduction and downsampling
- validation: zod schemas and canonical JSON
- security: path validator, secret redaction
- io: canonical writers (json, ndjson, paste)

features/
- context-pack: orchestrates collectors → context artifacts (reuses core.walker/graph/ts)
- scoped-pack: resolve seed → rank neighborhood → slice/stub → emit (reuses core.graph/ts + paste)
- refactor-report: compute signals from core.graph + exports (no reading bodies, no new crawlers)
- paste-pack: whole-dir single-file dump with redaction and budgets (reuses core.walker/io/tokens)

formatters/
- paste (single-file, copy-first text with stable separators), json, ndjson
- All features target the formatter contract; format is a runtime flag

CLI and types/ remain thin; orchestrators don’t embed core logic.

Formatter Contract (standardize outputs)
All features can emit paste | json | ndjson via a shared formatter interface.

Paste separators (stable; no fences):
==== SECTION: HEADER ====
==== INDEX ====
==== FILE: <path> (LOC <n>) ====
==== EXCERPT: <path> L<start>–L<end> ====
==== SUMMARY ====
==== END ====

Feature Specs (v2)

1) Context‑Pack (carry forward)
- Keep current collectors and size variants (short/minimal/full)
- Expose a flattened “index” for reuse by other features
- Deterministic ordering and canonical JSON

2) Scoped‑Pack (upgrade)
Inputs
- seed: path#symbol or path:line:col
- policy: allowCodeBodies (explicit)
- budgets: token/byte/file/LOC

Pipeline
- resolve seed → rank neighborhood (signals: direct calls, type refs, extends/implements, imports, same-file, tests, docs)
- slice/stub per policy → emit via paste/json
- Outputs suitable for surgical edits and PRs

3) Refactor‑Report (new)
- Signals (MVP): cycles/SCCs (+ suggested cuts), top fan-in/out, re-export hubs, external-dep reach, role classification (roots/leaves/isolated)
- Deterministic JSON + concise paste summary
- No body reads; computed from core.graph + exports only

4) Paste‑Pack (new)
- Single .txt for a dir/selection; labeled sections; deterministic order
- Redact secrets; enforce byte/file/LOC budgets
- Useful when you must paste code to an LLM

Unified CLI (thin, illustrative)
context-pack . --level contracts --print-json
context-pack . --scope src/types.ts#BuildConfig --scope-allow-code --format paste --out scoped.txt
context-pack refactor . --format json --out refactor.json
context-pack paste ./src --allow-code-bodies --out bundle.txt
Streaming: --print index | graph | --emit-prompt (writes 99‑prompt seed if requested)

Determinism, Security, Performance
- Canonical sorting and JSON; stable seeds
- One TS Program per run; NDJSON for large flows
- Explicit allowCodeBodies for any code emission
- Secret redaction on all paste outputs
- Strict budgets (tokens/bytes/files/LOC) with graceful truncation and summaries

Operating Skeleton (enforce in CI)
1) Break cycles
   - Remove barrel loops; forbid cross-feature edges; replace barrels with direct imports
   - DoD: SCC count drops; build clean; goldens stable

2) Isolate kernels into core/
   - Move types, canonical JSON, validator/schemas, token/budget manager, path-validator, secret redaction
   - DoD: kernels ≈0 fan-out; public API intact

3) Split orchestrators into thin drivers
   - context-pack: plan/run/emit
   - scoped-pack: plan/slice/emit
   - DoD: orchestrator fan-out reduced >30%; seam tests added

4) Gate & trim re‑exports
   - Replace errors/index.ts with errors/public.ts; forbid submodules importing public
   - DoD: re-exports reduced ≥50%

5) Align folders to core/features/formatters
   - Move walker/ts-program to core
   - Keep collectors under features/context-pack; scoped helpers under features/scoped-pack
   - DoD: programmatic API + CLI unchanged; goldens match

Milestones (compressed)
M1: core extraction + formatter contract + carry-forward context-pack
M2: scoped Paste + plan-only mode
M3: refactor-report (SCCs, fan-in/out, re-exports, external reach)
M4: paste-pack (whole-dir writer)
M5: harden (goldens, schemas, docs, examples)

Integration Notes
- pnpm link each package; expose a single “context-pack” CLI surface with subcommands/flags
- Programmatic API remains primary for the context subagent
- Outputs stay copy-first; prefer one .txt where viable
- Use the prompt seed (below) when attacking hotspots after each step

Definition of Done (suite)
- All four features compile against the same core with zero duplicated graph/TS logic
- Paste formatter available for scoped, refactor, and paste-pack; structured exit codes honored
- Graph invariants enforced in CI (no banned edges; SCCs non-increasing); orchestrator fan-out reduced
- Golden tests assert byte-exact paste outputs and stable JSON; docs updated

LLM Prompt Seed (Optional, compact)
Goal: Use suite artifacts deterministically; avoid hallucinations; request only what’s allowed.

You are an assistant helping with code navigation and refactors. Follow these rules:
- Prefer metadata and graphs over code bodies. If you need code, state why and request a scoped pack with allowCodeBodies.
- Respect budgets; summarize when truncated.
- Use the INDEX to locate symbols; for edits request a Scoped-Pack with seed=path#symbol and a specific change plan.
- For refactors, justify using graph signals (cycles, fan-in/out, re-exports). Propose cuts and dependency direction changes.
- Never assume hidden files; only reference items present in the artifacts.
- Output should be structured and copyable, with explicit file paths and reasons.

Minimal Subagent Cheat Sheet
- Discover: run context-pack with --print index to see symbols and modules
- Targeted edit: run scoped with a concrete seed and paste format
- Refactor survey: run refactor-report and scan SCCs + fan-in/out
- One-file paste: run paste-pack with budgets and redaction

# CLAUDE.md — Agentic Coding Brief

**Role:** Implement small, deterministic tools and refactors with minimal surprises. Optimize for clarity, maintainability, and testability over cleverness or novelty.

IF YOU DO NOT UNDERSTAND SOMETHING, OR HAVE LOW CONFIDENCE IN DESIGN OR CODE, DO NOT GUESS OR INVENT, PROMPT USER.

---

## 1) Non‑Negotiables
- **Contract first.** Define inputs/outputs (types, JSON Schemas, CLI flags) before writing code.
- **Deterministic builds.** Same inputs → same outputs. No hidden network calls, time, or env coupling without explicit flags.
- **Small, composable modules.** One responsibility per file/function. No god objects, no magic.
- **No black‑box dependencies.** Prefer standard library + well‑known libs. Avoid frameworks that hide control flow.
- **No hidden execution.** Avoid decorators, global singletons, implicit mutation, or side‑effectful module init.
- **Fail fast, loudly.** Validate configs + arguments; exit non‑zero with a clear, actionable message.
- **Strict typing.** TypeScript: `strict: true`, `verbatimModuleSyntax: true`, type‑only imports, no `any` unless justified.

## 2) Architecture & Style
- **Feature capsules.** Each feature = flat directory with `index` (public), `internal/` (private), `types/`, `schemas/`, `tests/`.
- **Explicit boundaries.** Separate parsing, validation, core logic, and I/O. Keep I/O at the edge.
- **Pure core.** Core functions are pure and sync where possible; wrap async & I/O at the boundary layer.
- **Configuration.** Single source of truth; allow CLI flags > env > config file precedence.
- **Error model.** Use domain errors with stable codes; do not throw strings; map to exit codes in CLI.
- **Logging.** Structured logs (JSON or consistent text). No emojis. Levels: error, warn, info, debug.

## 3) Coding Standards
- **Readability > brevity.** Clear names, short functions, early returns.
- **Zero implicit globals.** Pass dependencies explicitly (e.g., FS, clock, RNG) for testability.
- **Immutability by default.** Prefer `const`, do not mutate inputs, avoid shared mutable state.
- **Input validation.** Validate every external input with schemas/guards; narrow types after validation.
- **Dependencies.** Pin exact versions; avoid transitive surprises. Keep the smallest possible runtime surface.
- **Docs inline.** Module header: purpose, inputs/outputs, invariants. Function JSDoc for public APIs only.

## 4) Testing
- **Golden tests for contracts.** Lock JSON outputs, `.d.ts` snapshots, and CLI help.
- **Unit > integration.** Mock only the edges (FS, clock, RNG). Keep core pure to avoid mocks.
- **Coverage discipline.** Cover core logic and error paths. Do not chase 100%—cover risk.
- **Fixtures are data.** Version them; keep small and human‑diffable (NDJSON/JSON).

## 5) Git & CI Hygiene
- **Atomic commits.** One intent per commit, imperative subject, include rationale when non‑obvious.
- **No generated artifacts.** Commit schemas and snapshots, not build output.
- **CI gates.** Typecheck, lint, test, schema‑validate; fail on public API changes unless explicitly allowed.
- **Repro scripts.** Provide `pnpm test`, `pnpm build`, and `pnpm demo` that work on a clean clone.

## 6) Security & Privacy
- **Never store secrets.** Redact values; report counts, not contents.
- **No code bodies in outputs** unless explicitly permitted by spec; prefer hashes/metrics/`.d.ts` only.
- **Path hygiene.** Normalize to POSIX; do not leak absolute paths unless necessary for diagnostics.
- **Input size & budgets.** Enforce caps; downsample with a recorded policy.

## 7) Performance
- **Linear where possible.** Stream large files (NDJSON). Avoid loading entire trees into memory.
- **Measure.** Time major phases; surface `durMs` in outputs. Optimize only after evidence.

## 8) Collaboration Etiquette
- **State assumptions.** List invariants and trade‑offs in PR description.
- **Be explicit.** If you simplify/remove code, note why it’s safe (tests/contracts).
- **Prefer adapters over breaking changes.** Deprecate publicly; migrate internally.

## 9) Delivery Checklist (before you open a PR)
- [ ] Contracts (types/schemas/flags) documented and validated.
- [ ] Public API stable; snapshot updated or change flagged.
- [ ] Error messages clear and actionable; exit codes mapped.
- [ ] Tests pass from a clean clone (`pnpm i && pnpm test`).
- [ ] README/USAGE updated; examples run as‑is.
- [ ] CI passes: typecheck, lint, tests, schema validation.

---

### TypeScript / ESM Defaults (if applicable)
- `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`.
- `module: "ESNext"`, `target: "ES2022"`, `moduleResolution: "Bundler"` or `"NodeNext"`; pick one and document.
- `verbatimModuleSyntax: true`; use `import type` for types; avoid namespace imports except for Node built‑ins.
- Export only intentional surface from `index.ts`; everything else under `internal/`.
- Use `tsup`/`rollup` for ESM builds with `.d.ts` emit; no transpiling features you don’t use.

---

---

## Schema Validation System

**Status**: ✅ Production-ready (Phase 1 complete)

Context-pack includes comprehensive schema validation using zod:

### CLI Usage
```bash
# Generate with validation (default)
context-pack . --verbose

# Validate existing context pack  
context-pack validate ./.contextpack --strict

# Validation-only mode (no generation)
context-pack . --validate-only --strict
```

### Key Features
- **Zod schemas** for all 9 artifact types with strict type safety
- **Field-level error reporting** with actionable messages  
- **NDJSON validation** line-by-line for large manifests
- **Warning system** for performance and quality issues
- **CI integration** with `--strict` mode for pipeline gates

### Validation catches real issues
The system immediately identified bugs in collector outputs, ensuring API stability and data quality.

---

**Principle to remember:** _Make the next engineer faster._ Favor boring, predictable choices and excellent contracts over clever implementations.

Highest-signal outputs to include

regime/environment guardrail
- include these: module, moduleResolution, target, types, paths/aliases, Node version, ESM/CJS rules.
- for tsconfig stuff that actually matters (so maybe reduce entire tsconfig out to these in anything except full mode if not already done)

trimmed pack - already done I think in short / min packs?
authoritative entry files (roots), primary leaves (build artifacts or cli), top external imports, 'hotspots' (files with most inbound edges).
counts + paths, no full graph dump.
minimal way to get public api surface


What: a filtered pack for a target directory/file: 1–2 hop neighborhood in the call/import graph, the exports that touch it, and the tests that cover it.

Why: When you ask the LLM to “modify X,” you give it just the local context it needs.

Keep it tiny: cap to ~20 items; include ^ and v neighbors only.

Invariants / non-negotiables

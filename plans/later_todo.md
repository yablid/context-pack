
This is...I think for scoped. feature add on

3c = “ranking the neighborhood.”
Up to now (3a–3b) you can resolve a seed, build a small dependency/usage graph, and then include nodes until you hit budgets (depth/files/LOC/bytes). That default is essentially BFS + deterministic tie-breaks. It works, but when the candidate set is larger than the budget, BFS keeps “nearest” nodes—not necessarily the most helpful ones.

Ranking adds a scoring layer that orders candidates by estimated relevance to the seed before budget cuts. “Weights” are the coefficients for each relevance signal (direct call, same-file, type ref, etc.). Making them data (JSON) lets you tune without code churn and keeps outputs deterministic.

What 3c changes

Input: same plan-only graph from 3a.

Step: compute a feature vector per candidate symbol and a score = Σ(weightᵢ × featureᵢ).

Output: sort by score (then stable tie-breaks) and take the top items until budgets are met.

When you need it

Only when the candidate set >> budgets. If the set is small, ranking is a no-op (BFS order + tie-breaks).

Minimal signal set (cheap to compute, high signal)

sameFile: 1 if symbol is in the seed’s file.

directCall: 1 if seed directly calls/refers to the symbol (call/use edge).

directRef: 1 if there’s a non-call usage (read/write, new, property access).

typeRef: count of type-only edges (extends, implements, parameter/return types).

importDistance: shortest import hops from seed file (penalize larger distance).

exportedSurface: 1 if symbol is part of public export surface (helps API edits).

isTestOrExample: 1 if under test/example paths (apply negative weight).

Determinism guardrails

Signals are integers/booleans from your existing graph/TS index (no AST rescans).

Tie-break strictly: (BFS distance asc, file path asc, symbol name asc).

Externalize weights and topK; emit a per-item trace (feature→contribution) for debuggability.

Recommended baseline (tune later, but start here)

sameFile: +1.0

directCall: +1.2

directRef: +0.9

typeRef: +0.5 × count (cap at 3)

importDistance: −0.4 × hops (cap at 3)

exportedSurface: +0.6

isTestOrExample: −1.2

How it fits your pipeline

Build candidate set with BFS up to maxDepth D (as you do now).

Compute features from the existing plan-only graph and TS index.

Score, sort, then take items until maxFiles/maxLOC/maxBytes.

Hand that ranked, pruned set to the formatter.
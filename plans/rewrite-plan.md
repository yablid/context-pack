Rewrite.md

We need to turn context-pack into ct - context tools.

At least three major tools
1) context-pack.
	- generate the stuff we need for context pack to pass PROJECT-LEVEL info to llm.
	- "comprehensive, metadata-only analysis of codebase. rich structural info w/o exposing code source bodies"
	- this in in context-pack/docs/context-pack.md
2) scoped
	- code slices and dependency graphs.
	- if I want to fuck with something, what needs to be known about whats around it
	...so we can a) not break things b) not duplicate things, c) not churn?
	- this is in context-pack/docs/scoped.md
	- should have principles/design decisions/etc all flows from that - those are the most important sentences.
3) refactor
	- not sure yet, but this involves some analysis to figure out
		a) regular code stuff (big files, duplicated code, etc)
		b) but also some logic from principles/design decisions etc/

...so def need a first-level check for docs/policies/etc. That has to be part of any context pack.
...and that must get linked by code in/above files/functions/constants...

so some flow first level shared is:
	- check docs
	- check file top
	- check function comments
	- do other stuff

Big question is - what do these share, and how can I share it - and then split clis and agnet instructions to have three agents.

start with the context-pack one which is very solid and gives me the good packs.
...


Short, senior take

• Consolidate, then send once. It’s almost always better to have a tool produce one well-labeled plain-text bundle than to upload 10 separate files.
• Paste when it fits; upload when it doesn’t. For smaller bundles, a single contiguous paste is the most portable between agents. If it’s too big to paste comfortably, upload a single .txt bundle.

Decision rule

If the material is reasonably sized for a single paste:
– Paste one contiguous block (no interleaved commentary).
– Use deterministic separators and a compact index at the top.

If it’s too large for a single paste:
– Upload one plain-text file that already contains the index and labeled sections.
– Keep it human-readable; do not minify or zip if you want the model to reason over it.

If you must move content between different agents/tools:
– Prefer the single-paste bundle (lowest common denominator).
– If you used an upload in Agent A, keep the same single file and re-upload to Agent B; avoid multi-file re-uploads.

For a 40k-line codebase

• Do not try to dump the whole codebase as raw text. You won’t get good value and you’ll run into context limits.
• Instead, generate a layered “single-bundle”:

Header: goal, constraints, specific questions.

Index: relative paths, LOC, one-line purpose.

Focus excerpts: only the hot path and directly related code in full.

Supporting types/interfaces (only what the hot path references).

Stubs/summaries for the rest (exports, signatures, invariants).

Optional: attach the full bundle as a single .txt upload if it exceeds a comfortable paste size.

Mechanical tips

• One file beats many: fewer clicks, less chance of the agent missing something, easier to keep in sync across turns.
• Plain text only: no links, icons, or separate code blocks; use simple separators like:
==== SECTION: HEADER ====
==== FILE: src/path/file.ts (LOC 143) ====
==== EXCERPT: src/path/file.ts L45–L112 ====
==== END ====
• Keep each paste/upload logically self-contained. Every section needed to answer your question should be in that bundle.
• On follow-ups, send deltas only (a tiny “DIFF” section) instead of re-sending the whole thing.
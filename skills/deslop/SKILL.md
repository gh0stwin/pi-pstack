---
name: deslop
description: Remove AI-generated code slop and clean up code style on the current branch's diff. Use before commit or when a diff reads as machine-generated. Skip when the diff is a pure rename or a mechanical format-only change.
---

# Remove AI code slop

Check the diff against the base branch and remove AI-generated slop introduced on this branch.

## Focus Areas

- Extra comments that are unnecessary or inconsistent with local style
- Defensive checks or try/catch blocks that are abnormal for trusted code paths
- Casts to `any` used only to bypass type issues
- Deeply nested code that should be simplified with early returns
- Dead compatibility paths, unused parameters, and speculative guards
- Edits unrelated to the change the branch claims to make
- Other patterns inconsistent with the file and surrounding codebase

## Steps

1. Get the diff: `git diff <base>...HEAD` plus `git status --porcelain` for uncommitted work. Name the base explicitly; do not assume `main`.
2. Read each hunk in the context of its file, not in isolation. Slop is a mismatch between the hunk and the surrounding code.
3. Delete or rewrite only what the hunk itself introduced. Leave pre-existing style alone.
4. Re-run the narrowest check that proves behavior is unchanged (the branch's own test, build, or lint command).
5. Report in one to three sentences: what you removed and what you verified.

## Guardrails

- Keep behavior unchanged unless fixing a clear bug.
- Prefer minimal, focused edits over broad rewrites.
- Do not restyle untouched code, reorder imports the formatter owns, or rename symbols the diff did not introduce.
- If a removal needs a shape decision, stop and hand off to the **architect** skill rather than guessing.
- Keep the final summary concise.

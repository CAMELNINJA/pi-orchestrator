# Delegation Brief Template

Fill in each section. Copy this file as a starting point.

## Goal

One-sentence outcome the orchestrator needs (what done looks like).

## Context

- Files (with line refs from research): `path:line`
- Related code: `path:line`
- Why this area: short rationale

## Constraints

- No `npm install` (zero dependencies)
- No refactors beyond this brief
- No stray files
- Keep frontmatter/agent markers intact
- Keep routing logic unchanged (if TUI, only observe, don't mutate)

## Acceptance criteria

- **Must pass happy path**: [describe]
- **Must pass negative/boundary test** of the vulnerable path (e.g. `npm run test:frame` for TUI: color ON, widths 40, 50, 80, 100, 120, 200)
- [other specific checks]

## Validation to run

- Command 1 (MUST produce machine artifact): `npm run test:frame`
- Command 2: `bash scripts/check-clean-tree.sh`
- Command 3: `git status --porcelain`
- Paste the artifact here (not a summary)

## Runtime / how to activate & verify

- How to trigger: e.g. `/dashboard` in Rex
- Restart/cache needed? Yes/No
- Where artifact lives: e.g. `~/.pi/agent/orchestrator-dashboard/<sessionId>.json`
- How to confirm NEW version loaded: e.g. check version in `/team show`

## Out of scope

Explicitly not done:
- No `npm install`
- No refactors beyond this brief
- No stray files (run `npm run check:clean` first)
- No runtime behavior changes (unless explicitly listed above)

Reference: `docs/DEFINITION_OF_DONE.md`

# Definition of Done

A checklist distilled from the retro §7: prevention over detection.

Every task must pass these gates before marking done:

- **Test reproduces the REAL path**  
  For TUI: color ON (`DASH_FORCE_COLOR=1`), boundary widths (e.g. `npm run test:frame`), broken/empty input. Never report pass on happy-path only.

- **A machine artifact is attached**  
  Checker/test output, capture, or diff—not prose. Examples: `assert-frame` table, `rex block capture`, `diff -u` output.

- **Verified in the real environment**  
  For TUI: `rex block capture`, not just a pipe. Confirm visual behavior matches expectations.

- **Clean `git status`**  
  No `package-lock.json` or junk—run `npm run check:clean` before committing. Stray locks were a recurring retro issue.

- **Runtime activation documented**  
  Restart/cache needed? Where's the artifact? How to confirm the NEW version loaded? (e.g. `/dashboard` in Rex, restart Pi).

- **Independent review passed**  
  Key/risky parts reviewed before merge (not only at the end—engage reviewer after first working version).

- **Async/error semantics described**  
  `await`/`void`/`try-finally` accurately described and matching the code. Never guess; verify.

Reference: `npm run test:frame` for TUI validation.

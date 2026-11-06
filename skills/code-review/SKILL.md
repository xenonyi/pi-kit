---
name: code-review
description: Review committed and working-tree changes across three independent axes — Spec, Standards/Design, and Security/Reliability — with evidence-based findings and explicit test coverage. Use when the user wants to review a branch, PR, fixed point, or current changes.
---

# Code Review

A structured, review-only code review for changes in the current repository. The review has three independent axes:

- **Spec** — does the change implement the originating issue, PRD, contract, or user request?
- **Standards / Design** — does it follow this repository's conventions and maintainable design principles?
- **Security / Reliability** — can it fail, regress, leak data, or be exploited in production?

Keep the axes separate. A change can pass one axis and fail another. Do not let good style hide a spec failure, and do not let correct functionality hide a security or standards problem.

## Operating rules

- This is a **review-only** workflow. Do not edit code unless the user explicitly asks to implement fixes after seeing the findings.
- Every finding must be evidence-based. Do not report a theoretical concern as a defect without a concrete code path, triggering condition, or contract violation.
- Prefer the smallest safe fix. Do not propose a broad rewrite for a local issue.
- Do not invent requirements, repository conventions, consumers, or vulnerabilities.
- If context is unavailable, say so explicitly and lower confidence rather than guessing.

## 1. Establish the review scope

First determine whether the user supplied a fixed point or wants the current working changes.

### Fixed-point / branch / PR review

When the user supplies a commit, branch, tag, `main`, or merge-base:

1. Confirm it resolves: `git rev-parse <fixed-point>`.
2. Capture the committed comparison once: `git diff <fixed-point>...HEAD` (three-dot comparison against the merge-base).
3. Capture commits: `git log <fixed-point>..HEAD --oneline`.
4. Separately inspect working-tree changes:
   - `git diff` — unstaged tracked changes
   - `git diff --cached` — staged changes
   - `git ls-files --others --exclude-standard` — untracked files
5. State whether working-tree changes are included in the review. Include them when the user asks for current changes; otherwise report them as out of scope.

### Current-working-tree review

If no fixed point was supplied, review all current changes without requiring another question:

- `git status -sb`
- `git diff HEAD --stat`
- `git diff HEAD` — tracked changes, staged and unstaged
- `git ls-files --others --exclude-standard` and read relevant untracked files

If there are no committed, staged, unstaged, or untracked changes, report that the review has no input. Ask whether the user wants a specific commit or range reviewed.

### Preflight rules

- A bad fixed point is a blocking preflight error; do not delegate it to a reviewer.
- Do not silently review only unstaged changes when staged or committed changes are in scope.
- For a large diff (roughly more than 500 changed lines), summarize by file first and review in logical feature/module batches.
- Note generated files, vendored code, migrations, and lockfiles separately. Do not spend review effort on generated output unless it changes runtime behavior or the user asks for it.
- Identify entry points, ownership boundaries, and critical paths such as authentication, authorization, payments, data writes, file handling, and network calls.

## 2. Locate context

### Spec source

Find the originating requirements in this order:

1. Issue or PR references in commit messages (`#123`, `Closes #45`, `!67`, etc.). Use the repository's issue-tracker workflow if one is available.
2. A path or URL supplied by the user.
3. A matching document under `docs/`, `specs/`, `.scratch/`, or the repository's planning directory.
4. The user's request and commit messages, only when they contain concrete requirements.

An issue-tracker integration is optional. If its documentation or credentials are unavailable, do not block the review: report that the external issue could not be fetched. If no usable spec exists, skip the Spec axis and say **no spec available**; do not infer a spec from the implementation.

### Standards and repository guidance

Look for applicable instructions and standards, including:

- `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`
- `CODING_STANDARDS.md`, style guides, architecture documents
- package/module-level README files
- test, migration, API, and security conventions

A documented repository rule overrides a generic design heuristic. Tool-enforced rules should not be reported as review findings unless the change bypasses or weakens the enforcement.

## 3. Review in independent lanes

Run the three lanes in parallel when the environment supports isolated sub-agents. Give each reviewer the exact scope, commit list, relevant context, and the common finding contract below. If parallel sub-agents are unavailable, run the lanes sequentially with separate prompts and preserve the same boundaries.

### Spec lane

Report:

- requirements that are missing, partial, or implemented incorrectly;
- behavior added without support from the spec (scope creep);
- compatibility, API, data, or migration behavior that contradicts the contract.

Quote the relevant spec or user-request line for each finding. If no spec is available, return only that fact.

### Standards / Design lane

Check repository standards first. Then use these as judgement-based heuristics:

- SRP, OCP, LSP, ISP, and DIP violations;
- duplicated code, mysterious names, long methods, feature envy, data clumps, primitive obsession;
- repeated conditionals, shotgun surgery, divergent change, speculative generality;
- message chains, middle men, refused bequests, needless inheritance, and inappropriate coupling.

A smell is not automatically a violation. Explain the design consequence and propose a minimal improvement. Do not elevate a style or design smell to P1 without a demonstrated correctness, security, or material performance impact.

### Security / Reliability lane

Inspect changed code and its relevant callers, boundaries, and contracts for:

- XSS, SQL/NoSQL/command/GraphQL injection, SSRF, path traversal, and unsafe deserialization;
- missing authentication, authorization, tenant/ownership checks, IDOR, trust in client-controlled roles or IDs;
- secret or PII leakage, insecure defaults, weak crypto, JWT validation errors, permissive CORS or missing security headers;
- race conditions, check-then-act / TOCTOU, non-atomic updates, missing transactions, idempotency, or distributed locking;
- missing timeouts, retries, rate limits, resource limits, or unbounded loops/buffers;
- swallowed or leaked errors, unhandled async failures, partial writes, silent fallback, and missing observability;
- N+1 queries, unbounded reads, blocking hot paths, cache invalidation/key/tenancy mistakes;
- null and empty-collection handling, numeric/string/Unicode boundaries, pagination, and off-by-one behavior.

Only report a security or reliability issue when the changed code creates a plausible path to impact. State both exploitability or trigger conditions and impact.

### Optional removal / iteration check

Treat removal candidates as optional, non-blocking review suggestions unless there is strong evidence. Before suggesting deletion, check repository references, dynamic/reflection use, scripts, configuration, documentation, tests, external consumers, and feature-flag telemetry where applicable. Distinguish **safe to remove now** from **defer with a migration and rollback plan**.

## 4. Finding contract

Every finding must use this information, in this order:

- **Severity**: P0, P1, P2, or P3
- **Confidence**: High, Medium, or Low
- **Location**: `path/to/file:line` or the smallest relevant hunk
- **Evidence**: the specific changed code, contract, or standards rule
- **Impact**: what can go wrong and who/what is affected
- **Trigger**: input, state, request sequence, or usage required
- **Suggested fix**: the smallest reasonable correction
- **Verification**: test, command, metric, or review needed to validate it

Severity guidance:

- **P0 Critical** — exploitable security issue, data loss/corruption, or a release-blocking correctness failure.
- **P1 High** — reproducible logic error, broken contract, serious authorization/reliability issue, or material performance regression; should be fixed before merge.
- **P2 Medium** — maintainability/design problem, likely edge case, moderate reliability concern, or removal candidate needing follow-up.
- **P3 Low** — non-blocking naming, clarity, style, or minor improvement.

A generic smell, possible optimization, or unverified hypothesis is normally P2/P3 or omitted. Do not use severity as a substitute for evidence.

## 5. Verification before reporting

Before aggregating:

- Re-read the relevant hunk and enough surrounding code to confirm the finding.
- Search callers, tests, types, configuration, and related modules when the finding depends on them.
- Inspect existing tests and changed tests. Run focused, non-destructive tests or static checks when practical; do not claim tests passed if they were not run.
- For security findings, distinguish confirmed behavior from a code-path concern and state what was or was not verified.
- Check that the suggested fix does not violate the spec or repository standards.

## 6. Output format

Use this structure:

```markdown
## Code Review Summary

**Scope**: [base/range or working-tree scope]
**Files reviewed**: X files, Y lines changed
**Tests/checks run**: [commands, or "none"]
**Overall assessment**: [APPROVE / REQUEST_CHANGES / COMMENT]

---

## Spec

### P0 - Critical
(none or findings)

### P1 - High
(none or findings)

### P2 - Medium
(none or findings)

### P3 - Low
(none or findings)

## Standards / Design
(same severity sections)

## Security / Reliability
(same severity sections)

---

## Residual Risks and Coverage Gaps
- [what was not verified, such as external issue tracker, deployment config, migrations, or load behavior]

## Optional Removal / Iteration Plan
(only when supported by evidence)

---

## Next Steps

I found X issues (P0: _, P1: _, P2: _, P3: _).

1. **Fix all**
2. **Fix P0/P1 only**
3. **Fix specific findings**
4. **No changes — review complete**
```

Keep the three axes separate. Report counts per axis when useful, and do not choose a single "worst" issue across different axes. A clean review must explicitly state what was checked, what was not covered, and which follow-up tests or residual risks remain.

Inline comments may use the host platform's format. Always include a portable `path:line` location and the finding contract above as well.

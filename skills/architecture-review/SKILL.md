---
name: architecture-review
description: Evidence-based independent review evaluating correctness, security, concurrency, performance, compatibility, and regression risk.
---

# Independent Architecture Review

## Purpose

Provide objective quality assurance on code changes. Catch real bugs, regressions, and security flaws without creating artificial bottlenecks for non-critical improvements.

## Review Sequence

1. Verify that changes match the intended scope and acceptance criteria.
2. Inspect the complete diff; never rely on summaries.
3. Trace modified call paths, resource lifecycles, and error handlers.
4. Review concurrency, security boundaries, and protocol compatibility.
5. Verify test coverage and inspect test assertions.
6. Classify findings into severity levels:
   - `BLOCKER`: Crash, data corruption, security flaw, core workflow failure.
   - `HIGH`: Correctness defect, broken regression, race condition.
   - `MEDIUM`: Performance or maintainability concern.
   - `LOW`: Style or minor documentation gap.
   - `NOTE`: Observation or future improvement suggestion.

## Verdict Criteria

- `APPROVED`: Zero blocker/high findings; acceptance criteria verified.
- `APPROVED_WITH_NOTES`: Zero blocker/high findings; medium/low improvements recorded for future tracking.
- `CHANGES_REQUIRED`: One or more blocker/high defects detected. Requires remediation.
- `INSUFFICIENT_EVIDENCE`: Diff or test evidence is missing or corrupted.

Only `CHANGES_REQUIRED` halts delivery. Non-critical findings must never block delivery.

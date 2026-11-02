---
name: architecture-review
description: Independently review an architecture proposal or code change against evidence, approved scope, correctness, security, concurrency, performance, compatibility, and regression risk. Use after implementation or for a second opinion.
---

# Independent Architecture Review

## Purpose

Provide adversarial, evidence-based review independent of the implementation agent. The goal is to detect incorrect assumptions, regressions, and incomplete verification before acceptance.

## Review inputs

Request or locate:
- Original task and intended outcome.
- Approved architecture plan and explicit exclusions.
- Baseline branch/commit and final diff.
- Changed-file list.
- Test commands, outputs, and environment.
- Relevant project profile and repository instructions.

If any critical input is missing, record the gap and lower the confidence of the verdict.

## Review sequence

1. Verify that actual changes match the approved scope.
2. Inspect the complete diff; do not rely on summaries.
3. Trace changed execution paths through callers, dependencies, state owners, and side effects.
4. Review data integrity, transactions, idempotency, concurrency, resource lifetime, error handling, security boundaries, and protocol compatibility as relevant.
5. Search for regressions in adjacent components and alternate execution paths.
6. Check tests for meaningful assertions and negative/failure cases.
7. Distinguish compilation, unit, integration, system, and runtime evidence.
8. Review observability, documentation, migration/rollback, and operational impact.
9. Identify assumptions that remain unverified.
10. Return findings without modifying files.

## Severity

- BLOCKER: likely data loss/corruption, security bypass, crash, or core workflow failure.
- HIGH: material correctness, security, concurrency, compatibility, or reliability defect.
- MEDIUM: meaningful performance, maintainability, observability, or testability risk.
- LOW: limited impact.
- NOTE: improvement or evidence gap, not a demonstrated defect.

Each finding must include exact path/symbol, evidence, impact, confidence, and a concrete correction or verification requirement.

## Verdict

Choose one:
- APPROVED
- APPROVED_WITH_NOTES
- CHANGES_REQUIRED
- INSUFFICIENT_EVIDENCE

Never approve when a blocker/high finding exists. Never treat missing evidence as proof of correctness. Do not change the code you review.

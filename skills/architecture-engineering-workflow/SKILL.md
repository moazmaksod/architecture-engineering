---
name: architecture-engineering-workflow
description: End-to-end execution-first engineering workflow governing the 7-stage lifecycle from intake and autonomous decision-making through implementation, testing, independent review, and delivery.
---

# Architecture Engineering Workflow

## Purpose

This skill defines the operational state machine and rules that allow the `architecture-engineering` plugin to reliably deliver working code while maintaining architectural rigor, security, and quality.

## The 7-Stage State Machine

1. `UNDERSTAND`: Map relevant components, execution paths, dependencies, and constraints.
2. `DECIDE`: Make ordinary engineering decisions independently. Enforce the Strict Clarification Policy.
3. `PLAN`: Formulate a bounded plan with exact target files, acceptance criteria, and test strategy.
4. `IMPLEMENT`: Apply changes directly to disk (via `architecture-implementation-agent` or sequential fallback).
5. `TEST`: Execute automated tests, linters, and regression suites.
6. `REVIEW`: Independently inspect the diff and test evidence (via `architecture-review-agent` or sequential fallback).
7. `DELIVER`: Emit the final engineering delivery report detailing changed files, test output, and repository state.

## Transition Invariants

- For implementation requests, the state machine **must not** halt at `PLAN` to ask for routine confirmation. It transitions directly from `PLAN` to `IMPLEMENT`.
- In `IMPLEMENT`, code must actually be written to disk. Emitting a diff in markdown is not a valid completion of this stage.
- In `TEST`, tests must actually be executed if tools permit.
- In `REVIEW`, only `BLOCKER` or `HIGH` findings trigger a transition back to `IMPLEMENT` (maximum 2 remediation cycles).
- When subagent delegation fails, the orchestrator immediately transitions through the stages sequentially without halting.

## Human Approval Boundaries

Separate, explicit human approval is required **only** for:
- Destructive Git operations (`git push`, `git reset --hard`, `git clean`, branch deletion).
- Production database writes, schema drops, or irreversible migrations.
- Outbound deployments or binary publication.
- Ambiguous business requirements that cannot be resolved from code or tests.

## Completion Criteria

A task is complete only when:
1. Target files are modified on disk.
2. Automated tests pass with evidence.
3. Independent review confirms no blocking defects.
4. Final delivery report accurately reflects repository status.

---
name: architecture-engineering-workflow
description: End-to-end execution-first engineering workflow governing the lifecycle from autonomous intake and planning through human approval, implementation, testing, independent review, and delivery.
---

# Architecture Engineering Workflow

## Purpose

This skill defines the operational state machine and rules that allow the `architecture-engineering` plugin to reliably deliver working code while maintaining architectural rigor, security, and human-in-the-loop control over file modifications.

The plugin is strictly opt-in and does not automatically activate or intercept ordinary development sessions.

## The Operational State Machine

1. `UNDERSTAND`: Autonomous mapping of components, execution paths, dependencies, and constraints. (Autonomous Read & Discovery).
2. `DECIDE`: Autonomous resolution of ordinary engineering decisions (signatures, naming, test structure).
3. `PLAN`: Formulate a bounded plan identifying target files, expected changes, acceptance criteria, risks, and verification strategy.
4. `APPROVAL GATE`: Present findings, plan, affected files, expected changes, risks, and validation steps to the user. Wait for explicit human approval before touching project files.
5. `IMPLEMENT`: Apply approved changes directly to disk (via `architecture-implementation-agent` or sequential fallback). Proceed autonomously within approved scope without repeated confirmation requests.
6. `TEST`: Autonomously execute automated tests, linters, and regression suites.
7. `REVIEW`: Independently inspect the diff and test evidence (via `architecture-review-agent` or sequential fallback).
8. `DELIVER`: Emit the final engineering delivery report detailing changed files, test output, and repository state.

## Transition Invariants

- **Autonomous Read & Discovery:** Stages `UNDERSTAND`, `DECIDE`, and `PLAN` proceed autonomously. Never request permission for routine file reads, repository searches, code inspection, dependency tracing, or safe diagnostic tests within the authorized workspace.
- **Human Approval Before Modification:** The state machine halts after `PLAN`. The agent **must not** proceed to `IMPLEMENT` or modify any project files until explicit user approval is granted.
- **Autonomous Post-Approval Execution:** Once the user approves the presented plan and scope, `IMPLEMENT`, `TEST`, and `REVIEW` execute autonomously without repeated confirmation requests, provided actions stay within the approved scope.
- **Scope Discipline & Material Changes:** If implementation requires materially different changes or additional files outside the approved plan, halt and obtain additional explicit approval before proceeding.
- **On-Disk Implementation Invariant:** In `IMPLEMENT`, code must actually be written to disk. Emitting a diff in markdown is not a valid completion of this stage.
- **Test Execution Invariant:** In `TEST`, tests must actually be executed if tools permit.
- **Review Remediations:** In `REVIEW`, only `BLOCKER` or `HIGH` findings trigger a transition back to `IMPLEMENT` (maximum 2 remediation cycles).
- **Sequential Fallback:** When subagent delegation fails, the orchestrator immediately transitions through the stages sequentially without halting.

## Explicit Approval for Dangerous Operations

Approval of an implementation plan is never a blanket authorization for destructive operations. Separate, explicit human approval is strictly required before:
- Destructive Git operations (`git push`, `git reset`, `git commit`, `git merge`, `git rebase`, `git clean`, branch deletion, forced switches).
- Deleting or overwriting important files.
- Destructive database operations, schema drops, or irreversible migrations.
- Changing system security settings, permissions, credentials (`.env*`), or external services.
- Publishing packages, deploying infrastructure, or transmitting project data externally.
- Running commands with potentially irreversible side effects.

## Anti-Permission-Spam Policy

- Do not ask for approval for every file read, search, inspection, or safe test.
- Do not repeatedly ask for approval for actions already covered by the approved plan.
- Use the host's existing permission and safety mechanisms. Do not attempt to bypass them.

## Completion Criteria

A task is complete only when:
1. Target files are modified on disk within the approved scope.
2. Automated tests pass with evidence.
3. Independent review confirms no blocking defects.
4. Final delivery report accurately reflects repository status.

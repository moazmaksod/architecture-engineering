---
name: architecture-engineering-workflow
description: End-to-end knowledge-driven specialist engineering workflow governing the lifecycle from intake through discovery, design, adversarial challenge, human approval, implementation, independent verification, and delivery.
---

# Architecture Engineering Workflow

## Purpose

This skill defines the operational state machine and governance rules that allow the `architecture-engineering` system to reliably deliver working software while enforcing architectural rigor, independent verification, and strict human-in-the-loop control over file modifications.

The Orchestrator acts as a thin coordinator. All specialist investigation, design, implementation, and verification tasks are delegated to dedicated subagents.

## The Operational State Machine

1. `CREATED`: Orchestrator receives user request, defines high-level objectives, and logs initial task state.
2. `DISCOVERY`: Autonomous empirical investigation by `architecture-discovery-agent`. Maps dependencies, component boundaries, and contracts into Elephant facts with exact file and line provenance.
3. `DESIGN`: Architectural synthesis by `architecture-design-agent`. Formulates formal design proposals, affected interfaces, and acceptance criteria.
4. `INDEPENDENT_REVIEW`: Adversarial design challenge by `architecture-goldfish-agent`. Goldfish receives a blind envelope (objective facts, constraints, and proposed spec, stripped of internal deliberation) to independently identify risks, gaps, and alternatives.
5. `AWAITING_USER_APPROVAL`: Orchestrator presents synthesized proposal, side-by-side Goldfish challenge, affected files, risks, and verification strategy to the user. **Halts execution until explicit human approval is received.**
6. `APPROVAL_GRANTED`: Explicit human approval is registered; trusted approval authority issues a cryptographically signed approval token bound to exact task, proposal, and approved scope. The approval gate validates token signature, scope, and expiration before permitting transition to execution.
7. `IMPLEMENTATION`: Upon gate validation, `architecture-implementation-agent` applies approved changes to disk and runs automated unit tests strictly within the authorized scope.
8. `VERIFICATION`: Independent post-implementation review by `architecture-review-agent`. Inspects actual diffs and test logs; returns verdict (`APPROVED`, `APPROVED_WITH_NOTES`, `CHANGES_REQUIRED`, `INSUFFICIENT_EVIDENCE`).
9. `COMPLETED`: On `APPROVED` or `APPROVED_WITH_NOTES`, Orchestrator updates validated project knowledge and presents the final delivery report.
10. `BLOCKED`: Workflow halts when subagent delegation fails, environmental barriers occur, or remediation cycles exceed limits.
11. `REJECTED`: User rejects the architectural proposal at the approval gate.

## Transition Invariants

- **Thin Coordinator Principle:** The Orchestrator coordinates lifecycle transitions and worker dispatches. It never directly investigates source code, designs architectures, writes code, or reviews diffs.
- **No Self-Execution Fallback:** If subagent delegation fails, times out, or is unsupported by the runtime, the Orchestrator **must not** attempt to perform the stage itself. The workflow transitions immediately to `BLOCKED`, and the limitation is reported to the user.
- **Human Approval Before Modification:** The workflow strictly halts at `AWAITING_USER_APPROVAL`. The system **must not** proceed to `IMPLEMENTATION` or dispatch write tools until explicit human approval is granted.
- **Autonomous Post-Approval Execution:** Once user approval is granted, `IMPLEMENTATION` and `VERIFICATION` proceed autonomously within the approved scope without redundant confirmations.
- **Scope Discipline & Material Changes:** If implementation requires changes outside the approved plan or affected files, the agent must halt and request renewed user approval.
- **On-Disk Implementation Invariant:** In `IMPLEMENTATION`, changes must physically be written to disk. Markdown diff snippets do not constitute implementation.
- **Review Remediations:** If `VERIFICATION` returns `CHANGES_REQUIRED`, up to two (2) bounded remediation cycles back to `IMPLEMENTATION` are permitted. If issues remain unresolved after two cycles, the task transitions to `BLOCKED`.

## Specialist Handoff Contracts

To maintain role separation and prevent context pollution or confirmation bias, specialists interact strictly via structured message handoffs:

### 1. Discovery to Orchestrator Handoff (`DISCOVERY` Completion)
- `architecture-discovery-agent` returns a structured Discovery Brief containing verified facts with file and line provenance, explicitly flagged assumptions, and observed defects.
- Discovery strictly provides empirical ground truth ("what is"); it never prescribes solutions.

### 2. Orchestrator to Design Routing (`DESIGN` Dispatch)
- The Orchestrator constructs the Design prompt containing:
  1. The original task objective.
  2. Verified empirical findings and observed issues from Discovery.
  3. Relevant active constraints and ADRs from `.architecture/elephant/`.
- The Orchestrator forwards evidence without editorial distortion or proposed implementation designs.

### 3. Design to Orchestrator Handoff (`DESIGN` Completion)
- `architecture-design-agent` delivers a formal RFC Proposal payload containing:
  - Factual grounding referencing Discovery finding IDs and Elephant record IDs.
  - Explicit assumptions with risks and validation strategies.
  - Component boundaries, interface contracts, and execution flows.
  - Trade-off analysis with rejected alternatives.
  - Affected files and measurable acceptance criteria.
- Design produces specifications ("what should be"); it never edits files or executes code.

### 4. Orchestrator to Goldfish Blind Envelope (`INDEPENDENT_REVIEW` Dispatch)
- The Orchestrator constructs the filtered **Blind Envelope** for `architecture-goldfish-agent`:
  - **INCLUDED:**
    1. The original user task objective.
    2. Relevant verified Discovery evidence with file and line provenance.
    3. Active Elephant facts and constraints.
    4. The formal Design RFC specification, interface contracts, and trade-off analysis.
    5. Explicit acceptance criteria.
  - **EXCLUDED:**
    - Design Agent private deliberations, internal scratchpads, or intermediate drafts.
    - Design Agent self-review, persuasion, or subjective defenses.
    - Orchestrator personal opinions or judgments regarding the proposal.
    - Previous Goldfish reviews that could bias a fresh independent challenge.

### 5. Review & Reconciliation Lifecycle
1. `architecture-goldfish-agent` executes adversarial review and returns its Challenge Report (`ACCEPT`, `ACCEPT_WITH_CONDITIONS`, or `REJECT`).
2. The Orchestrator compares the RFC and Challenge Report.
3. If critical/high defects or rejections are returned:
   - Orchestrator returns specific findings to `architecture-design-agent`.
   - Design produces a revised RFC.
   - The revised RFC triggers a fresh independent Goldfish review.
4. **Remediation Limit:** A maximum of two (2) Design correction cycles are permitted. If critical/high issues remain after two cycles, the task halts immediately in state `BLOCKED`, and unresolved findings are escalated to the user.
5. **Preservation of Disagreements:** The Orchestrator does not arbitrate or erase technical disagreements. It presents the reconciled proposal alongside Goldfish's critique and conditions for the human user's decision at `AWAITING_USER_APPROVAL`.
6. **Zero Implementation Authority:** Neither Goldfish nor Design can authorize file changes or approve implementation. Implementation authorization strictly requires human approval.

### 6. Secure Approval Lifecycle & Scope Gating
1. **Reconciled Presentation:** Orchestrator presents final RFC, Goldfish critique, and unresolved conditions to user at `AWAITING_USER_APPROVAL`.
2. **Explicit Human Consent:** User reviews and grants explicit authorization for specific task ID, proposal ID, and affected file scope.
3. **Token Issuance:** Trusted approval authority issues a cryptographically signed HMAC-SHA-256 approval token (`approval-token.mjs`) recording `taskId`, `proposalId`, `approvedScope`, `issuedAt`, `expiresAt`, and anti-replay `nonce`.
4. **State Transition:** Lifecycle moves to `APPROVAL_GRANTED`.
5. **Gate Validation:** The `PreToolUse` approval gate (`approval-gate.mjs`) verifies signature, expiration, revocation, and scope.
6. **Implementation Execution:** Task transitions to `IMPLEMENTATION`. `architecture-implementation-agent` modifies only authorized files.
7. **Scope Boundary Enforcement:** Any attempt to modify files outside `approvedScope` immediately halts execution and demands renewed human approval.
8. **Verification Gate:** `architecture-review-agent` independently inspects diffs and tests in state `VERIFICATION`.

## Dangerous Operations Boundary

Approval of an implementation plan is never a blanket authorization for destructive operations. Separate, explicit human approval is strictly required before:
- Destructive Git operations (`git push`, `git reset`, `git commit`, `git merge`, `git rebase`, `git clean`, branch deletion, forced checkout).
- Deleting or overwriting important files.
- Destructive database operations, schema drops, or irreversible migrations.
- Changing system security settings, permissions, credentials (`.env*`), or external services.
- Publishing packages, deploying infrastructure, or transmitting project data externally.
- Running commands with potentially irreversible side effects.

## Anti-Permission-Spam Policy

- Do not ask for approval for routine subagent dispatches or safe read-only activities within an approved stage.
- Do not repeatedly ask for approval for actions already authorized by the approved plan.
- Use the host's existing permission and safety mechanisms.

## Completion Criteria

A task is complete only when:
1. Target files are modified on disk within the approved scope.
2. Automated tests pass with runtime evidence.
3. Independent review confirms no blocking defects.
4. Final delivery report accurately reflects repository state.

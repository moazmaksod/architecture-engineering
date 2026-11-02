# Architecture Engineering Workflow

## State machine

The orchestrator must track these stages explicitly:

1. INTAKE
2. BASELINE_CAPTURE
3. DISCOVERY
4. FINDINGS_TRIAGE
5. DESIGN
6. PLAN_PRESENTED
7. USER_APPROVAL_PENDING
8. IMPLEMENTATION
9. INDEPENDENT_REVIEW
10. REMEDIATION (if required)
11. VERIFICATION
12. FINAL_REPORT

A task may stop after DISCOVERY for assessment-only requests or after INDEPENDENT_REVIEW for review-only requests.

## Transition rules

- INTAKE -> BASELINE_CAPTURE: request and project are understood.
- BASELINE_CAPTURE -> DISCOVERY: repository instructions and current state are known.
- DISCOVERY -> FINDINGS_TRIAGE: source-backed report is returned.
- FINDINGS_TRIAGE -> DESIGN: findings are prioritized and uncertainties are explicit.
- DESIGN -> PLAN_PRESENTED: alternatives, scope, risk, tests, and rollback are documented.
- PLAN_PRESENTED -> USER_APPROVAL_PENDING: user is shown the exact plan.
- USER_APPROVAL_PENDING -> IMPLEMENTATION: only after explicit approval of that plan.
- IMPLEMENTATION -> INDEPENDENT_REVIEW: actual diff and test evidence are available.
- INDEPENDENT_REVIEW -> REMEDIATION: reviewer returns CHANGES_REQUIRED.
- REMEDIATION -> INDEPENDENT_REVIEW: bounded correction completed.
- INDEPENDENT_REVIEW -> VERIFICATION: reviewer returns APPROVED or APPROVED_WITH_NOTES.
- Any stage -> STOP: missing evidence, scope drift, unsafe precondition, or unavailable tool.

## Required artifacts

- Baseline: branch, commit, working-tree status where available.
- Discovery: component map, dependency map, findings, evidence labels, unknowns.
- Design: alternatives, chosen design, trade-offs, data/concurrency/security implications.
- Plan: files/components, sequence, acceptance criteria, tests, rollback, exclusions.
- Implementation: changed files and reasons, test results, deviations.
- Review: independent verdict and severity-ranked findings.
- Final: outcome, evidence, unresolved risks, exact Git state.

## Human approval boundaries

The user must approve the implementation plan before code changes. Separate approval is required for Git history operations, database writes/migrations, deployment, binary publication, destructive operations, and any scope expansion.

## Review loop

Allow at most two bounded remediation cycles by default. If the reviewer still reports CHANGES_REQUIRED, or if evidence is insufficient, stop and return control to the user. Never automatically downgrade severity to obtain approval.

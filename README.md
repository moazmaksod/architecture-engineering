# Architecture Engineering

An execution-first Antigravity plugin for evidence-based architecture discovery, engineering implementation, testing, and independent review.

**Status:** Version 0.2.0 (Execution-First Architecture).

## What it provides

The plugin carries software engineering tasks from requirements through planning, implementation, testing, review, and delivery. It eliminates analysis paralysis by enforcing autonomous decision-making for routine engineering choices while maintaining rigorous safety boundaries.

### Coordinated Agent Roles

- **Architecture Orchestrator (`architecture-orchestrator`):** Primary agent. Owns the task from intake through delivery. Formulates bounded plans, executes changes (directly or via delegation), coordinates testing and review, and delivers verified results.
- **Architecture Discovery Agent (`architecture-discovery-agent`):** Action-oriented scout. Maps code boundaries, state owners, and constraints to directly enable implementation.
- **Architecture Implementation Agent (`architecture-implementation-agent`):** Execution specialist. Modifies source files, resolves technical details, updates automated tests, and verifies changes.
- **Architecture Review Agent (`architecture-review-agent`):** Independent quality gate. Inspects diffs and test output. Blocks delivery only for genuine blocker or high-severity defects.

### The Four Operating Modes

1. **Execution Mode (Default):** For implementation requests, features, refactoring, and bug fixes. Carries work all the way through to working code and passing tests.
2. **Read-Only Review Mode:** For audits, architectural assessments, and security reviews. Zero repository files are modified.
3. **Planning Mode:** For requests explicitly asking for a design document, RFC, or architecture plan.
4. **Debugging Mode:** For diagnosing and repairing defect reports with focused regression tests.

### Practical Invocation Examples

#### Implementation Request
> *"Use architecture-engineering to implement a rate-limiting middleware for our API endpoints, add regression tests, and verify the result. Make routine engineering decisions independently and ask only if genuinely blocked."*

#### Read-Only Audit
> *"Use architecture-engineering in strict read-only mode to audit our database transaction boundaries and report evidence-based findings without modifying anything."*

#### Bug Fixing
> *"Use architecture-engineering in debugging mode to reproduce, fix, and test the null pointer exception in the payment webhook handler. Keep changes focused."*

## The 7-Stage Execution Lifecycle

1. **Understand:** Map relevant components and constraints.
2. **Decide:** Resolve routine engineering choices autonomously.
3. **Plan:** Produce a concise, bounded implementation plan.
4. **Implement:** Apply complete, production-grade changes directly to disk.
5. **Test:** Run automated verification and regression tests.
6. **Review:** Adversarially review the actual diff and test evidence.
7. **Deliver:** Provide a concrete delivery report with verified repository state.

## Safety and Human Approval Boundaries

- The plugin executes authorized implementation tasks without redundant confirmation prompts.
- Explicit human approval remains mandatory for destructive Git commands (`push`, `reset`, `clean`), production database migrations, and deployments.
- When subagent delegation is unavailable in the host environment, the orchestrator executes the lifecycle stages sequentially without halting.

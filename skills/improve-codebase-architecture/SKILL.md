---
name: improve-codebase-architecture
description: Surface architectural friction and deepening opportunities by exploring shallow modules, coupling, locality, interfaces, and test seams. Use for architecture health checks and before structural refactoring.
---

# Improve Codebase Architecture

Adapted for Antigravity from Matt Pocock's `improve-codebase-architecture` skill (MIT-licensed; see THIRD_PARTY_NOTICES.md).

## Purpose

Surface architectural friction and propose **deepening opportunities**: changes that concentrate complexity behind smaller, more stable interfaces, improving testability and AI navigability.

Use the project's own domain language. Apply these concepts consistently:

- **Module:** a unit of behavior with an interface and hidden implementation.
- **Depth:** how much useful capability an interface provides relative to the complexity it exposes.
- **Seam:** a place where behavior can be changed or tested through an interface.
- **Adapter:** an implementation that translates between a stable interface and an external dependency.
- **Leverage:** how much capability a small interface provides.
- **Locality:** how much of a behavior can be understood and changed in one place.
- **Deletion test:** would removing or consolidating a shallow module concentrate complexity, or merely move it elsewhere?

Do not label every large file a god object or every small file a shallow module. Follow actual behavior and dependencies.

## Process

### 1. Scope before scanning

- If the user names a subsystem or pain point, focus there.
- Otherwise inspect recent change history when available and use repeated change hotspots as a clue, not as proof.
- Read the repository's glossary, architecture profile, ADRs, and relevant instructions if present.
- Respect repository-specific protected paths and read-only restrictions.

### 2. Explore organically

Use a fresh discovery context/subagent where available. Look for:

- Understanding one concept requires traversing many small modules.
- An interface is almost as complex as the implementation it hides.
- Pure functions were extracted for testability while important correctness depends on callers and integration behavior.
- Tightly coupled modules leak assumptions or shared mutable state across seams.
- Tests exercise internals but cannot verify the real behavior through a stable interface.
- Multiple modules co-own one concept or duplicate policy.

Trace actual callers, callees, lifecycle, state ownership, persistence, concurrency, and failure behavior before concluding that a seam is defective.

### 3. Apply the deletion test

For every candidate, ask:

- What complexity is currently exposed?
- What behavior belongs together?
- Would deleting or consolidating the current seam make the system easier to understand?
- Would a smaller interface hide meaningful implementation complexity?
- Would the proposal improve testability at the real behavioral boundary?
- Is the seam real, or merely hypothetical?

Do not propose interfaces yet.

### 4. Present candidates

Present a ranked shortlist. Each candidate must include:

- Candidate name and involved modules/files.
- Observed friction and concrete evidence.
- Why the modules are coupled or shallow.
- Existing behavior and important constraints.
- Potential deepening direction, without prematurely prescribing a detailed API.
- Testability and locality benefits.
- Risks, trade-offs, and confidence (Strong / Worth exploring / Speculative).
- Contradicting ADRs or project rules, if any.

Separate confirmed facts from inference and unknowns. Ask the user which candidate they want to explore.

### 5. Design only after selection

Once the user selects a candidate:

1. Frame the problem and constraints.
2. Explore at least three materially different interface designs when the decision warrants it:
   - Minimal interface.
   - Flexible/extension-oriented interface.
   - Optimized for the dominant caller.
   - Ports-and-adapters approach when external dependencies justify it.
3. For each design explain interface shape, usage, hidden complexity, dependencies, test surface, and trade-offs.
4. Recommend one design with reasons.
5. Hand the selected design to the Architecture Orchestrator for a formal implementation plan and approval gate.

## Antigravity adaptation and safety

- Use Antigravity's available subagent delegation, not unavailable Claude-specific Skill or Agent tools.
- This skill is assessment/design only. It must not edit source or project documentation.
- Do not automatically create GitHub issues, pull requests, commits, branches, or ADRs.
- Do not create files in the repository. If a visual HTML report is explicitly requested, the orchestrator may create it in a temporary directory after confirming the environment and permitted tools.
- Do not automatically write a glossary, domain model, or ADR. Propose changes and wait for explicit approval.
- Never run a refactor automatically as a consequence of finding a candidate.

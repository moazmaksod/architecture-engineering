# Architecture Engineering

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/Tests-62%20passed-brightgreen.svg)](tests/)
[![Antigravity Plugin](https://img.shields.io/badge/Antigravity-Plugin-orange.svg)](https://antigravity.google)
[![Semantic Version](https://img.shields.io/badge/Version-1.0.0-green.svg)](CHANGELOG.md)

An execution-first, evidence-based architecture discovery, engineering implementation, testing, independent quality review, and autonomous safety system for Antigravity IDE and portable AI agent workflows.

---

## What Problem Does Architecture Engineering Solve?

Modern software projects constantly suffer from **architectural drift**, **shallow abstractions**, **hidden coupling**, and **uninformed refactoring**. General-purpose coding assistants frequently guess system boundaries, hallucinate architectural decisions, emit disconnected markdown diffs, or alter sensitive business domain rules.

**Architecture Engineering** solves this with a disciplined, evidence-based engineering state machine:
- **Zero Guesswork:** Boundaries, call paths, and state ownership are proven directly from repository source code and test evidence before design begins.
- **Human-Controlled Writes:** Autonomous investigation and planning proceed freely, but files on disk are touched **only after explicit human approval** of a bounded plan.
- **Execution to Done:** Once approved, agents autonomously implement production-ready code on disk, update automated tests, run verification suites, and pass independent review.
- **Domain Integrity:** The plugin refactors structure and improves seams, but **never alters or assumes business domain logic**.

---

## Key Features

- 🔍 **Evidence-Based Discovery & Antipattern Auditing:** organic discovery of shallow modules, coupling friction, and test seam weaknesses adapted from Matt Pocock's deepening philosophy.
- 🛡️ **Autonomous Read, Human-Controlled Writes:** strict permission separation ensuring zero unprompted disk mutations while eliminating permission spam during read-only scouting.
- 🤖 **Four Coordinated Agent Roles:** Lead Orchestrator, Discovery Scout, Implementation Specialist, and an adversarial Quality Review Gate.
- ⚡ **High-Performance Backend Standards:** built-in architectural principles for databases, transaction boundaries, concurrency, asynchronous pipelines, networking, and memory safety.
- 🔒 **Fail-Closed Safety Gate (`approval-gate.mjs`):** active tool-call interception blocking accidental Git pushes, resets, recursive file deletions, database drops, and credential mutations.
- 🔄 **Verified Self-Update Engine (`updater.mjs`):** checks official GitHub releases, inspects archives with zip-slip protection, verifies cryptographic SHA-256 checksums, and provides one-command rollback.
- 🧰 **Portable Agent Schema:** designed natively for Antigravity IDE while remaining 100% portable for standalone use in Claude Code, Cursor, GitHub Copilot, and custom CLI agents.

---

## Coordinated Agent Roles

| Agent | Specification | Role & Responsibilities |
| :--- | :--- | :--- |
| **`@architecture-orchestrator`** | `agents/architecture-orchestrator.md` | **Lead Orchestrator.** Owns the engineering lifecycle from intake through verified delivery. Coordinates subagents or falls back seamlessly to sequential execution. |
| **`architecture-discovery-agent`** | `agents/architecture-discovery-agent.md` | **Action-Oriented Scout.** Traces call paths, mutable state owners, and dependency seams without modifying files. |
| **`architecture-implementation-agent`** | `agents/architecture-implementation-agent.md` | **Execution Specialist.** Writes production-ready code directly to disk, updates automated tests, and adheres strictly to codebase conventions. |
| **`architecture-review-agent`** | `agents/architecture-review-agent.md` | **Independent Quality Gate.** Adversarially evaluates diffs and test evidence. Blocks delivery only for blocker or high-severity defects. |

---

## Installation & Setup

### Option 1: Global Installation in Antigravity IDE (Recommended)

Installing globally makes the plugin, agents, skills, and safety guards available across all projects:

#### Windows (PowerShell)
```powershell
# Clone or copy into your global Antigravity plugins directory
git clone https://github.com/moazmaksod/architecture-engineering.git "$env:USERPROFILE\.gemini\config\plugins\architecture-engineering"
```

#### macOS / Linux (Bash)
```bash
git clone https://github.com/moazmaksod/architecture-engineering.git ~/.gemini/config/plugins/architecture-engineering
```

*Restart Antigravity IDE or open a new conversation to load the plugin.*

---

### Option 2: Workspace-Scoped Installation

To isolate the plugin to a single target repository:

#### Windows (PowerShell)
```powershell
# Inside your project root:
New-Item -ItemType Directory -Path ".gemini\plugins\architecture-engineering" -Force
git clone https://github.com/moazmaksod/architecture-engineering.git ".gemini\plugins\architecture-engineering"
```

#### macOS / Linux (Bash)
```bash
mkdir -p .gemini/plugins/architecture-engineering
git clone https://github.com/moazmaksod/architecture-engineering.git .gemini/plugins/architecture-engineering
```

---

### Option 3: Standalone Skill Usage (Claude Code, Cursor, Copilot)

The skills in `skills/` follow standard, open-schema markdown definitions:
- Link or copy `skills/improve-codebase-architecture/SKILL.md` or `skills/high-performance-backend-architecture/SKILL.md` into your agent's skill directory (e.g. `.claude/skills/` or `.cursor/rules/`).
- Agents can read and follow the instructions directly without external dependencies.

---

## Operating Modes & Usage Examples

### 1. Execution Mode (Default)
Carries changes through the full lifecycle: Understand → Decide → Plan → **Human Approval** → Implement → Test → Review → Deliver.

**Prompt Example:**
```text
@architecture-orchestrator Implement Redis-backed token bucket rate limiting on our /api/v1/auth endpoints.
Trace existing middleware, formulate a bounded plan, wait for my approval, then implement and verify with unit tests.
```

**Expected Flow & Output:**
1. **Understand & Plan:** Scans middleware pipeline and returns a concise plan with affected files and test strategies.
2. **Human Approval Gate:** Pauses and asks for explicit confirmation before writing files.
3. **Autonomous Implementation:** Writes code to disk, updates test suites, and runs `npm test`.
4. **Independent Review & Delivery:** Validates diffs and outputs a final delivery report with test evidence.

---

### 2. Read-Only Review Mode
Audits architectures, transaction boundaries, or module coupling without modifying repository files.

**Prompt Example:**
```text
Use architecture-engineering in Read-Only Review Mode to audit database transaction boundaries in src/services/orders.
Identify potential race conditions, lock contention, and non-atomic state mutations. Do not edit any files.
```

**Expected Output:**
- Evidence-based findings citing exact files, symbols, and line ranges.
- Concrete risk classification (`BLOCKER`, `HIGH`, `MEDIUM`, `LOW`).
- Ranked deepening opportunities without premature API churn.

---

### 3. Planning Mode
Produces formal RFCs, architecture proposals, and design documents before writing code.

**Prompt Example:**
```text
Use architecture-engineering in Planning Mode to design a decoupled event-driven webhook processing pipeline.
Produce an architecture proposal outlining service boundaries, dead-letter queues, and retry policies.
```

---

### 4. Debugging Mode
Diagnoses and repairs defect reports with minimal reproductions and regression tests.

**Prompt Example:**
```text
Use architecture-engineering in Debugging Mode to diagnose the worker pool deadlock during SIGTERM shutdown.
Write a reproduction test, formulate a repair plan, await approval, and verify the fix passes cleanly.
```

---

## Self-Update System

Architecture Engineering provides a secure, user-authorized self-update engine:

```powershell
# Check for available stable releases without modifying disk
node ./scripts/updater.mjs check

# Check machine-readable JSON status
node ./scripts/updater.mjs check --json

# Apply approved update safely
node ./scripts/updater.mjs update --yes

# Roll back to the previous version if needed
node ./scripts/updater.mjs rollback
```

### Security & Safety Invariants:
- **Official Stable Releases Only:** Filters out drafts and prereleases from `moazmaksod/architecture-engineering`.
- **Archive Protection:** Strict in-memory tar/gzip parser rejecting symlinks, hardlinks, path traversal (`zip-slip`), and archive bombs.
- **Integrity Verification:** Validates SHA-256 cryptographic checksums before unpacking.
- **Automated Backup & Atomic Rollback:** Creates a timestamped backup before touching files; automatically restores backup if post-install structure checks fail.
- **Workspace Protection:** Refuses to overwrite active source development checkouts.

---

## Verification & Testing

Architecture Engineering maintains comprehensive test coverage with zero external runtime dependencies:

```bash
# Run all test suites
npm test

# Or directly with Node.js test runner
node --test tests/*.test.mjs
```

### Verified Test Suites (62 tests):
- `tests/approval-gate.test.mjs`: 28 tests verifying fail-closed gating, CLI flags, bypass prevention, and path traversal protection.
- `tests/updater.test.mjs`: 21 tests verifying release semver parsing, archive security, hash verification, staging, and rollback.
- `tests/execution-acceptance.test.mjs`: 5 acceptance tests verifying execution lifecycle math and boundary handling.
- `tests/order_processor.test.mjs`: 5 domain verification tests ensuring zero floating-point drift and proper exception handling.

---

## Contributing

Contributions, bug reports, and suggestions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on code style, test requirements, and pull request procedures.

---

## Credits & Attribution

- **Lead Author & Maintainer:** Moaz Maksod ([@moazmaksod](https://github.com/moazmaksod))
- **Upstream Skill Attribution:** The `improve-codebase-architecture` skill is adapted from Matt Pocock's upstream work in [mattpocock/skills](https://github.com/mattpocock/skills), licensed under the MIT License. See [NOTICE.md](NOTICE.md) for full notices.

---

## License

This project is licensed under the [MIT License](LICENSE) &copy; 2026 Moaz Maksod.
Third-party notices and licenses are documented in [NOTICE.md](NOTICE.md).

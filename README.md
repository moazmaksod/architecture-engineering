# Architecture Engineering

An execution-first Antigravity plugin for evidence-based architecture discovery, engineering implementation, testing, independent review, and autonomous safety enforcement.

**Status:** Version 0.3.0 (Autonomous Read & Discovery, Human-Controlled Writes)

---

## Overview

The **Architecture Engineering** plugin guides software engineering tasks through the complete lifecycle: requirements analysis, architecture discovery, implementation, testing, review, and verified delivery. It eliminates analysis paralysis by enforcing autonomous decision-making for routine engineering choices while maintaining rigorous safety boundaries.

### Core Principles
- **Autonomous Read, Human-Controlled Writes:** Clear separation between autonomous discovery permissions and human-authorized write permissions.
- **Execution-First:** Once the bounded plan is approved, proceed autonomously through implementation, testing, and independent review to deliver working, verified software rather than halting or emitting markdown diffs.
- **Business Logic Integrity:** The plugin manages architecture, structure, and testing. It **never alters or guesses business domain rules**; ambiguous business requirements prompt human escalation.
- **Evidence Before Conclusions:** System boundaries and dependencies are confirmed from actual source code and runtime evidence before refactoring.
- **Fail-Closed Safety:** Destructive actions (Git resets/pushes, mass file deletions, disk formatting, production migrations, and deployments) require mandatory human approval.
- **Opt-In Discipline:** The plugin is strictly opt-in and does not automatically activate or intercept ordinary development sessions unless explicitly invoked.

---

## Coordinated Agent Roles

The plugin orchestrates four specialized agent roles:

| Agent | File | Primary Responsibility |
| :--- | :--- | :--- |
| **Architecture Orchestrator** | `agents/architecture-orchestrator.md` | **Lead agent.** Owns the lifecycle from intake to delivery. Formulates bounded plans, coordinates subagents (or executes sequentially as fallback), runs tests, and delivers verified results. |
| **Architecture Discovery Agent** | `agents/architecture-discovery-agent.md` | **Scout.** Maps module boundaries, state owners, and constraints to enable implementation without guesswork. |
| **Architecture Implementation Agent** | `agents/architecture-implementation-agent.md` | **Execution specialist.** Applies code changes directly to disk, adheres to project conventions, updates automated tests, and ensures zero broken builds. |
| **Architecture Review Agent** | `agents/architecture-review-agent.md` | **Quality gate.** Adversarially inspects diffs and test results. Blocks delivery only for blocker/critical defects (data loss, security flaws, crashes). |

---

## Setup & Installation

You can install Architecture Engineering either **globally** across all your Antigravity workspaces or **workspace-scoped** to a single repository.

### Option A: Global Installation (Recommended)

Installing globally makes the plugin, its agents, skills, and safety hook available in every workspace you open in Antigravity.

#### Windows (PowerShell)
```powershell
# Copy the plugin repository into your global Antigravity plugins directory
robocopy "c:\path\to\architecture-engineering" "$env:USERPROFILE\.gemini\config\plugins\architecture-engineering" /MIR /XD .git node_modules
```

#### macOS / Linux (Bash)
```bash
mkdir -p ~/.gemini/config/plugins/architecture-engineering
rsync -av --exclude='.git' --exclude='node_modules' /path/to/architecture-engineering/ ~/.gemini/config/plugins/architecture-engineering/
```

*After installing, restart Antigravity or open a new conversation.*

---

### Option B: Workspace-Scoped Installation

To isolate the plugin to a specific project repository:

#### Windows (PowerShell)
```powershell
# Inside your target project root:
mkdir ".gemini\plugins\architecture-engineering" -Force
robocopy "c:\path\to\architecture-engineering" ".gemini\plugins\architecture-engineering" /MIR /XD .git node_modules
```

#### macOS / Linux (Bash)
```bash
mkdir -p .gemini/plugins/architecture-engineering
rsync -av --exclude='.git' --exclude='node_modules' /path/to/architecture-engineering/ .gemini/plugins/architecture-engineering/
```

---

## (Optional) Project Architecture Profile

For complex or legacy repositories, establish a single source of truth for architecture boundaries:

1. Create a `.architecture` directory in your project root:
   ```bash
   mkdir -p .architecture
   ```
2. Copy the template:
   ```bash
   cp .gemini/plugins/architecture-engineering/templates/PROJECT_PROFILE.template.md .architecture/PROJECT_PROFILE.md
   ```
3. Ask the agent to populate it based on evidence:
   > *"Run a read-only architecture discovery on this project and populate `.architecture/PROJECT_PROFILE.md` with verified component boundaries, data ownership, and constraints."*

---

## Operating Modes & How to Use

The plugin supports four distinct operating modes. You can invoke them via natural language or by mentioning the `@architecture-orchestrator` agent.

### 1. Execution Mode (Default)
For new features, bug fixes, refactoring, and performance improvements. Carries tasks through to working, verified code.

**Prompt Example:**
> *"Use architecture-engineering to implement a Redis-backed rate-limiting middleware for our API endpoints. Make routine engineering decisions independently, add automated tests, and verify the result."*

### 2. Read-Only Review Mode
For architectural assessments, security audits, and code health checks. **Zero files are modified.**

**Prompt Example:**
> *"Use architecture-engineering in Read-Only Review Mode to audit our database transaction boundaries and service layer dependencies. Report evidence-based findings without modifying repository files."*

### 3. Planning Mode
For generating formal RFCs, architecture proposals, and design documents before writing code.

**Prompt Example:**
> *"Use architecture-engineering in Planning Mode to design a decoupled event-driven webhook processing pipeline. Produce an architecture proposal outlining service boundaries and retry policies."*

### 4. Debugging Mode
For diagnosing and fixing defects with minimal reproductions and regression tests.

**Prompt Example:**
> *"Use architecture-engineering in Debugging Mode to diagnose and repair the race condition during worker shutdown. Add a reproduction test to confirm the fix."*

---

## Permission Model — Autonomous Read, Human-Controlled Writes

Architecture Engineering enforces a strict separation between discovery permissions and modification permissions:

### 1. Autonomous Read & Discovery
Within the authorized project workspace, the agent autonomously reads code, searches repositories, traces dependencies and call chains, inspects configurations, identifies risks, runs safe diagnostic tests, and prepares complete implementation plans. **Routine read-only discovery never prompts for individual permissions.**

### 2. Human Approval Before Implementation
Before project files are modified:
1. Present the findings.
2. Present the proposed implementation plan.
3. Identify affected files and expected changes.
4. Explain relevant risks and validation steps.
5. Wait for explicit user approval.

Approval applies specifically to the presented plan and scope. If implementation requires materially different changes, additional approval is sought.

### 3. Explicit Approval for Dangerous Operations
Always obtain separate, explicit human approval before:
- Deleting or overwriting important files.
- Destructive database operations or data migrations.
- Destructive Git operations (`reset`, `clean`, `push`, `branch -D`, `checkout -f`).
- Altering security settings, credentials (`.env*`), or external services.
- Publishing packages, deploying to infrastructure, or transmitting project data externally.
- Running commands with potentially irreversible side effects.

### 4. Anti-Permission-Spam Policy
- Never ask for approval for every file read, search, inspection, or safe test.
- Once the plan is approved, proceed autonomously through implementation, testing, and independent review without repeated confirmation requests.
- Use the host's existing permission and safety mechanisms without attempting bypass.

---

## Execution Lifecycle

When operating in Execution Mode, the orchestrator follows a disciplined lifecycle with an explicit human approval gate before file modification:

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ╔══════════════╗     ┌──────────────┐
│ 1.Understand │ ──► │  2. Decide   │ ──► │   3. Plan    │ ──► ║ HumanApproval║ ──► │ 5. Implement │
└──────────────┘     └──────────────┘     └──────────────┘     ╚══════════════╝     └──────────────┘
                                                                                            │
┌──────────────┐     ┌──────────────┐     ┌──────────────┐                                  ▼
│  8. Deliver  │ ◄── │  7. Review   │ ◄── │   6. Test    │ ◄────────────────────────────────┘
└──────────────┘     └──────────────┘     └──────────────┘
```

1. **Understand (Autonomous Read):** Map relevant code, dependencies, and constraints autonomously.
2. **Decide:** Resolve routine engineering choices autonomously (naming, signatures, test placement) following existing codebase conventions.
3. **Plan:** Formulate a concise, bounded plan identifying files to modify, expected changes, acceptance criteria, risks, and validation strategy.
4. **Human Approval Gate:** Present findings and plan. Wait for explicit human approval before modifying files.
5. **Implement (Autonomous Execution):** Apply production-ready changes directly to disk (delegating to `architecture-implementation-agent` or applying sequentially). Execute approved changes autonomously without repeated confirmation requests.
6. **Test:** Execute automated unit and integration tests autonomously. Regressions are fixed immediately.
7. **Review:** Inspect diffs independently (delegating to `architecture-review-agent`). Only critical defects (crashes, security holes, data loss) block delivery.
8. **Deliver:** Emit a concise report containing modified files, test outputs, and verified repository status.

---

## Safety Approval Hook (`scripts/approval-gate.mjs`)

The plugin includes an active `PreToolUse` lifecycle hook (`hooks.json`) executing `scripts/approval-gate.mjs`.

### How It Works:
- **Routine Engineering Work Flows Freely:** Routine builds, test runs (`npm test`, `pytest`, `cargo test`), inspections (`git status`, `git diff`, `git stash list`), searches (`grep`, `rg`), and standard file creation/edits run without confirmation prompts.
- **Fail-Closed Guarantee:** Missing, empty, or unparseable payloads immediately evaluate to `force_ask`.
- **Mandatory Human Confirmation (`force_ask`) for Destructive Actions:**
  - **Destructive Git Operations:** `git push`, `git reset`, `git commit`, `git merge`, `git rebase`, `git clean`, `git branch -D`, `git checkout -f` (including global flags like `-C`, `--no-pager`, and `git.exe`).
  - **Filesystem Destruction:** `del /s /q`, `rd /s /q`, `rmdir /s`, `rm -rf`, `Remove-Item -Recurse`, disk formatting (`format c:`).
  - **Production Deployments:** `npm publish`, `pnpm publish`, `docker push`, `kubectl apply/delete`, `terraform apply/destroy`.
  - **Sensitive File Protection:** Direct edits or writes targeting `.git/`, `.env*` credentials, system paths, or the approval gate itself (`hooks.json`, `approval-gate.mjs`).
  - **Mutating MCP Tools:** Calls to external tools involving database drops or cloud deletions.

---

## Verification & Testing

The plugin codebase is thoroughly covered by automated test suites.

To run all unit and acceptance tests:

```bash
node --test tests/*.test.mjs
```

### Test Suites Included:
- **`tests/approval-gate.test.mjs`:** 24 unit tests verifying the approval gate's fail-closed architecture, bypass prevention, CLI flag handling, and false-positive reduction.
- **`tests/updater.test.mjs`:** 11 unit and integration tests verifying the self-update system, including semver comparison, zip-slip defense, backup/rollback, junction detection, and dev workspace protection.
- **`tests/execution-acceptance.test.mjs`:** Acceptance tests verifying execution lifecycle math and boundary handling.
- **`tests/order_processor.test.mjs`:** Domain verification suite ensuring zero floating-point drift and proper exception handling.

---

## Self-Update System (`scripts/updater.mjs`)

Architecture Engineering includes a user-controlled, secure self-update system that checks official GitHub releases and updates the installed plugin with explicit approval.

### Supported Commands & Skills
- **`/architecture-check-update`**: Checks whether a new official GitHub release exists without modifying any files.
  ```powershell
  node ./scripts/updater.mjs check
  ```
- **`/architecture-update`**: Checks for updates, presents release notes, asks for user approval, backs up the installation, and safely applies verified files.
  ```powershell
  node ./scripts/updater.mjs update --yes
  ```
- **Rollback**: Restores the previous version from the automated backup if needed.
  ```powershell
  node ./scripts/updater.mjs rollback
  ```

### Safety & Integrity Guarantees
- **Official GitHub Releases Only**: Queries `https://github.com/moazmaksod/architecture-engineering` for stable versioned releases.
- **User Confirmation**: Never silently updates files. Requires explicit approval.
- **Pre-Extraction Defense**: Validates archives against path traversal (`..` or absolute paths) before unpacking.
- **Staging & Validation**: Unpacks into an isolated temporary directory and validates required components (`plugin.json`, `rules/`, `agents/`, `skills/`, `hooks.json`) before touching the installed plugin.
- **Automatic Backup & Rollback**: Creates a timestamped backup prior to installation. Automatically restores the backup if post-install verification fails.
- **Workspace Protection**: Protects the active development repository from accidental overwrites.
- **Junction & Symlink Safety**: Detects Windows junctions and refuses destructive changes unless explicitly permitted.

---

## Maintainer Release Checklist

To publish an official update to GitHub:
1. Update `version` in `plugin.json` (e.g. `0.3.0`).
2. Run test suite: `node --test tests/*.test.mjs`.
3. Commit and push to `main`: `git commit -am "chore: release v0.3.0"` and `git push origin main`.
4. Create a tagged GitHub Release on `https://github.com/moazmaksod/architecture-engineering/releases` with tag `v0.3.0` and attach release notes.
5. Users can now run `/architecture-update` or `/architecture-check-update`.

---

## License & Attribution

Licensed under the Apache License 2.0. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for third-party notices.

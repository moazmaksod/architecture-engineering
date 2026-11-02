# Architecture Engineering

A reusable Antigravity plugin for evidence-based architecture discovery, architecture-first engineering, controlled implementation, and independent review.

**Status:** Experimental, version 0.1.0.

## What it provides

The plugin is designed to work across software repositories without assuming a language, framework, database, deployment model, or repository layout.

It includes four coordinated agent roles:

- **Architecture Orchestrator** — coordinates discovery, planning, approval gates, implementation, and review.
- **Architecture Discovery Agent** — maps the actual system and verifies architectural findings.
- **Architecture Implementation Agent** — designs solutions and implements only an explicitly approved plan.
- **Architecture Review Agent** — independently challenges changes and checks for regressions.

It also includes three core skills:

- `improve-codebase-architecture` — discovers architectural friction and deepening opportunities.
- `high-performance-backend-architecture` — architecture-first engineering across backend, data, networking, concurrency, and security.
- `architecture-review` — evidence-based independent review.

## Repository layout

This repository is the plugin package root:

```text
agents/       Agent definitions
skills/       Reusable skills
rules/        Always-on engineering rules
workflows/    End-to-end workflow and approval state machine
scripts/      Approval-gate hook implementation
templates/    Project profile template
hooks.json    Conservative pre-tool approval hook
plugin.json   Plugin metadata
```

Project-specific facts belong in the consuming repository, not in this plugin. The optional project profile template can be copied to `.architecture/PROJECT_PROFILE.md` after read-only discovery and user approval.

## Install and validate

From this repository root:

```bash
agy plugin validate --strict .
agy plugin install .
agy plugin list --json
agy agents
```

For workspace discovery, install or copy the plugin into the target workspace's `.agents/plugins/architecture-engineering/` directory, then confirm its agents, skills, rules, and hooks are visible in Antigravity's Customizations / Installed view.

Start the primary agent:

```bash
agy --agent architecture-orchestrator
```

Or invoke the discovery skill:

```text
/improve-codebase-architecture
```

Check the current Antigravity CLI and IDE documentation for any version-specific installation or validation changes.

## Engineering workflow

For an engineering task, the orchestrator must:

1. Discover and verify relevant execution paths.
2. Produce an architecture proposal and implementation plan.
3. Present exact scope, files, risks, compatibility concerns, and verification strategy.
4. Wait for explicit user approval of that plan.
5. Delegate implementation only after approval.
6. Require independent review of actual changes.
7. Report test evidence, limitations, and unresolved risks.

Assessment and review default to read-only. A request to fix something is not approval for a broad or unspecified refactor.

## Safety model

- Discovery and review agents are read-only by tool allowlist.
- Implementation is blocked until the user approves a specific plan.
- Mutating tool calls and shell commands trigger a conservative approval prompt.
- The hook intentionally prompts for every matched shell command and potentially mutating or external tool call. This favors safety over convenience.
- Git commit, push, merge, reset, stash, clean, branch deletion, database writes, migrations, deployment, and destructive operations require separate explicit authorization.
- A development branch is isolation, not permission to skip review or backups.
- Never claim a build, test, runtime behavior, or security property was verified unless there is direct evidence.

The hook is an additional guard, not a security boundary. Users must still review tool permissions and Antigravity's execution mode.

## Project profiles

The plugin core is project-neutral. A consuming repository may maintain its own profile describing verified technology stacks, protected paths, build commands, runtime topology, data ownership, and architectural invariants.

Copy `templates/PROJECT_PROFILE.template.md` to the target repository at `.architecture/PROJECT_PROFILE.md` only after read-only discovery and user approval. Fill it with verified facts and mark unknowns explicitly.

If no profile exists, run discovery first. Do not invent missing project facts or reuse another project's assumptions.

## Third-party components

The `improve-codebase-architecture` skill is adapted from Matt Pocock's MIT-licensed skill. The adaptation removes automatic GitHub issue creation and writes, replaces unavailable agent-tool references with Antigravity delegation, and adds evidence and approval policies. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for attribution and license text.

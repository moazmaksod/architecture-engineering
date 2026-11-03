# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0] - 2026-11-04

### Added
- **Production Public Release:** Initial stable release of `architecture-engineering` as an Antigravity IDE plugin and portable skill package.
- **Coordinated Agent Roles:**
  - `@architecture-orchestrator`: Lead lifecycle coordinator managing requirements intake, autonomous exploration, plan formulation, human approval gating, testing, and verified delivery.
  - `architecture-discovery-agent`: Read-only architecture scout mapping call graphs, mutable state owners, and boundary constraints without mutating files.
  - `architecture-implementation-agent`: Execution specialist applying cohesive on-disk code modifications and automated tests.
  - `architecture-review-agent`: Independent quality gate evaluating diffs and test evidence against blocker and high-severity defects.
- **Core Skills Suite:**
  - `skills/architecture-engineering-workflow`: Formal operational state machine (`UNDERSTAND` -> `DECIDE` -> `PLAN` -> `APPROVAL GATE` -> `IMPLEMENT` -> `TEST` -> `REVIEW` -> `DELIVER`).
  - `skills/improve-codebase-architecture`: Antigravity-adapted organic discovery of shallow modules, coupling friction, and test seams based on Matt Pocock's upstream work.
  - `skills/high-performance-backend-architecture`: Architectural design rules for databases, transactions, concurrency, queues, networking, and security.
  - `skills/architecture-review`: Defect severity taxonomy (`BLOCKER`, `HIGH`, `MEDIUM`, `LOW`, `NOTE`) and objective verdict criteria.
  - `skills/architecture-update`: User-facing skill interface supporting `/architecture-check-update` and `/architecture-update`.
- **Fail-Closed Safety Approval Guard (`scripts/approval-gate.mjs`):**
  - Active lifecycle hook (`hooks.json`) intercepting tool calls and evaluating safety invariants.
  - Blocks destructive Git operations (`commit`, `push`, `reset`, `rebase`, `clean`, branch deletion, force switch).
  - Blocks recursive directory deletions, disk formatting, and destructive database migrations.
  - Protects sensitive credentials (`.env*`), Git internals (`.git/`), and security gate files from modification.
- **Secure Self-Update Engine (`scripts/updater.mjs`):**
  - Queries official GitHub releases from `moazmaksod/architecture-engineering`.
  - In-memory tar/gzip parser with zero third-party dependencies.
  - Rigorous defenses against path traversal (`zip-slip`), archive bombs, symlink/hardlink attacks, and duplicate entry collisions.
  - Cryptographic SHA-256 checksum verification.
  - Pre-extraction safety staging, automatic timestamped backup, and automatic rollback on verification failure.
- **Automated Verification Suite:**
  - 62 comprehensive unit and acceptance tests covering approval gates, updater security, archive parsing, and domain logic.
- **Open-Source Packaging & Documentation:**
  - Standard MIT License in `LICENSE` (Moaz Maksod).
  - Dedicated `NOTICE.md` and updated `THIRD_PARTY_NOTICES.md` with upstream attribution to Matt Pocock under the MIT License.
  - Production `plugin.json` and `package.json` manifests with semantic versioning `1.0.0` and search keywords.
  - Standard `.gitignore` protecting secrets, build outputs, and local editor cache.
  - Polished `README.md`, `CONTRIBUTING.md`, and project profile template.


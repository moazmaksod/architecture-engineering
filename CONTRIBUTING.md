# Contributing to Architecture Engineering

Thank you for your interest in contributing to **Architecture Engineering**! We welcome contributions, bug reports, and architectural enhancements.

This document outlines our development workflow, contribution guidelines, and quality expectations.

---

## Code of Conduct & Core Philosophy

Architecture Engineering is built around several foundational principles:
1. **Evidence Before Conclusions:** We value empirical evidence from source code and runtime behavior over theoretical assumptions.
2. **Autonomous Read, Human-Controlled Writes:** Safety is paramount. Agents explore autonomously, but file modifications require human authorization.
3. **Fail-Closed Safety:** Security gates, path traversal checks, and input parsers must always fail safely.
4. **Zero Bloat / Zero Unnecessary Dependencies:** Core scripts (`scripts/updater.mjs`, `scripts/approval-gate.mjs`) use Node.js built-in APIs with zero runtime npm dependencies.

---

## How Can I Contribute?

### 1. Reporting Bugs
- Search existing issues to verify the bug has not already been reported.
- Open a new issue with a clear title and reproduction steps:
  - Operating system and Node.js version.
  - Antigravity IDE version (or host agent platform).
  - Exact command or prompt executed.
  - Expected vs. actual behavior with log outputs.

### 2. Suggesting Features or Architectural Skills
- Open an issue outlining the motivation, proposed agent/skill workflow, and how it aligns with evidence-based architecture engineering.
- Discuss trade-offs and edge cases before submitting large PRs.

---

## Local Development Workflow

### Prerequisites
- [Node.js](https://nodejs.org/) v18.0.0 or higher.
- Git.

### Setup
Clone the repository:
```bash
git clone https://github.com/moazmaksod/architecture-engineering.git
cd architecture-engineering
```

### Running Tests
All tests are implemented using the native Node.js test runner (`node:test` and `node:assert`). No `npm install` is required!

```bash
# Run all unit and integration test suites
npm test

# Or run directly via Node.js
node --test tests/*.test.mjs
```

Ensure all tests pass cleanly before making changes.

---

## Coding & Style Guidelines

### 1. JavaScript & Runtime Scripts
- **Module System:** Pure ECMAScript Modules (`import` / `export`).
- **Dependencies:** Core scripts must remain dependency-free. Rely exclusively on Node.js standard library modules (`node:fs`, `node:path`, `node:crypto`, `node:zlib`, `node:process`, etc.).
- **Security-First:**
  - Strictly sanitize user inputs and archive entry paths (protect against zip-slip and symlink attacks).
  - Maintain fail-closed logic: unparseable or unexpected inputs must reject rather than permit dangerous actions.
  - Test all edge cases, path variations (Windows backslashes vs POSIX slashes), and failure paths.

### 2. Agents & Skills Definitions
- **Frontmatter:** All skills in `skills/*/SKILL.md` must include valid YAML frontmatter (`name`, `description`).
- **Portable Markdown:** Avoid platform-specific proprietary markup so skills remain portable across Antigravity IDE, Claude Code, Cursor, and Copilot.
- **Attribution:** If a skill is derived from or inspired by third-party open-source work, document clear attribution in the YAML frontmatter comments, markdown header, and update `NOTICE.md`.

---

## Pull Request Process

1. **Create a Topic Branch:**
   ```bash
   git checkout -b feat/your-feature-name
   # or
   git checkout -b fix/your-bugfix-name
   ```
2. **Make Cohesive, Well-Documented Changes:**
   - Keep commits focused and descriptive. We recommend [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `test:`, `chore:`).
3. **Add or Update Tests:**
   - Every bugfix must include a reproduction test preventing regression.
   - Every new feature must include comprehensive unit and edge-case tests.
4. **Run Full Verification:**
   ```bash
   node --test tests/*.test.mjs
   ```
   All tests must pass with zero failures.
5. **Submit Your Pull Request:**
   - Provide a clear PR description explaining what was changed and why.
   - Reference any related issues (e.g. `Closes #12`).

---

## Release Process (Maintainers Only)

1. Bump `version` in `plugin.json` and `package.json` according to SemVer.
2. Update `CHANGELOG.md` with release notes under a new version heading.
3. Verify test suite: `npm test`.
4. Commit changes: `git commit -am "chore: release vX.Y.Z"`.
5. Push to `main` and tag the release: `git tag vX.Y.Z && git push origin main --tags`.
6. Publish GitHub Release with release notes and attach release archive.


import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { spawn } from "node:child_process";
import { promoteKnowledge } from "../scripts/elephant-promote.mjs";

function runGit(args) {
  return new Promise((res, rej) => {
    const child = spawn("git", args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => {
      res({ code, stdout: stdout.trim(), stderr: stderr.trim() });
    });
    child.on("error", rej);
  });
}

test("Phase 2 — Elephant Knowledge Foundation Tests", async (t) => {
  const testTmpDir = resolve("tests/fixtures/tmp-elephant-test");

  t.beforeEach(() => {
    if (existsSync(testTmpDir)) rmSync(testTmpDir, { recursive: true, force: true });
    mkdirSync(testTmpDir, { recursive: true });
  });

  t.afterEach(() => {
    if (existsSync(testTmpDir)) rmSync(testTmpDir, { recursive: true, force: true });
  });

  await t.test("Gitignore: tracks .architecture/elephant while ignoring tmp and cache", async () => {
    // git check-ignore exits with 1 if NOT ignored (i.e. tracked)
    const trackedCheck = await runGit(["check-ignore", "-v", ".architecture/elephant/facts/test.md"]);
    assert.equal(trackedCheck.code, 1, ".architecture/elephant/ must NOT be ignored by git");

    // git check-ignore exits with 0 if ignored
    const tmpCheck = await runGit(["check-ignore", "-v", ".architecture/tmp/scratch.md"]);
    assert.equal(tmpCheck.code, 0, ".architecture/tmp/ must be ignored by git");

    const cacheCheck = await runGit(["check-ignore", "-v", ".architecture/cache/cache.bin"]);
    assert.equal(cacheCheck.code, 0, ".architecture/cache/ must be ignored by git");
  });

  await t.test("Templates: elephant.yaml manifest defines required categories", () => {
    const manifestPath = resolve("templates/elephant/elephant.yaml");
    assert.ok(existsSync(manifestPath), "templates/elephant/elephant.yaml must exist");

    const content = readFileSync(manifestPath, "utf-8");
    assert.ok(content.includes('schema_version: "2.1.0"'));
    assert.ok(content.includes("facts:"));
    assert.ok(content.includes("decisions:"));
    assert.ok(content.includes("constraints:"));
    assert.ok(content.includes("assumptions:"));
    assert.ok(content.includes("proposals:"));
    assert.ok(content.includes("known_issues:"));
  });

  await t.test("Templates: all category markdown templates exist with valid frontmatter", () => {
    const expectedTemplates = [
      "facts/FACT.template.md",
      "decisions/ADR.template.md",
      "constraints/CONSTRAINT.template.md",
      "assumptions/ASSUMPTION.template.md",
      "proposals/PROPOSAL.template.md",
      "known-issues/ISSUE.template.md",
    ];

    for (const relPath of expectedTemplates) {
      const fullPath = resolve("templates/elephant", relPath);
      assert.ok(existsSync(fullPath), `Template missing: ${relPath}`);
      const text = readFileSync(fullPath, "utf-8");
      assert.ok(text.startsWith("---"), `${relPath} must begin with frontmatter`);
      assert.ok(text.includes("id:"), `${relPath} must declare id in frontmatter`);
      assert.ok(text.includes("category:"), `${relPath} must declare category in frontmatter`);
      assert.ok(text.includes("status:"), `${relPath} must declare status in frontmatter`);
      assert.ok(text.includes("provenance:"), `${relPath} must declare provenance in frontmatter`);
    }
  });

  await t.test("Elephant Promote: successfully promotes proposal to decisions/ with valid token", () => {
    const proposalFile = join(testTmpDir, "prop-01.md");
    const proposalContent = `---
id: "ADR-0001"
category: "proposal"
status: "draft"
title: "Use Modular Elephant Schema"
---
# Context
We need modular architecture knowledge.
`;
    writeFileSync(proposalFile, proposalContent, "utf-8");

    const result = promoteKnowledge({
      proposalPath: proposalFile,
      category: "decisions",
      token: "AUTH-TOKEN-12345",
      approver: "lead-architect",
      elephantRoot: join("tests/fixtures/tmp-elephant-test", "elephant"),
      workspaceRoot: process.cwd(),
      keepDraft: true,
    });

    assert.equal(result.success, true);
    assert.equal(result.status, "approved");
    assert.equal(result.id, "ADR-0001");
    assert.equal(result.category, "decisions");

    const promotedFile = resolve(result.targetPath);
    assert.ok(existsSync(promotedFile));

    const content = readFileSync(promotedFile, "utf-8");
    assert.ok(content.includes('status: "approved"'));
    assert.ok(content.includes('approved_by: "lead-architect"'));
    assert.ok(content.includes('approval_token: "AUTH-TOKEN-12345"'));
  });

  await t.test("Elephant Promote: rejects decision promotion without approval token", () => {
    const proposalFile = join(testTmpDir, "prop-unapproved.md");
    writeFileSync(proposalFile, `---
id: "ADR-9999"
title: "Unapproved ADR"
---
# Context
Unapproved decision.
`, "utf-8");

    assert.throws(
      () => {
        promoteKnowledge({
          proposalPath: proposalFile,
          category: "decisions",
          token: "", // Empty token
          elephantRoot: join("tests/fixtures/tmp-elephant-test", "elephant"),
          workspaceRoot: process.cwd(),
        });
      },
      /Governance rejection.*strictly requires a valid --token/
    );
  });

  await t.test("Elephant Promote: promotes fact with verified provenance citing real files", () => {
    // package.json exists in workspace root
    const proposalFile = join(testTmpDir, "fact-01.md");
    const proposalContent = `---
id: "FACT-0001"
title: "Package Uses Node Test Runner"
provenance:
  source_files:
    - path: "package.json"
      lines: "1-20"
---
# Observation
package.json specifies native test runner.
`;
    writeFileSync(proposalFile, proposalContent, "utf-8");

    const result = promoteKnowledge({
      proposalPath: proposalFile,
      category: "facts",
      elephantRoot: join("tests/fixtures/tmp-elephant-test", "elephant"),
      workspaceRoot: process.cwd(),
      keepDraft: true,
    });

    assert.equal(result.success, true);
    assert.equal(result.status, "verified");
    assert.equal(result.category, "facts");
  });

  await t.test("Elephant Promote: rejects fact promotion if provenance file does not exist", () => {
    const proposalFile = join(testTmpDir, "fact-invalid.md");
    const proposalContent = `---
id: "FACT-0002"
title: "Non-existent File Fact"
provenance:
  source_files:
    - path: "src/non-existent-file-404.ts"
---
# Observation
Fake fact.
`;
    writeFileSync(proposalFile, proposalContent, "utf-8");

    assert.throws(
      () => {
        promoteKnowledge({
          proposalPath: proposalFile,
          category: "facts",
          elephantRoot: join("tests/fixtures/tmp-elephant-test", "elephant"),
          workspaceRoot: process.cwd(),
        });
      },
      /Provenance verification failed: Source file .* does not exist on disk/
    );
  });

  await t.test("Elephant Promote: enforces immutability and handles superseding", () => {
    const elephantDir = join("tests/fixtures/tmp-elephant-test", "elephant");
    const proposal1 = join(testTmpDir, "adr-01.md");
    writeFileSync(proposal1, `---
id: "ADR-0010"
title: "Original Decision"
---
Original`, "utf-8");

    promoteKnowledge({
      proposalPath: proposal1,
      category: "decisions",
      token: "TOKEN-1",
      elephantRoot: elephantDir,
      workspaceRoot: process.cwd(),
      keepDraft: true,
    });

    // Attempting to overwrite without supersedes throws
    const proposalDuplicate = join(testTmpDir, "adr-dup.md");
    writeFileSync(proposalDuplicate, `---
id: "ADR-0010"
title: "Duplicate Attempt"
---
Duplicate`, "utf-8");

    assert.throws(
      () => {
        promoteKnowledge({
          proposalPath: proposalDuplicate,
          category: "decisions",
          token: "TOKEN-2",
          elephantRoot: elephantDir,
          workspaceRoot: process.cwd(),
        });
      },
      /Immutability violation: Record 'ADR-0010.md' already exists/
    );

    // Properly superseding creates new record and updates old record to superseded
    const proposal2 = join(testTmpDir, "adr-02.md");
    writeFileSync(proposal2, `---
id: "ADR-0011"
title: "Superseding Decision"
supersedes: "ADR-0010"
---
Superseding`, "utf-8");

    promoteKnowledge({
      proposalPath: proposal2,
      category: "decisions",
      token: "TOKEN-3",
      elephantRoot: elephantDir,
      workspaceRoot: process.cwd(),
      keepDraft: true,
    });

    const oldContent = readFileSync(join(elephantDir, "decisions", "ADR-0010.md"), "utf-8");
    assert.ok(oldContent.includes('status: "superseded"'));
    assert.ok(oldContent.includes('superseded_by: "ADR-0011"'));

    const newContent = readFileSync(join(elephantDir, "decisions", "ADR-0011.md"), "utf-8");
    assert.ok(newContent.includes('status: "approved"'));
    assert.ok(newContent.includes('supersedes: "ADR-0010"'));
  });
});


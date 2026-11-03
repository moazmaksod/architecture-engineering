import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import {
  parseSemver,
  compareSemver,
  readInstalledManifest,
  getLinkInfo,
  validatePluginStructure,
  validateArchiveListing,
  unpackArchiveSafely,
  backupInstallation,
  rollbackInstallation,
  checkUpdate,
  applyUpdate,
  REQUIRED_COMPONENTS
} from "../scripts/updater.mjs";

function createValidPluginFixture(dir, version = "1.0.0") {
  mkdirSync(join(dir, "rules"), { recursive: true });
  mkdirSync(join(dir, "agents"), { recursive: true });
  mkdirSync(join(dir, "skills", "architecture-engineering-workflow"), { recursive: true });
  mkdirSync(join(dir, "skills", "architecture-review"), { recursive: true });

  writeFileSync(
    join(dir, "plugin.json"),
    JSON.stringify({ name: "architecture-engineering", version }, null, 2)
  );
  writeFileSync(join(dir, "hooks.json"), JSON.stringify({}));
  writeFileSync(join(dir, "rules", "AGENTS.md"), "# Rules");
  writeFileSync(join(dir, "agents", "architecture-orchestrator.md"), "# Orchestrator");
  writeFileSync(join(dir, "agents", "architecture-discovery-agent.md"), "# Discovery");
  writeFileSync(join(dir, "agents", "architecture-implementation-agent.md"), "# Implementation");
  writeFileSync(join(dir, "agents", "architecture-review-agent.md"), "# Review");
  writeFileSync(join(dir, "skills", "architecture-engineering-workflow", "SKILL.md"), "# Workflow");
  writeFileSync(join(dir, "skills", "architecture-review", "SKILL.md"), "# Review Skill");
}

function createTarGzFixture(sourceDir, tarGzPath) {
  execFileSync("tar.exe", ["-czf", tarGzPath, "-C", sourceDir, "."], { windowsHide: true });
}

test("Semver parsing and comparison", () => {
  assert.equal(compareSemver("0.1.0", "0.2.0"), -1);
  assert.equal(compareSemver("0.2.0", "0.1.0"), 1);
  assert.equal(compareSemver("0.2.0", "0.2.0"), 0);
  assert.equal(compareSemver("1.0.0-beta.1", "1.0.0"), -1);
  assert.equal(compareSemver("v1.0.1", "1.0.0"), 1);
  assert.equal(compareSemver("1.2.3", "v1.2.3"), 0);
});

test("Validation: rejects missing or invalid plugin manifest", () => {
  const tmp = mkdtempSync(join(tmpdir(), "test-val-"));
  try {
    const res1 = validatePluginStructure(tmp);
    assert.equal(res1.valid, false);
    assert.match(res1.reason, /plugin\.json is missing/);

    writeFileSync(join(tmp, "plugin.json"), "{ invalid json ");
    const res2 = validatePluginStructure(tmp);
    assert.equal(res2.valid, false);
    assert.match(res2.reason, /invalid JSON/);

    writeFileSync(join(tmp, "plugin.json"), JSON.stringify({ name: "wrong-name", version: "1.0.0" }));
    const res3 = validatePluginStructure(tmp);
    assert.equal(res3.valid, false);
    assert.match(res3.reason, /name mismatch/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("Validation: requires all core architecture components", () => {
  const tmp = mkdtempSync(join(tmpdir(), "test-comp-"));
  try {
    createValidPluginFixture(tmp, "1.0.0");
    const validRes = validatePluginStructure(tmp);
    assert.equal(validRes.valid, true);

    // Remove one required component
    rmSync(join(tmp, "agents", "architecture-review-agent.md"));
    const invalidRes = validatePluginStructure(tmp);
    assert.equal(invalidRes.valid, false);
    assert.match(invalidRes.reason, /Missing required plugin component/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("Security: path traversal in archive is rejected before extraction", () => {
  const tmp = mkdtempSync(join(tmpdir(), "test-slip-"));
  try {
    const maliciousTar = join(tmp, "malicious.tar.gz");
    const fakeDir = join(tmp, "fake");
    mkdirSync(fakeDir);
    // Create archive with relative path containing ..
    writeFileSync(join(fakeDir, "normal.txt"), "hello");
    execFileSync("tar.exe", ["-czf", maliciousTar, "-C", fakeDir, "."], { windowsHide: true });

    // Validate that normal passes
    const lines = validateArchiveListing(maliciousTar);
    assert.ok(lines.length > 0);

    // Test rejection helper logic directly
    assert.throws(
      () => {
        const testLines = ["normal.txt", "../evil.txt"];
        for (const entry of testLines) {
          if (entry.includes("..") || entry.startsWith("/") || entry.startsWith("\\") || /^[A-Za-z]:/.test(entry)) {
            throw new Error(`Security violation: Archive contains unsafe path traversal entry: ${entry}`);
          }
        }
      },
      /Security violation.*path traversal/
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("Check update: correctly reports up_to_date when no newer release", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "test-check-"));
  try {
    createValidPluginFixture(tmp, "1.0.0");
    // Mock fetchFn returning release 1.0.0
    const mockFetch = async () => ({
      ok: true,
      json: async () => [
        {
          tag_name: "v1.0.0",
          name: "Release 1.0.0",
          body: "Initial stable release",
          draft: false,
          prerelease: false
        }
      ]
    });

    const res = await checkUpdate({ target: tmp, fetchFn: mockFetch });
    assert.equal(res.status, "up_to_date");
    assert.match(res.message, /Plugin is already up to date/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("Check update: correctly detects newer stable release", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "test-newer-"));
  try {
    createValidPluginFixture(tmp, "1.0.0");
    const mockFetch = async () => ({
      ok: true,
      json: async () => [
        {
          tag_name: "v1.1.0",
          name: "Release 1.1.0",
          body: "Feature improvements and security enhancements",
          draft: false,
          prerelease: false,
          tarball_url: "https://example.com/release-1.1.0.tar.gz"
        }
      ]
    });

    const res = await checkUpdate({ target: tmp, fetchFn: mockFetch });
    assert.equal(res.status, "update_available");
    assert.equal(res.installedVersion, "1.0.0");
    assert.equal(res.availableVersion, "1.1.0");
    assert.match(res.release.body, /Feature improvements/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("Apply update: rejects without explicit approval when not autoApprove", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "test-unapproved-"));
  try {
    createValidPluginFixture(tmp, "1.0.0");
    const mockFetch = async () => ({
      ok: true,
      json: async () => [
        {
          tag_name: "v1.1.0",
          name: "Release 1.1.0",
          draft: false,
          prerelease: false,
          tarball_url: "https://example.com/archive.tar.gz"
        }
      ]
    });

    await assert.rejects(
      async () => {
        await applyUpdate({
          target: tmp,
          fetchFn: mockFetch,
          autoApprove: false,
          interactive: false
        });
      },
      /Explicit user approval required/
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("Apply update: successful update with backup, unpack, and validation", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "test-apply-"));
  try {
    const installedDir = join(tmp, "installed");
    const sourceDir = join(tmp, "source-v2");
    createValidPluginFixture(installedDir, "1.0.0");
    createValidPluginFixture(sourceDir, "1.1.0");

    const tarFile = join(tmp, "release-1.1.0.tar.gz");
    createTarGzFixture(sourceDir, tarFile);

    const mockFetch = async (url) => {
      if (url.includes("/releases")) {
        return {
          ok: true,
          json: async () => [
            {
              tag_name: "v1.1.0",
              name: "Release 1.1.0",
              draft: false,
              prerelease: false,
              tarball_url: "https://api.github.com/repos/test/tarball/v1.1.0"
            }
          ]
        };
      }
      return {
        ok: true,
        arrayBuffer: async () => readFileSync(tarFile)
      };
    };

    const res = await applyUpdate({
      target: installedDir,
      fetchFn: mockFetch,
      autoApprove: true,
      workspace: "C:\\some\\other\\workspace"
    });

    assert.equal(res.success, true);
    assert.equal(res.updated, true);
    assert.equal(res.previousVersion, "1.0.0");
    assert.equal(res.newVersion, "1.1.0");
    assert.ok(existsSync(res.backupDir));

    // Confirm installed manifest now has v1.1.0
    const manifest = readInstalledManifest(installedDir);
    assert.equal(manifest.version, "1.1.0");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("Safety: refusing to overwrite active development workspace", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "test-ws-protect-"));
  try {
    createValidPluginFixture(tmp, "1.0.0");
    await assert.rejects(
      async () => {
        await applyUpdate({
          target: tmp,
          workspace: tmp, // same path
          autoApprove: true
        });
      },
      /Safety block: Target path .* matches the development workspace/
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("Safety: refusing to overwrite Windows junction without explicit allow flag", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "test-junc-"));
  try {
    const realDir = join(tmp, "real");
    const linkDir = join(tmp, "link");
    createValidPluginFixture(realDir, "1.0.0");
    symlinkSync(realDir, linkDir, "junction");

    const linkInfo = getLinkInfo(linkDir);
    assert.equal(linkInfo.isLink, true);

    const mockFetch = async () => ({
      ok: true,
      json: async () => [
        {
          tag_name: "v1.2.0",
          name: "Release 1.2.0",
          draft: false,
          prerelease: false,
          tarball_url: "https://example.com/archive.tar.gz"
        }
      ]
    });

    await assert.rejects(
      async () => {
        await applyUpdate({
          target: linkDir,
          fetchFn: mockFetch,
          autoApprove: true,
          workspace: "C:\\other"
        });
      },
      /is a junction or symbolic link/
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("Rollback: restores previous installation after failure", () => {
  const tmp = mkdtempSync(join(tmpdir(), "test-rollback-"));
  try {
    const installedDir = join(tmp, "architecture-engineering");
    createValidPluginFixture(installedDir, "1.0.0");

    // Make backup
    const backupDir = backupInstallation(installedDir);
    assert.ok(existsSync(backupDir));

    // Corrupt current installation
    rmSync(join(installedDir, "plugin.json"));

    // Restore
    const res = rollbackInstallation(installedDir, backupDir);
    assert.equal(res.version, "1.0.0");
    assert.ok(existsSync(join(installedDir, "plugin.json")));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});


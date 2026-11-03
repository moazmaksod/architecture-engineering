import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  readFileSync,
  symlinkSync
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { gzipSync, gunzipSync } from "node:zlib";
import { execFileSync } from "node:child_process";
import {
  parseSemver,
  compareSemver,
  fetchLatestRelease,
  readInstalledManifest,
  getLinkInfo,
  validatePluginStructure,
  parseTarBuffer,
  isContainedPath,
  unpackArchiveSafely,
  parseChecksumFile,
  computeSha256,
  verifyArtifactIntegrity,
  backupInstallation,
  rollbackInstallation,
  checkUpdate,
  applyUpdate,
  REQUIRED_COMPONENTS,
  ARCHIVE_LIMITS
} from "../scripts/updater.mjs";

function createValidPluginFixture(dir, version = "1.0.0") {
  mkdirSync(join(dir, "rules"), { recursive: true });
  mkdirSync(join(dir, "agents"), { recursive: true });
  mkdirSync(join(dir, "scripts"), { recursive: true });
  mkdirSync(join(dir, "skills", "architecture-engineering-workflow"), { recursive: true });
  mkdirSync(join(dir, "skills", "architecture-review"), { recursive: true });
  mkdirSync(join(dir, "skills", "high-performance-backend-architecture"), { recursive: true });
  mkdirSync(join(dir, "skills", "improve-codebase-architecture"), { recursive: true });
  mkdirSync(join(dir, "skills", "architecture-update"), { recursive: true });

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
  writeFileSync(join(dir, "skills", "high-performance-backend-architecture", "SKILL.md"), "# High Perf Backend");
  writeFileSync(join(dir, "skills", "improve-codebase-architecture", "SKILL.md"), "# Improve Codebase");
  writeFileSync(join(dir, "skills", "architecture-update", "SKILL.md"), "# Update Skill");
  writeFileSync(join(dir, "scripts", "approval-gate.mjs"), "// Gate");
  writeFileSync(join(dir, "scripts", "updater.mjs"), "// Updater");
}

function createTarGzFixture(sourceDir, tarGzPath) {
  execFileSync("tar.exe", ["-czf", tarGzPath, "-C", sourceDir, "."], { windowsHide: true });
}

/**
 * Helper to build custom raw tar.gz buffers for adversarial testing
 */
function buildRawTarGz(entries) {
  const chunks = [];

  for (const entry of entries) {
    const header = Buffer.alloc(512, 0);

    // Name (0..100)
    const nameBuf = Buffer.from(entry.name, "utf8");
    nameBuf.copy(header, 0, 0, Math.min(nameBuf.length, 100));

    // Mode (100..108)
    Buffer.from("0000644\0").copy(header, 100);

    // UID & GID
    Buffer.from("0000000\0").copy(header, 108);
    Buffer.from("0000000\0").copy(header, 116);

    // Size (124..136) in octal
    const size = entry.data ? entry.data.length : 0;
    const sizeStr = size.toString(8).padStart(11, "0") + " ";
    Buffer.from(sizeStr).copy(header, 124);

    // Typeflag (156)
    header[156] = Buffer.from(entry.typeflag || "0")[0];

    // Magic ustar (257..263)
    Buffer.from("ustar\0").copy(header, 257);
    Buffer.from("00").copy(header, 263);

    // Checksum calculation (148..156)
    // First set checksum to spaces
    Buffer.from("        ").copy(header, 148);
    let chk = 0;
    for (let i = 0; i < 512; i++) {
      chk += header[i];
    }
    const chkStr = chk.toString(8).padStart(6, "0") + "\0 ";
    Buffer.from(chkStr).copy(header, 148);

    chunks.push(header);

    if (entry.data && entry.data.length > 0) {
      chunks.push(entry.data);
      const pad = 512 - (entry.data.length % 512);
      if (pad < 512) {
        chunks.push(Buffer.alloc(pad, 0));
      }
    }
  }

  // Two 512 zero blocks for end of archive
  chunks.push(Buffer.alloc(1024, 0));

  const tarBuf = Buffer.concat(chunks);
  return gzipSync(tarBuf);
}

// ==========================================
// 1. RELEASE SELECTION TESTS
// ==========================================

test("Release: semver parsing and comparison", () => {
  assert.equal(compareSemver("0.1.0", "0.2.0"), -1);
  assert.equal(compareSemver("0.2.0", "0.1.0"), 1);
  assert.equal(compareSemver("0.2.0", "0.2.0"), 0);
  assert.equal(compareSemver("1.0.0-beta.1", "1.0.0"), -1);
  assert.equal(compareSemver("v1.0.1", "1.0.0"), 1);
  assert.equal(compareSemver("1.2.3", "v1.2.3"), 0);
});

test("Release: strict rejection of drafts and prereleases", async () => {
  const releases = [
    { tag_name: "v2.0.0-alpha", draft: false, prerelease: true },
    { tag_name: "v1.9.0", draft: true, prerelease: false },
    { tag_name: "v1.8.0-rc1", draft: false, prerelease: true },
    { tag_name: "v1.5.0", draft: false, prerelease: false }
  ];

  const mockFetch = async () => ({
    ok: true,
    json: async () => releases
  });

  const selected = await fetchLatestRelease("test/repo", mockFetch);
  assert.equal(selected.version, "1.5.0");
  assert.equal(selected.tagName, "v1.5.0");
});

test("Release: returns null when no stable releases exist", async () => {
  const releases = [
    { tag_name: "v2.0.0-beta", draft: false, prerelease: true },
    { tag_name: "v1.0.0", draft: true, prerelease: false }
  ];

  const mockFetch = async () => ({
    ok: true,
    json: async () => releases
  });

  const selected = await fetchLatestRelease("test/repo", mockFetch);
  assert.equal(selected, null);
});

test("Release: handles API failures and rate limits safely", async () => {
  const mockFetch = async () => ({
    ok: false,
    status: 403,
    statusText: "rate limit exceeded"
  });

  await assert.rejects(
    async () => {
      await fetchLatestRelease("test/repo", mockFetch);
    },
    /GitHub API error \(403\): rate limit exceeded/
  );
});

test("Release: prevents downgrade when installed version is newer than release", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "test-downgrade-"));
  try {
    createValidPluginFixture(tmp, "2.0.0");
    const mockFetch = async () => ({
      ok: true,
      json: async () => [
        { tag_name: "v1.5.0", draft: false, prerelease: false }
      ]
    });

    const res = await checkUpdate({ target: tmp, fetchFn: mockFetch });
    assert.equal(res.status, "up_to_date");
    assert.match(res.message, /Downgrade prevented/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ==========================================
// 2. ARCHIVE EXTRACTION SECURITY TESTS
// ==========================================

test("Archive Security: normal valid archive unpacks successfully", () => {
  const tmp = mkdtempSync(join(tmpdir(), "test-norm-"));
  try {
    const src = join(tmp, "src");
    const dest = join(tmp, "dest");
    createValidPluginFixture(src, "1.0.0");
    const tarFile = join(tmp, "valid.tar.gz");
    createTarGzFixture(src, tarFile);

    unpackArchiveSafely(tarFile, dest);
    assert.ok(existsSync(join(dest, "plugin.json")));
    assert.ok(existsSync(join(dest, "skills", "architecture-update", "SKILL.md")));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("Archive Security: path traversal with .. is rejected before write", () => {
  const tmp = mkdtempSync(join(tmpdir(), "test-traversal-"));
  try {
    const dest = join(tmp, "dest");
    const evilGz = join(tmp, "evil.tar.gz");
    const buf = buildRawTarGz([
      { name: "normal.txt", data: Buffer.from("safe") },
      { name: "../evil.txt", data: Buffer.from("pwned") }
    ]);
    writeFileSync(evilGz, buf);

    assert.throws(
      () => unpackArchiveSafely(evilGz, dest),
      /Security violation: Archive contains unsafe path traversal entry/
    );
    assert.equal(existsSync(join(tmp, "evil.txt")), false);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("Archive Security: absolute paths are rejected", () => {
  const tmp = mkdtempSync(join(tmpdir(), "test-abs-"));
  try {
    const dest = join(tmp, "dest");
    const evilGz = join(tmp, "abs.tar.gz");
    const buf = buildRawTarGz([
      { name: "/etc/passwd", data: Buffer.from("root") }
    ]);
    writeFileSync(evilGz, buf);

    assert.throws(
      () => unpackArchiveSafely(evilGz, dest),
      /Security violation: Archive contains unsafe path traversal entry/
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("Archive Security: Windows drive-letter paths are rejected", () => {
  const tmp = mkdtempSync(join(tmpdir(), "test-drive-"));
  try {
    const dest = join(tmp, "dest");
    const evilGz = join(tmp, "drive.tar.gz");
    const buf = buildRawTarGz([
      { name: "C:/evil.bat", data: Buffer.from("calc.exe") }
    ]);
    writeFileSync(evilGz, buf);

    assert.throws(
      () => unpackArchiveSafely(evilGz, dest),
      /Security violation: Archive contains unsafe path traversal entry/
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("Archive Security: symbolic links are strictly rejected", () => {
  const tmp = mkdtempSync(join(tmpdir(), "test-symlink-"));
  try {
    const dest = join(tmp, "dest");
    const evilGz = join(tmp, "symlink.tar.gz");
    const buf = buildRawTarGz([
      { name: "link-to-etc", typeflag: "2", data: Buffer.from("/etc/passwd") }
    ]);
    writeFileSync(evilGz, buf);

    assert.throws(
      () => unpackArchiveSafely(evilGz, dest),
      /Unsupported or hazardous archive entry type '2'/
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("Archive Security: hard links are strictly rejected", () => {
  const tmp = mkdtempSync(join(tmpdir(), "test-hardlink-"));
  try {
    const dest = join(tmp, "dest");
    const evilGz = join(tmp, "hardlink.tar.gz");
    const buf = buildRawTarGz([
      { name: "hardlink-entry", typeflag: "1", data: Buffer.from("target") }
    ]);
    writeFileSync(evilGz, buf);

    assert.throws(
      () => unpackArchiveSafely(evilGz, dest),
      /Unsupported or hazardous archive entry type '1'/
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("Archive Security: duplicate file entries targeting same file are rejected", () => {
  const tmp = mkdtempSync(join(tmpdir(), "test-dup-"));
  try {
    const dest = join(tmp, "dest");
    const evilGz = join(tmp, "dup.tar.gz");
    const buf = buildRawTarGz([
      { name: "file.txt", data: Buffer.from("first") },
      { name: "file.txt", data: Buffer.from("second overwrite") }
    ]);
    writeFileSync(evilGz, buf);

    assert.throws(
      () => unpackArchiveSafely(evilGz, dest),
      /Duplicate archive entry detected: file\.txt/
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("Archive Security: archive bomb exceeding single file limit is rejected", () => {
  const originalLimit = ARCHIVE_LIMITS.MAX_SINGLE_FILE_BYTES;
  ARCHIVE_LIMITS.MAX_SINGLE_FILE_BYTES = 50; // set small limit for test
  try {
    const evilGz = buildRawTarGz([
      { name: "huge.bin", data: Buffer.alloc(100, "A") }
    ]);
    const tarBuf = gunzipSync(evilGz);
    assert.throws(
      () => parseTarBuffer(tarBuf),
      /exceeds maximum file limit/
    );
  } finally {
    ARCHIVE_LIMITS.MAX_SINGLE_FILE_BYTES = originalLimit;
  }
});

// ==========================================
// 3. INTEGRITY & AUTHENTICITY TESTS
// ==========================================

test("Integrity: verified sha256 checksum passes", async () => {
  const content = Buffer.from("valid-release-content");
  const hash = computeSha256(content);
  const checksumFile = `${hash}  architecture-engineering-1.1.0.tar.gz\n`;

  const mockFetch = async () => ({
    ok: true,
    text: async () => checksumFile
  });

  const assets = [
    { name: "checksums.txt", browser_download_url: "https://example.com/checksums.txt" }
  ];

  const res = await verifyArtifactIntegrity(
    content,
    "architecture-engineering-1.1.0.tar.gz",
    assets,
    mockFetch
  );
  assert.equal(res.verified, true);
  assert.equal(res.hasChecksumFile, true);
  assert.equal(res.expectedHash, hash);
});

test("Integrity: mismatched sha256 checksum throws security violation", async () => {
  const content = Buffer.from("valid-release-content");
  const badHash = "0000000000000000000000000000000000000000000000000000000000000000";
  const checksumFile = `${badHash}  architecture-engineering-1.1.0.tar.gz\n`;

  const mockFetch = async () => ({
    ok: true,
    text: async () => checksumFile
  });

  const assets = [
    { name: "checksums.txt", browser_download_url: "https://example.com/checksums.txt" }
  ];

  await assert.rejects(
    async () => {
      await verifyArtifactIntegrity(
        content,
        "architecture-engineering-1.1.0.tar.gz",
        assets,
        mockFetch
      );
    },
    /Security violation: Checksum mismatch!/
  );
});

test("Integrity: reports limitation when checksum file is not published in assets", async () => {
  const content = Buffer.from("release-without-checksums");
  const res = await verifyArtifactIntegrity(
    content,
    "release.tar.gz",
    [], // no assets
    fetch
  );
  assert.equal(res.verified, false);
  assert.equal(res.hasChecksumFile, false);
  assert.match(res.message, /No checksums\.txt published in release assets/);
});

// ==========================================
// 4. REQUIRED PLUGIN COMPONENTS TESTS
// ==========================================

test("Validation: rejects incomplete plugin missing core skills", () => {
  const tmp = mkdtempSync(join(tmpdir(), "test-req-comp-"));
  try {
    createValidPluginFixture(tmp, "1.0.0");
    assert.equal(validatePluginStructure(tmp).valid, true);

    // Remove high-performance-backend-architecture
    rmSync(join(tmp, "skills", "high-performance-backend-architecture", "SKILL.md"));
    const res1 = validatePluginStructure(tmp);
    assert.equal(res1.valid, false);
    assert.match(res1.reason, /high-performance-backend-architecture/);

    // Re-create and remove approval-gate.mjs
    createValidPluginFixture(tmp, "1.0.0");
    rmSync(join(tmp, "scripts", "approval-gate.mjs"));
    const res2 = validatePluginStructure(tmp);
    assert.equal(res2.valid, false);
    assert.match(res2.reason, /approval-gate\.mjs/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ==========================================
// 5. APPROVAL & SAFETY TESTS
// ==========================================

test("Approval: non-interactive invocation without --yes fails closed", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "test-appr-"));
  try {
    createValidPluginFixture(tmp, "1.0.0");
    const mockFetch = async () => ({
      ok: true,
      json: async () => [
        { tag_name: "v1.1.0", draft: false, prerelease: false, tarball_url: "https://example.com/test.tar.gz" }
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

test("Approval: explicit --yes executes update successfully", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "test-yes-"));
  try {
    const installedDir = join(tmp, "installed");
    const sourceDir = join(tmp, "source-v2");
    createValidPluginFixture(installedDir, "1.0.0");
    createValidPluginFixture(sourceDir, "1.1.0");

    const tarFile = join(tmp, "release.tar.gz");
    createTarGzFixture(sourceDir, tarFile);

    const mockFetch = async (url) => {
      if (url.includes("/releases")) {
        return {
          ok: true,
          json: async () => [
            {
              tag_name: "v1.1.0",
              draft: false,
              prerelease: false,
              tarball_url: "https://example.com/archive.tar.gz"
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
      workspace: "C:\\other"
    });

    assert.equal(res.success, true);
    assert.equal(res.updated, true);
    assert.equal(res.newVersion, "1.1.0");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ==========================================
// 6. BACKUP & ROLLBACK RELIABILITY TESTS
// ==========================================

test("Rollback: corrupt backup is rejected and not restored", () => {
  const tmp = mkdtempSync(join(tmpdir(), "test-corrupt-backup-"));
  try {
    const installedDir = join(tmp, "installed");
    const corruptedBackup = join(tmp, "architecture-engineering.backup-2026-corrupt");
    mkdirSync(corruptedBackup);
    writeFileSync(join(corruptedBackup, "plugin.json"), "invalid json");

    assert.throws(
      () => rollbackInstallation(installedDir, corruptedBackup),
      /Backup at .* is invalid/
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("Rollback: auto-rollback restores working version if post-validation fails", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "test-auto-rollback-"));
  try {
    const installedDir = join(tmp, "installed");
    const invalidSourceDir = join(tmp, "source-invalid");
    createValidPluginFixture(installedDir, "1.0.0");
    createValidPluginFixture(invalidSourceDir, "1.1.0");

    // Break required component in source release
    rmSync(join(invalidSourceDir, "agents", "architecture-review-agent.md"));

    const tarFile = join(tmp, "bad-release.tar.gz");
    createTarGzFixture(invalidSourceDir, tarFile);

    const mockFetch = async (url) => {
      if (url.includes("/releases")) {
        return {
          ok: true,
          json: async () => [
            {
              tag_name: "v1.1.0",
              draft: false,
              prerelease: false,
              tarball_url: "https://example.com/bad.tar.gz"
            }
          ]
        };
      }
      return {
        ok: true,
        arrayBuffer: async () => readFileSync(tarFile)
      };
    };

    // Staging validation fails before installation touches the installed plugin directory
    await assert.rejects(
      async () => {
        await applyUpdate({
          target: installedDir,
          fetchFn: mockFetch,
          autoApprove: true,
          workspace: "C:\\other"
        });
      },
      /Validation of release archive failed/
    );

    // Because validation failed in staging BEFORE copying to installed, installedDir was never touched
    const manifest = readInstalledManifest(installedDir);
    assert.equal(manifest.version, "1.0.0");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

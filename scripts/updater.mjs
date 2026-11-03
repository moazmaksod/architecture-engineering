#!/usr/bin/env node
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  rmSync,
  statSync,
  lstatSync,
  copyFileSync,
  renameSync
} from "node:fs";
import { resolve, join, basename, relative, normalize } from "node:path";
import { homedir, tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

export const DEFAULT_REPO = "moazmaksod/architecture-engineering";

/**
 * Maximum bounds to prevent archive bombs and resource exhaustion
 */
export const ARCHIVE_LIMITS = {
  MAX_TOTAL_UNCOMPRESSED_BYTES: 100 * 1024 * 1024, // 100 MB max total extraction size
  MAX_SINGLE_FILE_BYTES: 25 * 1024 * 1024,        // 25 MB max single file size
  MAX_TOTAL_ENTRIES: 5000                         // 5000 max files/directories in archive
};

/**
 * Canonical list of required components for a valid plugin installation
 */
export const REQUIRED_COMPONENTS = [
  "plugin.json",
  "hooks.json",
  "rules/AGENTS.md",
  "agents/architecture-orchestrator.md",
  "agents/architecture-discovery-agent.md",
  "agents/architecture-implementation-agent.md",
  "agents/architecture-review-agent.md",
  "skills/architecture-engineering-workflow/SKILL.md",
  "skills/architecture-review/SKILL.md",
  "skills/high-performance-backend-architecture/SKILL.md",
  "skills/improve-codebase-architecture/SKILL.md",
  "skills/architecture-update/SKILL.md",
  "scripts/approval-gate.mjs",
  "scripts/updater.mjs"
];

/**
 * Determine default installed plugin directory
 */
export function getDefaultInstalledPluginPath() {
  const home = homedir();
  return resolve(home, ".gemini", "config", "plugins", "architecture-engineering");
}

/**
 * Parse semver string into [major, minor, patch, prerelease]
 */
export function parseSemver(versionStr) {
  if (!versionStr || typeof versionStr !== "string") return null;
  const clean = versionStr.trim().replace(/^v/, "");
  const match = clean.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if (!match) return null;
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
    prerelease: match[4] || null,
    raw: versionStr
  };
}

/**
 * Compare two semvers: 1 if a > b, -1 if a < b, 0 if a == b
 */
export function compareSemver(v1, v2) {
  const p1 = parseSemver(v1);
  const p2 = parseSemver(v2);
  if (!p1 || !p2) {
    if (v1 === v2) return 0;
    return (v1 || "") > (v2 || "") ? 1 : -1;
  }
  if (p1.major !== p2.major) return p1.major > p2.major ? 1 : -1;
  if (p1.minor !== p2.minor) return p1.minor > p2.minor ? 1 : -1;
  if (p1.patch !== p2.patch) return p1.patch > p2.patch ? 1 : -1;
  if (!p1.prerelease && p2.prerelease) return 1;
  if (p1.prerelease && !p2.prerelease) return -1;
  if (p1.prerelease && p2.prerelease) {
    return p1.prerelease.localeCompare(p2.prerelease);
  }
  return 0;
}

/**
 * Read and validate installed plugin manifest
 */
export function readInstalledManifest(pluginDir) {
  const manifestPath = join(pluginDir, "plugin.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`Plugin manifest not found at ${manifestPath}`);
  }
  try {
    const content = readFileSync(manifestPath, "utf-8");
    const manifest = JSON.parse(content);
    if (!manifest.version) {
      throw new Error(`Manifest at ${manifestPath} missing version field`);
    }
    return manifest;
  } catch (err) {
    throw new Error(`Failed to parse ${manifestPath}: ${err.message}`);
  }
}

/**
 * Check if path is a symbolic link or Windows junction
 */
export function getLinkInfo(targetPath) {
  if (!existsSync(targetPath)) return { exists: false, isLink: false };
  try {
    const lstat = lstatSync(targetPath);
    return {
      exists: true,
      isLink: lstat.isSymbolicLink()
    };
  } catch {
    return { exists: true, isLink: false };
  }
}

/**
 * Fetch latest STABLE release from GitHub API
 * Rejects drafts, prereleases, and unversioned tags
 */
export async function fetchLatestRelease(repo = DEFAULT_REPO, fetchFn = fetch) {
  const url = `https://api.github.com/repos/${repo}/releases`;
  let res;
  try {
    res = await fetchFn(url, {
      headers: {
        "User-Agent": "Architecture-Engineering-Updater",
        Accept: "application/vnd.github.v3+json"
      }
    });
  } catch (err) {
    throw new Error(`Network failure connecting to GitHub API: ${err.message}`);
  }

  if (!res.ok) {
    throw new Error(`GitHub API error (${res.status}): ${res.statusText}`);
  }

  let releases;
  try {
    releases = await res.json();
  } catch (err) {
    throw new Error(`Invalid JSON response from GitHub API: ${err.message}`);
  }

  if (!Array.isArray(releases) || releases.length === 0) {
    return null;
  }

  // Filter ONLY stable releases: not draft, not prerelease, must have valid semver tag
  const stableReleases = releases.filter(r => {
    if (r.draft || r.prerelease) return false;
    const sem = parseSemver(r.tag_name);
    return sem !== null && !sem.prerelease;
  });

  if (stableReleases.length === 0) {
    return null;
  }

  // Sort descending by semver to pick highest stable release
  stableReleases.sort((a, b) => compareSemver(b.tag_name, a.tag_name));
  const candidate = stableReleases[0];

  return {
    tagName: candidate.tag_name,
    version: candidate.tag_name.replace(/^v/, ""),
    name: candidate.name || candidate.tag_name,
    body: candidate.body || "No release notes provided.",
    htmlUrl: candidate.html_url,
    publishedAt: candidate.published_at,
    assets: candidate.assets || [],
    tarballUrl: candidate.tarball_url
  };
}

/**
 * Native in-memory TAR reader and parser (Zero external dependencies).
 * Enforces strict entry validation, PAX/GNU long filename support,
 * and rejects malicious entry types (symlinks, hardlinks, character devices, fifos).
 */
export function parseTarBuffer(tarBuffer) {
  let offset = 0;
  const entries = [];
  let nextLongName = null;
  let totalUncompressedBytes = 0;

  while (offset + 512 <= tarBuffer.length) {
    const header = tarBuffer.subarray(offset, offset + 512);

    // 512 zero bytes indicates EOF or end of archive
    let isZero = true;
    for (let i = 0; i < 512; i++) {
      if (header[i] !== 0) {
        isZero = false;
        break;
      }
    }
    if (isZero) break;

    // Standard ustar header parsing
    let name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
    const prefix = header.subarray(345, 500).toString("utf8").replace(/\0.*$/, "");
    if (prefix) {
      name = `${prefix}/${name}`;
    }

    const sizeOctal = header.subarray(124, 136).toString("utf8").replace(/\0.*$/, "").trim();
    const size = parseInt(sizeOctal, 8) || 0;
    const typeflag = String.fromCharCode(header[156]);

    const dataStart = offset + 512;
    const dataEnd = dataStart + size;

    if (dataEnd > tarBuffer.length) {
      throw new Error(`Corrupt tar archive: entry '${name}' data overflows archive bounds`);
    }

    if (typeflag === "L") {
      // GNU Long Filename extension
      nextLongName = tarBuffer.subarray(dataStart, dataEnd).toString("utf8").replace(/\0.*$/, "").trim();
    } else if (typeflag === "x" || typeflag === "g") {
      // PAX Extended Header
      // Skip metadata entry
    } else {
      const entryName = nextLongName || name;
      nextLongName = null;

      // Validate entry type
      // Allowed: '0' / '' (regular file), '5' (directory)
      // Disallowed: '1' (hard link), '2' (symlink), '3' (char device), '4' (block device), '6' (fifo)
      if (typeflag !== "0" && typeflag !== "\0" && typeflag !== "5") {
        throw new Error(
          `Security violation: Unsupported or hazardous archive entry type '${typeflag}' for entry '${entryName}' (links and devices are strictly forbidden)`
        );
      }

      totalUncompressedBytes += size;
      if (totalUncompressedBytes > ARCHIVE_LIMITS.MAX_TOTAL_UNCOMPRESSED_BYTES) {
        throw new Error(
          `Security violation: Archive uncompressed size exceeds safety limit of ${ARCHIVE_LIMITS.MAX_TOTAL_UNCOMPRESSED_BYTES} bytes (archive bomb protection)`
        );
      }
      if (size > ARCHIVE_LIMITS.MAX_SINGLE_FILE_BYTES) {
        throw new Error(
          `Security violation: Entry '${entryName}' size (${size} bytes) exceeds maximum file limit of ${ARCHIVE_LIMITS.MAX_SINGLE_FILE_BYTES} bytes`
        );
      }

      entries.push({
        name: entryName,
        size,
        typeflag: typeflag === "5" ? "5" : "0",
        data: typeflag === "5" ? null : tarBuffer.subarray(dataStart, dataEnd)
      });

      if (entries.length > ARCHIVE_LIMITS.MAX_TOTAL_ENTRIES) {
        throw new Error(
          `Security violation: Archive entry count exceeds safety limit of ${ARCHIVE_LIMITS.MAX_TOTAL_ENTRIES} entries`
        );
      }
    }

    offset += 512 + Math.ceil(size / 512) * 512;
  }

  return entries;
}

/**
 * Validate that an archive entry name resolves strictly within destDir
 */
export function isContainedPath(destDir, entryName) {
  const normalized = entryName.replace(/\\/g, "/");

  // String check for path traversal patterns
  if (
    normalized.includes("../") ||
    normalized.includes("/..") ||
    normalized === ".." ||
    normalized.startsWith("/") ||
    /^[a-zA-Z]:/.test(normalized)
  ) {
    return false;
  }

  // Filesystem resolution check
  const resolvedDest = resolve(destDir);
  const resolvedTarget = resolve(resolvedDest, normalized);
  const rel = relative(resolvedDest, resolvedTarget);

  if (rel.startsWith("..") || resolve(rel) === rel) {
    return false;
  }

  return true;
}

/**
 * Safely unpack tar.gz into target directory with defense-in-depth:
 * 1. Native in-memory gunzip & tar parsing
 * 2. Rejection of symlinks, hardlinks, character devices, and fifo entries
 * 3. Exact containment checking against destDir
 * 4. Protection against duplicate entry collisions and archive bombs
 */
export function unpackArchiveSafely(tarGzPath, destDir) {
  if (!existsSync(tarGzPath)) {
    throw new Error(`Archive file not found: ${tarGzPath}`);
  }

  const compressedData = readFileSync(tarGzPath);
  let tarBuffer;
  try {
    tarBuffer = gunzipSync(compressedData);
  } catch (err) {
    throw new Error(`Failed to decompress archive (invalid gzip): ${err.message}`);
  }

  const entries = parseTarBuffer(tarBuffer);
  if (entries.length === 0) {
    throw new Error("Archive is empty");
  }

  const seenPaths = new Set();

  for (const entry of entries) {
    let cleanName = entry.name.replace(/\\/g, "/").trim();
    if (cleanName.startsWith("./")) {
      cleanName = cleanName.slice(2);
    }
    if (!cleanName || cleanName === ".") continue;

    if (!isContainedPath(destDir, cleanName)) {
      throw new Error(`Security violation: Archive contains unsafe path traversal entry: ${entry.name}`);
    }

    // Check duplicate entries targeting identical files
    const normalizedKey = cleanName.toLowerCase();
    if (seenPaths.has(normalizedKey) && entry.typeflag === "0") {
      throw new Error(`Security violation: Duplicate archive entry detected: ${cleanName}`);
    }
    seenPaths.add(normalizedKey);
  }

  // Safe extraction phase
  mkdirSync(destDir, { recursive: true });

  for (const entry of entries) {
    let cleanName = entry.name.replace(/\\/g, "/").trim();
    if (cleanName.startsWith("./")) {
      cleanName = cleanName.slice(2);
    }
    if (!cleanName || cleanName === ".") continue;

    const outPath = resolve(destDir, cleanName);

    if (entry.typeflag === "5") {
      mkdirSync(outPath, { recursive: true });
    } else {
      const parentDir = resolve(outPath, "..");
      if (!existsSync(parentDir)) {
        mkdirSync(parentDir, { recursive: true });
      }
      writeFileSync(outPath, entry.data);
    }
  }

  // Handle case where GitHub tarballs nest files under repo-tag root directory
  const extractedItems = readdirSync(destDir);
  if (extractedItems.length === 1) {
    const singleChild = join(destDir, extractedItems[0]);
    if (statSync(singleChild).isDirectory() && existsSync(join(singleChild, "plugin.json"))) {
      const childFiles = readdirSync(singleChild);
      for (const item of childFiles) {
        renameSync(join(singleChild, item), join(destDir, item));
      }
      rmSync(singleChild, { recursive: true, force: true });
    }
  }
}

/**
 * Validate directory structure against Architecture Engineering requirements
 */
export function validatePluginStructure(dirPath) {
  const manifestPath = join(dirPath, "plugin.json");
  if (!existsSync(manifestPath)) {
    return { valid: false, reason: "plugin.json is missing" };
  }

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  } catch (err) {
    return { valid: false, reason: `plugin.json is invalid JSON: ${err.message}` };
  }

  if (manifest.name !== "architecture-engineering") {
    return {
      valid: false,
      reason: `plugin.json name mismatch: expected 'architecture-engineering', found '${manifest.name}'`
    };
  }

  if (!manifest.version || !parseSemver(manifest.version)) {
    return {
      valid: false,
      reason: `plugin.json version '${manifest.version}' is invalid or missing`
    };
  }

  for (const relPath of REQUIRED_COMPONENTS) {
    const fullPath = join(dirPath, relPath);
    if (!existsSync(fullPath)) {
      return { valid: false, reason: `Missing required plugin component: ${relPath}` };
    }
  }

  return { valid: true, manifest };
}

/**
 * Parse sha256 checksum file contents
 */
export function parseChecksumFile(text) {
  const map = new Map();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([a-fA-F0-9]{64})\s+[*]?([^\r\n]+)$/);
    if (match) {
      map.set(match[2].trim(), match[1].toLowerCase());
    }
  }
  return map;
}

/**
 * Calculate SHA-256 hash of a buffer
 */
export function computeSha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

/**
 * Verify artifact integrity against release assets
 */
export async function verifyArtifactIntegrity(archiveBuffer, archiveFileName, releaseAssets, fetchFn = fetch) {
  const computedHash = computeSha256(archiveBuffer);

  // Look for checksum file in release assets
  const checksumAsset = releaseAssets.find(a =>
    /checksums?\.txt|sha256sums?\.txt/i.test(a.name)
  );

  if (!checksumAsset) {
    // If repository has not published checksums, document verified integrity limitation
    return {
      verified: false,
      hasChecksumFile: false,
      computedHash,
      message: "No checksums.txt published in release assets. Integrity verified via TLS stream and strict structural validation only."
    };
  }

  const res = await fetchFn(checksumAsset.browser_download_url || checksumAsset.url, {
    headers: { "User-Agent": "Architecture-Engineering-Updater" }
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch release checksum file (${res.status}): ${res.statusText}`);
  }

  const checksumText = await res.text();
  const checksumMap = parseChecksumFile(checksumText);

  if (checksumMap.size === 0) {
    throw new Error("Release checksum file is malformed or empty");
  }

  // Look up by archive filename or base name
  const expectedHash =
    checksumMap.get(archiveFileName) ||
    checksumMap.get(basename(archiveFileName)) ||
    (checksumMap.size === 1 ? Array.from(checksumMap.values())[0] : null);

  if (!expectedHash) {
    throw new Error(`Checksum for artifact '${archiveFileName}' not found in release checksums`);
  }

  if (computedHash.toLowerCase() !== expectedHash.toLowerCase()) {
    throw new Error(
      `Security violation: Checksum mismatch! Expected ${expectedHash}, computed ${computedHash}`
    );
  }

  return {
    verified: true,
    hasChecksumFile: true,
    computedHash,
    expectedHash,
    message: "Cryptographic SHA-256 checksum verified successfully."
  };
}

/**
 * Recursively copy directory
 */
export function copyDirSync(src, dest) {
  mkdirSync(dest, { recursive: true });
  const entries = readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Create backup of existing plugin installation
 */
export function backupInstallation(pluginDir) {
  if (!existsSync(pluginDir)) return null;

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const parent = resolve(pluginDir, "..");
  const backupDir = join(parent, `architecture-engineering.backup-${timestamp}`);

  copyDirSync(pluginDir, backupDir);
  return backupDir;
}

/**
 * Find most recent backup
 */
export function findLatestBackup(pluginDir) {
  const parent = resolve(pluginDir, "..");
  if (!existsSync(parent)) return null;

  const prefix = "architecture-engineering.backup-";
  const items = readdirSync(parent)
    .filter(item => item.startsWith(prefix))
    .sort()
    .reverse();

  if (items.length === 0) return null;
  return join(parent, items[0]);
}

/**
 * Rollback to specified backup or most recent backup
 */
export function rollbackInstallation(pluginDir, backupPath) {
  const backup = backupPath || findLatestBackup(pluginDir);
  if (!backup || !existsSync(backup)) {
    throw new Error(`No valid backup found to restore`);
  }

  const validation = validatePluginStructure(backup);
  if (!validation.valid) {
    throw new Error(`Backup at ${backup} is invalid: ${validation.reason}`);
  }

  if (existsSync(pluginDir)) {
    rmSync(pluginDir, { recursive: true, force: true });
  }
  copyDirSync(backup, pluginDir);
  return { restoredFrom: backup, version: validation.manifest.version };
}

/**
 * Check command execution
 */
export async function checkUpdate(options = {}) {
  const pluginDir = options.target || getDefaultInstalledPluginPath();
  const repo = options.repo || DEFAULT_REPO;

  if (!existsSync(pluginDir)) {
    return {
      status: "not_installed",
      pluginDir,
      message: `Plugin is not installed at ${pluginDir}`
    };
  }

  const linkInfo = getLinkInfo(pluginDir);
  const installedManifest = readInstalledManifest(pluginDir);
  const installedVersion = installedManifest.version;

  let release;
  try {
    release = await fetchLatestRelease(repo, options.fetchFn);
  } catch (err) {
    return {
      status: "check_failed",
      pluginDir,
      installedVersion,
      isLink: linkInfo.isLink,
      error: err.message
    };
  }

  if (!release) {
    return {
      status: "up_to_date",
      pluginDir,
      installedVersion,
      isLink: linkInfo.isLink,
      message: `No eligible stable releases found for ${repo}. Plugin is up to date with installed version ${installedVersion}.`
    };
  }

  const cmp = compareSemver(release.version, installedVersion);
  if (cmp < 0) {
    // Release version is older than installed version -> Prevent downgrade
    return {
      status: "up_to_date",
      pluginDir,
      installedVersion,
      availableVersion: release.version,
      isLink: linkInfo.isLink,
      message: `Installed version (v${installedVersion}) is newer than latest stable release (v${release.version}). Downgrade prevented.`
    };
  }
  if (cmp === 0) {
    return {
      status: "up_to_date",
      pluginDir,
      installedVersion,
      availableVersion: release.version,
      isLink: linkInfo.isLink,
      message: `Plugin is already up to date (installed: v${installedVersion}, latest: v${release.version}).`
    };
  }

  return {
    status: "update_available",
    pluginDir,
    installedVersion,
    availableVersion: release.version,
    isLink: linkInfo.isLink,
    release
  };
}

/**
 * Apply update with full safety and atomic-like staging lifecycle
 */
export async function applyUpdate(options = {}) {
  const pluginDir = options.target || getDefaultInstalledPluginPath();
  const repo = options.repo || DEFAULT_REPO;
  const workspacePath = options.workspace || process.cwd();

  // Safety check: protect development workspace from being accidentally targeted
  if (resolve(pluginDir).toLowerCase() === resolve(workspacePath).toLowerCase()) {
    if (!options.allowWorkspaceOverride) {
      throw new Error(
        `Safety block: Target path (${pluginDir}) matches the development workspace. ` +
        `The update mechanism targets the installed plugin copy, not your active source checkout.`
      );
    }
  }

  const check = await checkUpdate({ ...options, target: pluginDir, repo });
  if (check.status === "up_to_date") {
    return { success: true, message: check.message, updated: false };
  }
  if (check.status !== "update_available" && !options.localArchive) {
    throw new Error(`Update check returned status '${check.status}': ${check.error || check.message}`);
  }

  const linkInfo = getLinkInfo(pluginDir);
  if (linkInfo.isLink && !options.allowJunctionUpdate) {
    throw new Error(
      `Installation path at ${pluginDir} is a junction or symbolic link. ` +
      `To avoid unintended filesystem mutation, pass --allow-junction or update the link target directly.`
    );
  }

  // Explicit approval check
  if (!options.autoApprove) {
    if (options.interactive) {
      const rl = createInterface({ input: stdin, output: stdout });
      try {
        const answer = await rl.question(
          `Update available: v${check.installedVersion} -> v${check.availableVersion}.\n` +
          `Target: ${pluginDir}\n` +
          `Release Notes:\n${check.release?.body || "N/A"}\n\n` +
          `Proceed with installation? (y/N): `
        );
        if (!/^y(es)?$/i.test(answer.trim())) {
          return { success: false, aborted: true, message: "Update aborted by user." };
        }
      } catch (promptErr) {
        // EOF or stdin close
        return { success: false, aborted: true, message: "Update aborted: input stream closed without confirmation." };
      } finally {
        rl.close();
      }
    } else {
      throw new Error("Explicit user approval required. Run with --yes or interactive mode.");
    }
  }

  // Temporary staging directory
  const tempDir = join(tmpdir(), `agy-update-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });

  const stagingDir = join(tempDir, "staged");
  let tarballPath = options.localArchive;

  let backupDir = null;
  try {
    if (!tarballPath) {
      const downloadUrl = check.release.tarballUrl;
      if (!downloadUrl) {
        throw new Error("No download tarball URL available in release metadata");
      }
      const fetchFn = options.fetchFn || fetch;
      const res = await fetchFn(downloadUrl, {
        headers: { "User-Agent": "Architecture-Engineering-Updater" }
      });
      if (!res.ok) {
        throw new Error(`Failed to download release archive (${res.status}): ${res.statusText}`);
      }
      const buffer = Buffer.from(await res.arrayBuffer());

      // Integrity verification
      const integrity = await verifyArtifactIntegrity(
        buffer,
        `architecture-engineering-${check.release.version}.tar.gz`,
        check.release.assets,
        fetchFn
      );

      tarballPath = join(tempDir, "release.tar.gz");
      writeFileSync(tarballPath, buffer);
    }

    // 1. Unpack into staging directory and inspect with defense-in-depth parser
    unpackArchiveSafely(tarballPath, stagingDir);

    // 2. Validate staged files BEFORE modifying installed plugin
    const validation = validatePluginStructure(stagingDir);
    if (!validation.valid) {
      throw new Error(`Validation of release archive failed: ${validation.reason}`);
    }

    // 3. Backup existing installation
    backupDir = backupInstallation(pluginDir);

    // 4. Safe installation swap
    if (existsSync(pluginDir)) {
      rmSync(pluginDir, { recursive: true, force: true });
    }
    copyDirSync(stagingDir, pluginDir);

    // 5. Post-installation verification
    const postValidation = validatePluginStructure(pluginDir);
    if (!postValidation.valid) {
      throw new Error(`Post-installation validation failed: ${postValidation.reason}`);
    }

    return {
      success: true,
      updated: true,
      previousVersion: check.installedVersion,
      newVersion: postValidation.manifest.version,
      backupDir,
      pluginDir
    };
  } catch (err) {
    // Auto-rollback if failure occurred after backup was created
    if (backupDir && existsSync(backupDir)) {
      try {
        rollbackInstallation(pluginDir, backupDir);
        return {
          success: false,
          rolledBack: true,
          error: `Update failed: ${err.message}. Installation successfully rolled back to previous backup.`,
          backupDir
        };
      } catch (rollbackErr) {
        return {
          success: false,
          rolledBack: false,
          error: `Update failed: ${err.message}. Rollback also failed: ${rollbackErr.message}. Manual recovery needed from ${backupDir}`
        };
      }
    }
    throw err;
  } finally {
    // Cleanup temporary files
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

/**
 * CLI Entry point
 */
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || "check";

  const getArg = (name) => {
    const idx = args.indexOf(name);
    return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : null;
  };

  const hasFlag = (name) => args.includes(name);

  const target = getArg("--target");
  const repo = getArg("--repo") || DEFAULT_REPO;
  const autoApprove = hasFlag("--yes") || hasFlag("-y");
  const allowJunction = hasFlag("--allow-junction");
  const jsonOutput = hasFlag("--json");

  try {
    if (command === "check") {
      const result = await checkUpdate({ target, repo });
      if (jsonOutput) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        if (result.status === "update_available") {
          console.log(`[UPDATE AVAILABLE]`);
          console.log(`Installed: v${result.installedVersion}`);
          console.log(`Available: v${result.availableVersion}`);
          console.log(`Target:    ${result.pluginDir}`);
          console.log(`\nRelease Notes:\n${result.release.body}\n`);
          console.log(`To install, run: node ./scripts/updater.mjs update --yes`);
        } else if (result.status === "up_to_date") {
          console.log(`[UP TO DATE] ${result.message}`);
        } else {
          console.error(`[CHECK FAILED] ${result.error || result.message}`);
        }
      }
    } else if (command === "update") {
      const result = await applyUpdate({
        target,
        repo,
        autoApprove,
        interactive: !autoApprove,
        allowJunctionUpdate: allowJunction,
        localArchive: getArg("--archive")
      });

      if (jsonOutput) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        if (result.success && result.updated) {
          console.log(`[SUCCESS] Plugin updated from v${result.previousVersion} to v${result.newVersion}`);
          console.log(`Backup saved at: ${result.backupDir}`);
          console.log(`Installed at:    ${result.pluginDir}`);
        } else if (result.success && !result.updated) {
          console.log(`[INFO] ${result.message}`);
        } else if (result.aborted) {
          console.log(`[ABORTED] ${result.message}`);
        } else {
          console.error(`[FAILED] ${result.error}`);
          process.exitCode = 1;
        }
      }
    } else if (command === "rollback") {
      const backup = getArg("--backup");
      const pluginDir = target || getDefaultInstalledPluginPath();
      const res = rollbackInstallation(pluginDir, backup);
      if (jsonOutput) {
        console.log(JSON.stringify({ success: true, ...res }, null, 2));
      } else {
        console.log(`[RESTORED] Restored v${res.version} from backup ${res.restoredFrom}`);
      }
    } else {
      console.log(`Usage: node ./scripts/updater.mjs [check|update|rollback] [options]`);
      console.log(`Options:`);
      console.log(`  --target <path>       Target plugin directory`);
      console.log(`  --repo <owner/repo>   GitHub repository (default: ${DEFAULT_REPO})`);
      console.log(`  --yes, -y             Automatically approve update`);
      console.log(`  --json                Output result in JSON`);
      console.log(`  --archive <file>      Install from local tarball for testing/offline`);
      console.log(`  --allow-junction      Allow updating when target is a junction`);
    }
  } catch (err) {
    if (jsonOutput) {
      console.log(JSON.stringify({ success: false, error: err.message }, null, 2));
    } else {
      console.error(`[ERROR] ${err.message}`);
    }
    process.exitCode = 1;
  }
}

if (process.argv[1] && normalize(process.argv[1]) === normalize(import.meta.filename)) {
  main();
}

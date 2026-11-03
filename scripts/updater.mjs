#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, statSync, lstatSync, copyFileSync, renameSync } from "node:fs";
import { resolve, join, basename, relative, normalize } from "node:path";
import { homedir, tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

export const DEFAULT_REPO = "moazmaksod/architecture-engineering";
export const REQUIRED_COMPONENTS = [
  "plugin.json",
  "hooks.json",
  "rules/AGENTS.md",
  "agents/architecture-orchestrator.md",
  "agents/architecture-discovery-agent.md",
  "agents/architecture-implementation-agent.md",
  "agents/architecture-review-agent.md",
  "skills/architecture-engineering-workflow/SKILL.md",
  "skills/architecture-review/SKILL.md"
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
 * Fetch latest release from GitHub API
 */
export async function fetchLatestRelease(repo = DEFAULT_REPO, fetchFn = fetch) {
  const url = `https://api.github.com/repos/${repo}/releases`;
  const res = await fetchFn(url, {
    headers: {
      "User-Agent": "Architecture-Engineering-Updater",
      Accept: "application/vnd.github.v3+json"
    }
  });

  if (!res.ok) {
    throw new Error(`GitHub API error (${res.status}): ${res.statusText}`);
  }

  const releases = await res.json();
  if (!Array.isArray(releases) || releases.length === 0) {
    return null;
  }

  // Filter stable releases (not draft, not prerelease unless no other)
  const stableReleases = releases.filter(r => !r.draft && !r.prerelease);
  const candidate = stableReleases.length > 0 ? stableReleases[0] : releases.find(r => !r.draft);

  if (!candidate) return null;

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
 * Validate archive members before extraction to prevent zip slip or malicious paths
 */
export function validateArchiveListing(tarFilePath) {
  let listingOutput;
  try {
    listingOutput = execFileSync("tar.exe", ["-tzf", tarFilePath], {
      encoding: "utf-8",
      windowsHide: true
    });
  } catch (err) {
    throw new Error(`Failed to inspect archive (corrupt or invalid tar.gz): ${err.message}`);
  }

  const lines = listingOutput.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) {
    throw new Error("Archive is empty");
  }

  for (const entry of lines) {
    // Check for directory traversal sequences
    if (entry.includes("..") || entry.startsWith("/") || entry.startsWith("\\") || /^[A-Za-z]:/.test(entry)) {
      throw new Error(`Security violation: Archive contains unsafe path traversal entry: ${entry}`);
    }
  }

  return lines;
}

/**
 * Safely unpack tar.gz into target directory
 */
export function unpackArchiveSafely(tarFilePath, destDir) {
  validateArchiveListing(tarFilePath);

  if (!existsSync(destDir)) {
    mkdirSync(destDir, { recursive: true });
  }

  try {
    execFileSync("tar.exe", ["-xzf", tarFilePath, "-C", destDir], {
      windowsHide: true
    });
  } catch (err) {
    throw new Error(`Failed to unpack archive: ${err.message}`);
  }

  // Handle case where GitHub tarballs nest files under repo-tag directory
  const extractedItems = readdirSync(destDir);
  if (extractedItems.length === 1) {
    const singleChild = join(destDir, extractedItems[0]);
    if (statSync(singleChild).isDirectory() && existsSync(join(singleChild, "plugin.json"))) {
      // Flatten directory
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

  for (const relPath of REQUIRED_COMPONENTS) {
    const fullPath = join(dirPath, relPath);
    if (!existsSync(fullPath)) {
      return { valid: false, reason: `Missing required plugin component: ${relPath}` };
    }
  }

  return { valid: true, manifest };
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

  // Remove existing and restore
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
      message: `No public releases found for ${repo}. Plugin is up to date with installed version ${installedVersion}.`
    };
  }

  const cmp = compareSemver(release.version, installedVersion);
  if (cmp <= 0) {
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
 * Apply update with full safety lifecycle
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
        `The update mechanism targets the installed plugin copy, not your active source code checkout.`
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

  // User approval check
  if (!options.autoApprove) {
    if (options.interactive) {
      const rl = createInterface({ input: stdin, output: stdout });
      const answer = await rl.question(
        `Update available: v${check.installedVersion} -> v${check.availableVersion}.\n` +
        `Target: ${pluginDir}\n` +
        `Release Notes:\n${check.release?.body || "N/A"}\n\n` +
        `Proceed with installation? (y/N): `
      );
      rl.close();
      if (!/^y(es)?$/i.test(answer.trim())) {
        return { success: false, aborted: true, message: "Update aborted by user." };
      }
    } else {
      throw new Error("Explicit user approval required. Run with --yes or interactive mode.");
    }
  }

  // Download or use local archive
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
      tarballPath = join(tempDir, "release.tar.gz");
      writeFileSync(tarballPath, buffer);
    }

    // 1. Unpack into staging directory and inspect
    unpackArchiveSafely(tarballPath, stagingDir);

    // 2. Validate staged files BEFORE modifying installed plugin
    const validation = validatePluginStructure(stagingDir);
    if (!validation.valid) {
      throw new Error(`Validation of release archive failed: ${validation.reason}`);
    }

    // 3. Backup existing installation
    backupDir = backupInstallation(pluginDir);

    // 4. Install files
    // If physical directory exists, replace contents safely
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
    // Attempt rollback if backup exists and failure occurred after backup
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
    // Cleanup temp files
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


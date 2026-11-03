---
name: architecture-update
description: Check for and install updates for the Architecture Engineering plugin directly from official GitHub releases. Supports /architecture-update and /architecture-check-update.
---

# Architecture Engineering — Self-Update Skill

Use this skill when the user asks to check for or apply updates to the Architecture Engineering plugin, or invokes `/architecture-update` or `/architecture-check-update`.

## Commands

### 1. Check for Updates (`/architecture-check-update`)
Check whether a new official GitHub release exists without modifying any files on disk:

```powershell
node ./scripts/updater.mjs check
```

Or get machine-readable output:
```powershell
node ./scripts/updater.mjs check --json
```

### 2. Apply Approved Update (`/architecture-update`)
When an update is found and the user explicitly approves applying it:

```powershell
node ./scripts/updater.mjs update --yes
```

To update a specific plugin directory or check against a different repo:
```powershell
node ./scripts/updater.mjs update --target "<installed_plugin_path>" --yes
```

### 3. Restore / Rollback
If a previous update needs to be reverted to the last saved backup:
```powershell
node ./scripts/updater.mjs rollback
```

## Security & Safety Guarantees

1. **User Control**: Never updates silently. The user is presented with the installed version, available version, and release notes before applying changes.
2. **Safety Staging**: Downloaded release archives are validated against path traversal (`zip-slip`) and extracted into an isolated temporary folder before touching the installed plugin.
3. **Automatic Backup & Rollback**: A timestamped backup (`architecture-engineering.backup-<timestamp>`) is created immediately before replacing files. If post-install validation detects missing components or an invalid manifest, rollback is triggered automatically.
4. **Workspace Protection**: The updater detects if the target matches the development workspace and blocks execution to protect active source checkouts.
5. **Junction & Symlink Detection**: The updater inspects filesystem link attributes and avoids destructive file operations on junctions.


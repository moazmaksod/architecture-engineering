import { stdin, stdout } from "node:process";

let input = "";
for await (const chunk of stdin) {
  input += chunk;
}

// Fail-closed helper: prompt user explicitly when safety invariants are triggered
function forceAsk(reason) {
  stdout.write(
    JSON.stringify({
      decision: "force_ask",
      reason: `Architecture Engineering safety guard: ${reason}`,
    }) + "\n"
  );
  process.exit(0);
}

// Routine tool actions permitted
function allow() {
  stdout.write(
    JSON.stringify({
      decision: "allow",
    }) + "\n"
  );
  process.exit(0);
}

// 1. Ingest input stream — fail closed on empty or missing payload
if (!input || !input.trim()) {
  forceAsk("empty or missing payload requires explicit confirmation.");
}

let event;
try {
  event = JSON.parse(input);
} catch {
  forceAsk("malformed or unparseable JSON payload requires explicit confirmation.");
}

const toolName =
  event.toolCall?.name ??
  event.tool_name ??
  event.toolName ??
  event.tool?.name ??
  event.name ??
  "";

if (!toolName) {
  forceAsk("unidentified tool call without name requires explicit confirmation.");
}

const args = event.toolCall?.args ?? event.args ?? {};
const commandLine =
  args.CommandLine ??
  args.commandLine ??
  args.command ??
  args.cmd ??
  args.script ??
  "";
const filePath =
  args.Path ??
  args.path ??
  args.filePath ??
  args.file_path ??
  args.file ??
  "";

// Helper: recognize harmless text search, inspect, or log commands (not execution)
function isSearchOrInspect(cmd) {
  return /^\s*(?:grep|rg|ripgrep|cat|type|echo|findstr|head|tail|git\s+(?:log|show))\b/i.test(cmd);
}

// 2. Destructive Git command evaluator (accounts for global options and binary extensions)
function isDestructiveGit(cmd) {
  const gitMatch = cmd.match(/\bgit(?:\.exe)?\s+(.*)/i);
  if (!gitMatch) return false;
  const rest = gitMatch[1].trim();

  // Harmless read-only inspection commands
  if (/^stash\s+(?:list|show)\b/i.test(rest)) return false;
  if (/^clean\s+.*-(?:n\b|-dry-run\b)/i.test(rest)) return false;
  if (/^merge-base\b/i.test(rest)) return false;

  // Intercept destructive subcommands (even with global flags like -C, -c, --no-pager preceding them)
  if (/\b(commit|push|merge|rebase|reset|stash|clean)\b/i.test(rest)) return true;
  if (/\bbranch\s+.*(?:-[dD]|--delete)\b/i.test(rest)) return true;
  if (/\b(?:checkout|switch)\s+.*(?:-[fF]|--force)\b/i.test(rest)) return true;

  return false;
}

// 3. Destructive Database commands
function isDestructiveDb(cmd) {
  if (isSearchOrInspect(cmd)) return false;
  return /\b(drop\s+(database|table|schema)|truncate\s+(table\s+)?|prisma\s+migrate\s+(deploy|reset)|alembic\s+upgrade|dotnet\s+ef\s+database\s+update)\b/i.test(cmd);
}

// 4. Destructive Filesystem / System commands
function isDestructiveSys(cmd) {
  if (isSearchOrInspect(cmd)) return false;

  // Format disk/drive (corrected boundary matching on non-word colon)
  if (/\bformat\s+[a-zA-Z]:(?:\s|$)/i.test(cmd)) return true;

  // Windows cmd: del /s, rd /s, rmdir /s
  if (/\b(?:del|erase)\s+.*\/[sS]\b/i.test(cmd)) return true;
  if (/\b(?:rd|rmdir)\s+.*\/[sS]\b/i.test(cmd)) return true;

  // POSIX rm: any combination of -r and -f (e.g. -rf, -fr, -r -f, -f -r)
  if (/\brm\s+.*-(?:[a-zA-Z]*r[a-zA-Z]*f|[a-zA-Z]*f[a-zA-Z]*r)\b/i.test(cmd)) return true;
  if (/\brm\s+.*-[a-zA-Z]*r\b.*-[a-zA-Z]*f\b/i.test(cmd)) return true;
  if (/\brm\s+.*-[a-zA-Z]*f\b.*-[a-zA-Z]*r\b/i.test(cmd)) return true;

  // PowerShell Remove-Item recursive (with or without force, -Recurse or -r)
  if (/\b(?:Remove-Item|ri)\s+.*-(?:Recurse|r\b)/i.test(cmd)) return true;

  return false;
}

// 5. Destructive Deploy / Infrastructure commands
function isDestructiveDeploy(cmd) {
  if (isSearchOrInspect(cmd)) return false;

  // Package publication
  if (/\b(?:npm|pnpm|yarn|bun|cargo)\s+publish\b/i.test(cmd)) return true;

  // Docker push
  if (/\bdocker\s+(?:image\s+)?push\b/i.test(cmd)) return true;

  // Kubernetes
  if (/\bkubectl\s+(?:apply|delete|replace|scale)\b/i.test(cmd)) return true;

  // Terraform
  if (/\bterraform\s+(?:apply|destroy)\b/i.test(cmd)) return true;

  return false;
}

// 6. Dangerous file path validator
function isDangerousFilePath(pathStr) {
  if (!pathStr) return false;
  const normalized = pathStr.replace(/\\/g, "/");

  // Git directory / internals: e.g. .git, .git/, .git/config, /path/to/.git
  if (/(?:^|\/)\.git(?:\/|$)/i.test(normalized)) {
    return "modifying Git internals is forbidden: " + pathStr;
  }

  // Self-protection: hooks.json, approval-gate.mjs, plugin.json
  if (/(?:^|\/)(?:hooks\.json|scripts\/approval-gate\.mjs|plugin\.json)$/i.test(normalized)) {
    return "modifying approval guard configuration or script is forbidden: " + pathStr;
  }

  // Sensitive environment files containing credentials
  if (/(?:^|\/)\.env(?:\..*)?$/i.test(normalized)) {
    return "modifying environment credentials file requires explicit authorization: " + pathStr;
  }

  // OS system root directories
  if (/^(?:[a-zA-Z]:\/(?:Windows|Program Files)|\/(?:etc|usr|bin|sbin|var)\/)/i.test(normalized)) {
    return "modifying system files requires explicit authorization: " + pathStr;
  }

  return false;
}

// Check Command Execution tools
if (toolName === "run_command" || /command|shell|exec|terminal|bash|powershell/i.test(toolName)) {
  if (isDestructiveGit(commandLine)) {
    forceAsk("destructive Git operation requires explicit authorization: " + commandLine);
  }

  if (isDestructiveDb(commandLine)) {
    forceAsk("database modification/migration requires explicit authorization: " + commandLine);
  }

  if (isDestructiveSys(commandLine)) {
    forceAsk("destructive filesystem operation requires explicit authorization: " + commandLine);
  }

  if (isDestructiveDeploy(commandLine)) {
    forceAsk("deployment/publish operation requires explicit authorization: " + commandLine);
  }

  // Routine commands (build, test, inspect, list, diff, node, python, etc.) are allowed
  allow();
}

// Check MCP tools
if (toolName.startsWith("mcp:")) {
  if (/(?:drop|delete|destroy|terminate|publish|push|truncate|remove)/i.test(toolName)) {
    forceAsk(`mutating MCP tool requires explicit authorization: ${toolName}`);
  }
  const argsStr = JSON.stringify(args);
  if (/(?:drop\s+(?:database|table|schema)|truncate\s+|delete\s+from|terminate|destroy)/i.test(argsStr)) {
    forceAsk(`potentially destructive MCP operation requires explicit authorization: ${toolName}`);
  }
  allow();
}

// Check File deletion tools
if (/(?:delete|remove)/i.test(toolName) && !/(?:get|read|list|find)/i.test(toolName)) {
  forceAsk("file deletion requires explicit authorization: " + (filePath || toolName));
}

// Check File modifications (edit_file, write_file, patch, etc.)
const dangerousPathReason = isDangerousFilePath(filePath);
if (dangerousPathReason) {
  forceAsk(dangerousPathReason);
}

// Allow routine tool actions by default
allow();

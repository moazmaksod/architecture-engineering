import { stdin, stdout } from "node:process";
import { resolve, normalize } from "node:path";
import {
  verifyApprovalToken,
  isPathAuthorized,
  DEFAULT_REGISTRY_PATH,
} from "./approval-token.mjs";

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

const args = event.toolCall?.args ?? event.args ?? event.tool_input ?? {};
const commandLine = (
  args.CommandLine ??
  args.commandLine ??
  args.command ??
  args.cmd ??
  args.script ??
  ""
).trim();

const filePath = (
  args.Path ??
  args.path ??
  args.TargetFile ??
  args.targetFile ??
  args.target_file ??
  args.AbsolutePath ??
  args.absolutePath ??
  args.filePath ??
  args.file_path ??
  args.file ??
  ""
).trim();

// Extract authorization, lifecycle state, and scope metadata
const auth =
  event.authorization ??
  event.approvalToken ??
  event.token ??
  args.approvalToken ??
  args.authorization ??
  null;

const lifecycleState =
  event.lifecycleState ??
  args.lifecycleState ??
  process.env.ARCH_LIFECYCLE_STATE ??
  null;

// Secret must be explicitly configured; zero hardcoded fallback secrets
const secret = process.env.ARCH_APPROVAL_SECRET || "";

const workspaceRoot =
  event.workspacePaths?.[0] ??
  event.workspaceRoot ??
  process.cwd();

const registryPath =
  event.registryPath ??
  process.env.ARCH_TOKEN_REGISTRY_PATH ??
  DEFAULT_REGISTRY_PATH;

// Helper: recognize harmless text search, inspect, or log commands (not execution)
function isSearchOrInspect(cmd) {
  return /^\s*(?:grep|rg|ripgrep|cat|type|echo(?!\s+.*[>|])|findstr|head|tail|git\s+(?:log|show|status|diff))\b/i.test(cmd);
}

// Recognize harmless read-only test runners
function isTestRunner(cmd) {
  return /^\s*(?:npm\s+test|node\s+--test(?:\s+.*)?|pnpm\s+test|yarn\s+test|cargo\s+test|pytest|go\s+test)\b/i.test(cmd);
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
  if (/^(?:diff|status|log|show)\b/i.test(rest)) return false;

  // Intercept destructive subcommands
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

  // Format disk/drive
  if (/\bformat\s+[a-zA-Z]:(?:\s|$)/i.test(cmd)) return true;

  // Windows cmd: del /s, rd /s, rmdir /s
  if (/\b(?:del|erase)\s+.*\/[sS]\b/i.test(cmd)) return true;
  if (/\b(?:rd|rmdir)\s+.*\/[sS]\b/i.test(cmd)) return true;

  // POSIX rm: combinations of -r and -f
  if (/\brm\s+.*-(?:[a-zA-Z]*r[a-zA-Z]*f|[a-zA-Z]*f[a-zA-Z]*r)\b/i.test(cmd)) return true;
  if (/\brm\s+.*-[a-zA-Z]*r\b.*-[a-zA-Z]*f\b/i.test(cmd)) return true;
  if (/\brm\s+.*-[a-zA-Z]*f\b.*-[a-zA-Z]*r\b/i.test(cmd)) return true;

  // PowerShell Remove-Item recursive
  if (/\b(?:Remove-Item|ri)\s+.*-(?:Recurse|r\b)/i.test(cmd)) return true;

  return false;
}

// 5. Destructive Deploy / Infrastructure commands
function isDestructiveDeploy(cmd) {
  if (isSearchOrInspect(cmd)) return false;
  if (/\b(?:npm|pnpm|yarn|bun|cargo)\s+publish\b/i.test(cmd)) return true;
  if (/\bdocker\s+(?:image\s+)?push\b/i.test(cmd)) return true;
  if (/\bkubectl\s+(?:apply|delete|replace|scale)\b/i.test(cmd)) return true;
  if (/\bterraform\s+(?:apply|destroy)\b/i.test(cmd)) return true;
  return false;
}

// 6. Dangerous file path validator (self-protection & credentials)
function isDangerousFilePath(pathStr) {
  if (!pathStr) return false;
  const normalized = pathStr.replace(/\\/g, "/");

  // Git directory / internals
  if (/(?:^|\/)\.git(?:\/|$)/i.test(normalized)) {
    return "modifying Git internals is forbidden: " + pathStr;
  }

  // Self-protection: hooks.json, approval-gate.mjs, approval-token.mjs, plugin.json, token registry
  if (
    /(?:^|\/)(?:hooks\.json|(?:scripts\/)?(?:approval-gate|approval-token)\.mjs|plugin\.json|approval-token-registry\.json)$/i.test(
      normalized
    )
  ) {
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

// Detect commands targeting security-critical files
function isCommandTargetingSecurityConfig(cmd) {
  return /\b(?:hooks\.json|approval-gate\.mjs|approval-token\.mjs|approval-token-registry\.json|\.git\/|\.env)\b/i.test(cmd);
}

// Tool Classification
const isModifyingTool =
  /(?:edit|write|create|patch|replace|insert|append|delete|remove|file_change)/i.test(toolName) &&
  !/(?:get|read|list|find|inspect)/i.test(toolName);

const isReadOnlyTool =
  /^(?:read_file|view_file|get_file|list_files|dir|ls|search_files|grep|find|inspect)$/i.test(toolName) ||
  toolName === "send_message" ||
  toolName === "ask_question";

const isCommandTool =
  toolName === "run_command" ||
  /^(?:command|shell|exec|terminal|bash|powershell|pwsh|cmd)$/i.test(toolName);

// 7. Check Protected Paths
const dangerousPathReason = isDangerousFilePath(filePath);
if (dangerousPathReason) {
  forceAsk(dangerousPathReason);
}

// 8. Check File Deletion Tools
if (/(?:delete|remove)/i.test(toolName) && !/(?:get|read|list|find)/i.test(toolName)) {
  forceAsk("file deletion requires explicit authorization: " + (filePath || toolName));
}

// 9. Check MCP Tools
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

// 10. Check Command Execution Tools (`run_command`)
if (isCommandTool) {
  if (!commandLine) {
    forceAsk("empty or missing command line requires explicit confirmation.");
  }

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

  if (isCommandTargetingSecurityConfig(commandLine)) {
    forceAsk("command targeting protected security configuration is forbidden: " + commandLine);
  }

  // Safe read-only inspection commands are allowed in all states
  if (isSearchOrInspect(commandLine)) {
    allow();
  }

  // Pure automated test runners are allowed
  if (isTestRunner(commandLine)) {
    allow();
  }

  // Check commands capable of modifying files (interpreters, redirections, mutation tools)
  const isPotentiallyMutatingCommand =
    /\b(?:node(?!\s+--test\b)|python|powershell|pwsh|cmd(?:\.exe)?|bash|sh|ruby|perl|deno|bun|npx)\b/i.test(commandLine) ||
    /(?:[>|]\s*[^|]+\.(?:js|ts|json|mjs|cjs|py|sh|txt|md)|Out-File|Set-Content|Add-Content|tee\b)/i.test(commandLine) ||
    /\b(?:echo\s+.*>|cat\s+.*>|cp\b|mv\b|touch\b|sed\s+-i|git\s+apply|git\s+checkout\b|git\s+restore\b)\b/i.test(commandLine);

  if (isPotentiallyMutatingCommand) {
    if (!lifecycleState || lifecycleState !== "IMPLEMENTATION") {
      forceAsk(
        `lifecycle violation: shell command execution capable of modifying files is prohibited in state '${
          lifecycleState || "UNSPECIFIED"
        }': ${commandLine}`
      );
    } else {
      // In IMPLEMENTATION state, code edits must use scoped file tools (edit_file/write_file), not arbitrary shell mutation
      forceAsk(
        `scope violation: file modifications during IMPLEMENTATION must use scoped file tools (edit_file/write_file), not arbitrary shell mutation: ${commandLine}`
      );
    }
  }

  // Allow standard benign build/lint commands (e.g. git merge-base, git clean -n, npm run build)
  allow();
}

// 11. Read-Only Tools (read_file, send_message, ask_question)
if (isReadOnlyTool) {
  allow();
}

// 12. File Modification Tools: Strict Fail-Closed Lifecycle & Token Validation
if (isModifyingTool) {
  // A. Strict Lifecycle State Gate
  if (!lifecycleState || lifecycleState !== "IMPLEMENTATION") {
    forceAsk(
      `lifecycle violation: file modifications are strictly prohibited in state '${
        lifecycleState || "UNSPECIFIED"
      }'. Only 'IMPLEMENTATION' with valid human approval token may modify files.`
    );
  }

  // B. Strict Approval Token Gate
  if (!auth) {
    forceAsk("authorization violation: file modifications require a valid human approval token.");
  }

  // C. Configuration Check: Signing Secret
  if (!secret) {
    forceAsk(
      "configuration error: ARCH_APPROVAL_SECRET is missing. Approval gate cannot verify tokens without a configured signing secret."
    );
  }

  // D. Cryptographic Token Verification
  const verification = verifyApprovalToken(auth, secret, {
    allowReplay: Boolean(event.allowReplay),
    registryPath,
  });

  if (!verification.valid) {
    forceAsk(`token security violation: ${verification.reason}`);
  }

  // E. Task and Proposal Binding Verification
  if (event.taskId && verification.payload.taskId !== event.taskId) {
    forceAsk(
      `token task mismatch: token is bound to task '${verification.payload.taskId}', not '${event.taskId}'`
    );
  }
  if (event.proposalId && verification.payload.proposalId !== event.proposalId) {
    forceAsk(
      `token proposal mismatch: token is bound to proposal '${verification.payload.proposalId}', not '${event.proposalId}'`
    );
  }

  // F. Operation Check
  const operations = verification.payload.approvedScope.operations || [];
  if (/(?:delete|remove)/i.test(toolName) && !operations.includes("delete")) {
    forceAsk("scope operation violation: deletion is not permitted in approved scope");
  }

  // G. Scope and Path Traversal Enforcement
  if (filePath) {
    const scopeCheck = isPathAuthorized(
      filePath,
      verification.payload.approvedScope.paths,
      workspaceRoot
    );
    if (!scopeCheck.authorized) {
      forceAsk(scopeCheck.reason);
    }
  }

  allow();
}

// 13. Unknown or Unclassified Tool: Fail Closed
forceAsk(`unknown or unclassified tool call requires explicit human authorization: ${toolName}`);

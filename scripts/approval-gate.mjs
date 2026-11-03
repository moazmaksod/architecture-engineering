import { stdin, stdout } from "node:process";

let input = "";
for await (const chunk of stdin) {
  input += chunk;
}

let toolName = "matched tool";
let commandLine = "";
let filePath = "";

try {
  const event = JSON.parse(input || "{}");
  toolName =
    event.toolCall?.name ??
    event.tool_name ??
    event.toolName ??
    event.tool?.name ??
    event.name ??
    toolName;

  const args = event.toolCall?.args ?? event.args ?? {};
  commandLine =
    args.CommandLine ??
    args.commandLine ??
    args.command ??
    args.cmd ??
    "";
  filePath =
    args.Path ??
    args.path ??
    args.filePath ??
    args.file_path ??
    "";
} catch {
  // Keep the gate safe if input parsing fails
}

// 1. Destructive Git commands:
// Never commit, push, merge, rebase, reset, stash, clean, delete branches without explicit authorization.
const destructiveGit = /\bgit\s+(commit|push|merge|rebase|reset|stash|clean|branch\s+-[dD]|checkout\s+-[fF])\b/i;

// 2. Destructive DB operations:
// Dropping databases, destructive migrations without authorization
const destructiveDb = /\b(drop\s+(database|table|schema)|prisma\s+migrate\s+(deploy|reset)|alembic\s+upgrade|dotnet\s+ef\s+database\s+update)\b/i;

// 3. Destructive system / file commands:
const destructiveSys = /\b(rm\s+-(?:r[fF]|[fF]r)|rmdir\s+\/[sS]|Remove-Item\s+.*-(?:Recurse\s+.*-Force|Force\s+.*-Recurse)|format\s+[a-zA-Z]:)\b/i;
// 4. Production deploy / publish:
const destructiveDeploy = /\b(npm\s+publish|cargo\s+publish|docker\s+push|kubectl\s+apply|terraform\s+apply)\b/i;

if (toolName === "run_command" || /command/i.test(toolName)) {
  if (destructiveGit.test(commandLine)) {
    stdout.write(
      JSON.stringify({
        decision: "force_ask",
        reason:
          "Architecture Engineering safety guard: destructive Git operation requires explicit authorization: " +
          commandLine,
      }) + "\n"
    );
    process.exit(0);
  }

  if (destructiveDb.test(commandLine)) {
    stdout.write(
      JSON.stringify({
        decision: "force_ask",
        reason:
          "Architecture Engineering safety guard: database modification/migration requires explicit authorization: " +
          commandLine,
      }) + "\n"
    );
    process.exit(0);
  }

  if (destructiveSys.test(commandLine)) {
    stdout.write(
      JSON.stringify({
        decision: "force_ask",
        reason:
          "Architecture Engineering safety guard: destructive filesystem operation requires explicit authorization: " +
          commandLine,
      }) + "\n"
    );
    process.exit(0);
  }

  if (destructiveDeploy.test(commandLine)) {
    stdout.write(
      JSON.stringify({
        decision: "force_ask",
        reason:
          "Architecture Engineering safety guard: deployment/publish operation requires explicit authorization: " +
          commandLine,
      }) + "\n"
    );
    process.exit(0);
  }

  // Routine commands (build, test, inspect, list, diff, node, python, etc.) are allowed
  stdout.write(
    JSON.stringify({
      decision: "allow",
    }) + "\n"
  );
  process.exit(0);
}

// For file modifications (edit_file, write_file):
// Protect Git internals and system directories from accidental mutation
if (/\.git[/\\]/i.test(filePath)) {
  stdout.write(
    JSON.stringify({
      decision: "force_ask",
      reason:
        "Architecture Engineering safety guard: modifying Git internals is forbidden: " +
        filePath,
    }) + "\n"
  );
  process.exit(0);
}

// Allow routine tool actions by default
stdout.write(
  JSON.stringify({
    decision: "allow",
  }) + "\n"
);

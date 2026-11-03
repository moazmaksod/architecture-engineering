import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

function runApprovalGate(input) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [resolve("scripts/approval-gate.mjs")], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("close", (code) => {
      if (code !== 0) {
        rejectPromise(new Error(`Exit code ${code}: ${stderr}`));
      } else {
        try {
          resolvePromise(JSON.parse(stdout.trim()));
        } catch (e) {
          rejectPromise(e);
        }
      }
    });

    child.stdin.write(input);
    child.stdin.end();
  });
}

test("Approval Gate Guard Unit Tests", async (t) => {
  // Routine actions permitted in execution mode
  await t.test("allows routine file edit", async () => {
    const result = await runApprovalGate(JSON.stringify({
      toolCall: {
        name: "edit_file",
        args: { Path: "src/calculator.js" }
      }
    }));
    assert.equal(result.decision, "allow");
  });

  await t.test("allows routine command (tests, build, inspect)", async () => {
    const result = await runApprovalGate(JSON.stringify({
      toolCall: {
        name: "run_command",
        args: { CommandLine: "npm test" }
      }
    }));
    assert.equal(result.decision, "allow");
  });

  await t.test("allows git status and git diff inspection", async () => {
    const result = await runApprovalGate(JSON.stringify({
      toolCall: {
        name: "run_command",
        args: { CommandLine: "git diff --stat" }
      }
    }));
    assert.equal(result.decision, "allow");
  });

  // False positive reductions: inspection commands
  await t.test("allows git stash list and git stash show", async () => {
    const res1 = await runApprovalGate(JSON.stringify({
      toolCall: { name: "run_command", args: { CommandLine: "git stash list" } }
    }));
    assert.equal(res1.decision, "allow");

    const res2 = await runApprovalGate(JSON.stringify({
      toolCall: { name: "run_command", args: { CommandLine: "git stash show" } }
    }));
    assert.equal(res2.decision, "allow");
  });

  await t.test("allows git merge-base and git clean -n", async () => {
    const res1 = await runApprovalGate(JSON.stringify({
      toolCall: { name: "run_command", args: { CommandLine: "git merge-base main feature" } }
    }));
    assert.equal(res1.decision, "allow");

    const res2 = await runApprovalGate(JSON.stringify({
      toolCall: { name: "run_command", args: { CommandLine: "git clean -n" } }
    }));
    assert.equal(res2.decision, "allow");
  });

  await t.test("allows text searches containing database or deployment keywords", async () => {
    const res1 = await runApprovalGate(JSON.stringify({
      toolCall: { name: "run_command", args: { CommandLine: 'grep -rn "drop table" src/' } }
    }));
    assert.equal(res1.decision, "allow");

    const res2 = await runApprovalGate(JSON.stringify({
      toolCall: { name: "run_command", args: { CommandLine: 'git log --grep="npm publish"' } }
    }));
    assert.equal(res2.decision, "allow");
  });

  // Destructive Git operations (including flag bypass prevention)
  await t.test("blocks destructive git commands (reset --hard)", async () => {
    const result = await runApprovalGate(JSON.stringify({
      toolCall: {
        name: "run_command",
        args: { CommandLine: "git reset --hard HEAD~1" }
      }
    }));
    assert.equal(result.decision, "force_ask");
    assert.match(result.reason, /destructive Git operation/i);
  });

  await t.test("blocks destructive git commands (push)", async () => {
    const result = await runApprovalGate(JSON.stringify({
      toolCall: {
        name: "run_command",
        args: { CommandLine: "git push origin main" }
      }
    }));
    assert.equal(result.decision, "force_ask");
    assert.match(result.reason, /destructive Git operation/i);
  });

  await t.test("blocks git push with global options and git.exe", async () => {
    const res1 = await runApprovalGate(JSON.stringify({
      toolCall: { name: "run_command", args: { CommandLine: "git -C . push origin main" } }
    }));
    assert.equal(res1.decision, "force_ask");

    const res2 = await runApprovalGate(JSON.stringify({
      toolCall: { name: "run_command", args: { CommandLine: "git.exe push origin main" } }
    }));
    assert.equal(res2.decision, "force_ask");

    const res3 = await runApprovalGate(JSON.stringify({
      toolCall: { name: "run_command", args: { CommandLine: 'git -c user.name=me commit -m "bypass"' } }
    }));
    assert.equal(res3.decision, "force_ask");
  });

  await t.test("blocks git branch deletion and forced checkout", async () => {
    const res1 = await runApprovalGate(JSON.stringify({
      toolCall: { name: "run_command", args: { CommandLine: "git branch --delete --force feature" } }
    }));
    assert.equal(res1.decision, "force_ask");

    const res2 = await runApprovalGate(JSON.stringify({
      toolCall: { name: "run_command", args: { CommandLine: "git checkout --force main" } }
    }));
    assert.equal(res2.decision, "force_ask");

    const res3 = await runApprovalGate(JSON.stringify({
      toolCall: { name: "run_command", args: { CommandLine: "git switch -f main" } }
    }));
    assert.equal(res3.decision, "force_ask");
  });

  // Destructive database operations
  await t.test("blocks destructive database operations", async () => {
    const result = await runApprovalGate(JSON.stringify({
      toolCall: {
        name: "run_command",
        args: { CommandLine: "prisma migrate reset" }
      }
    }));
    assert.equal(result.decision, "force_ask");
    assert.match(result.reason, /database modification/i);
  });

  // Destructive filesystem commands
  await t.test("blocks destructive filesystem commands", async () => {
    const result = await runApprovalGate(JSON.stringify({
      toolCall: {
        name: "run_command",
        args: { CommandLine: "rmdir /s /q temp" }
      }
    }));
    assert.equal(result.decision, "force_ask");
    assert.match(result.reason, /destructive filesystem operation/i);
  });

  await t.test("blocks system drive formatting (format c:)", async () => {
    const res1 = await runApprovalGate(JSON.stringify({
      toolCall: { name: "run_command", args: { CommandLine: "format c:" } }
    }));
    assert.equal(res1.decision, "force_ask");

    const res2 = await runApprovalGate(JSON.stringify({
      toolCall: { name: "run_command", args: { CommandLine: "format c: /fs:NTFS" } }
    }));
    assert.equal(res2.decision, "force_ask");
  });

  await t.test("blocks Windows del/rd tree deletion and POSIX flag separation", async () => {
    const res1 = await runApprovalGate(JSON.stringify({
      toolCall: { name: "run_command", args: { CommandLine: "del /f /s /q temp" } }
    }));
    assert.equal(res1.decision, "force_ask");

    const res2 = await runApprovalGate(JSON.stringify({
      toolCall: { name: "run_command", args: { CommandLine: "rd /s /q temp" } }
    }));
    assert.equal(res2.decision, "force_ask");

    const res3 = await runApprovalGate(JSON.stringify({
      toolCall: { name: "run_command", args: { CommandLine: "rm -r -f temp" } }
    }));
    assert.equal(res3.decision, "force_ask");
  });

  // Deployments and infrastructure destruction
  await t.test("blocks destructive deploy, terraform destroy, and kubectl delete", async () => {
    const res1 = await runApprovalGate(JSON.stringify({
      toolCall: { name: "run_command", args: { CommandLine: "terraform destroy -auto-approve" } }
    }));
    assert.equal(res1.decision, "force_ask");

    const res2 = await runApprovalGate(JSON.stringify({
      toolCall: { name: "run_command", args: { CommandLine: "kubectl delete namespace prod" } }
    }));
    assert.equal(res2.decision, "force_ask");

    const res3 = await runApprovalGate(JSON.stringify({
      toolCall: { name: "run_command", args: { CommandLine: "pnpm publish" } }
    }));
    assert.equal(res3.decision, "force_ask");
  });

  // Protected paths and self-protection
  await t.test("blocks mutation of .git directory (with or without trailing slash)", async () => {
    const res1 = await runApprovalGate(JSON.stringify({
      toolCall: {
        name: "write_file",
        args: { Path: "c:/project/.git/config" }
      }
    }));
    assert.equal(res1.decision, "force_ask");
    assert.match(res1.reason, /modifying Git internals is forbidden/i);

    const res2 = await runApprovalGate(JSON.stringify({
      toolCall: {
        name: "write_file",
        args: { Path: ".git" }
      }
    }));
    assert.equal(res2.decision, "force_ask");
  });

  await t.test("blocks modification of security gate files (self-protection)", async () => {
    const res1 = await runApprovalGate(JSON.stringify({
      toolCall: {
        name: "write_file",
        args: { Path: "scripts/approval-gate.mjs", Content: "bad" }
      }
    }));
    assert.equal(res1.decision, "force_ask");

    const res2 = await runApprovalGate(JSON.stringify({
      toolCall: {
        name: "write_file",
        args: { Path: "hooks.json", Content: "{}" }
      }
    }));
    assert.equal(res2.decision, "force_ask");
  });

  await t.test("blocks modification of credential files (.env) and system directories", async () => {
    const res1 = await runApprovalGate(JSON.stringify({
      toolCall: {
        name: "write_file",
        args: { Path: ".env.production", Content: "KEY=VAL" }
      }
    }));
    assert.equal(res1.decision, "force_ask");

    const res2 = await runApprovalGate(JSON.stringify({
      toolCall: {
        name: "write_file",
        args: { Path: "/etc/hosts", Content: "127.0.0.1 bad.com" }
      }
    }));
    assert.equal(res2.decision, "force_ask");
  });

  await t.test("blocks file deletion tool", async () => {
    const res = await runApprovalGate(JSON.stringify({
      toolCall: {
        name: "delete_file",
        args: { Path: "src/main.js" }
      }
    }));
    assert.equal(res.decision, "force_ask");
  });

  await t.test("blocks destructive MCP operations", async () => {
    const res1 = await runApprovalGate(JSON.stringify({
      toolCall: {
        name: "mcp:db_admin",
        args: { query: "DROP DATABASE prod;" }
      }
    }));
    assert.equal(res1.decision, "force_ask");

    const res2 = await runApprovalGate(JSON.stringify({
      toolCall: {
        name: "mcp:delete_resource",
        args: { id: "res-123" }
      }
    }));
    assert.equal(res2.decision, "force_ask");
  });

  // Fail-closed verification
  await t.test("fails closed on malformed JSON payload", async () => {
    const result = await runApprovalGate("not-json");
    assert.equal(result.decision, "force_ask");
    assert.match(result.reason, /unparseable JSON/i);
  });

  await t.test("fails closed on empty payload", async () => {
    const result = await runApprovalGate("");
    assert.equal(result.decision, "force_ask");
    assert.match(result.reason, /empty or missing payload/i);
  });

  await t.test("fails closed on unidentified tool call", async () => {
    const result = await runApprovalGate("{}");
    assert.equal(result.decision, "force_ask");
    assert.match(result.reason, /unidentified tool call/i);
  });
});
